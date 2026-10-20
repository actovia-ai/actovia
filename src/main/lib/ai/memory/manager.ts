import type {
  MemoryChange,
  MemoryInstructionResult,
  MemorySnapshot
} from '@actovia/shared/types/memory'
import type { Model } from '@earendil-works/pi-ai'
import z from 'zod'

import {
  createMemory,
  getActiveMemories,
  getAllMemories,
  getMemoryUsageByChat,
  hardDeleteMemory,
  logMemoryUsage,
  softDeleteMemory,
  touchMemories,
  updateMemory,
  type MemoryRow,
  type MemorySection
} from '../../db/memory-queries'
import { logger } from '../../logger'
import { completeSimple } from '../utils/complete'
import { runMemoryBlocks } from './run-memory'

export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

// ─── Types ────────────────────────────────────────────────────────────────────

const SectionEnum = z.enum(['profile', 'topic', 'person'])

const ConsolidationSchema = z.object({
  operations: z.array(
    z.discriminatedUnion('op', [
      z.object({
        op: z.enum(['create', 'update']),
        id: z.string().optional(),
        section: SectionEnum,
        key: z.string().min(1),
        summary: z.string().min(1),
        details: z.array(z.string()).default([]),
        confidence: z.number().min(0).max(1).optional()
      }),
      z.object({ op: z.literal('delete'), id: z.string() })
    ])
  )
})

const MemoryFilterResultSchema = z.object({
  selectedMemoryIds: z.array(z.string())
})

/** Ops for the user-driven instruction path — adds `delete`, and every field
 *  except `op` is optional so a `delete` needn't carry a full entry. */
const InstructionSchema = z.object({
  operations: z.array(
    z.object({
      op: z.enum(['create', 'update', 'delete']),
      id: z.string().optional(),
      section: SectionEnum.optional(),
      key: z.string().optional(),
      summary: z.string().optional(),
      details: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
  )
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMessages(
  messages: Array<{ role: string; content: unknown }>
): string {
  return messages
    .map((m) => {
      const text = Array.isArray(m.content)
        ? m.content
            .filter(
              (c: unknown): c is { type: 'text'; text: string } =>
                typeof c === 'object' &&
                c !== null &&
                (c as { type: string }).type === 'text'
            )
            .map((c) => c.text)
            .join('')
        : String(m.content)
      return `${m.role.toUpperCase()}: ${text}`
    })
    .join('\n\n')
}

export function parseJsonFromResponse(text: string): unknown {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1])
    } catch {
      // fall through
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function callLlm(
  model: Model<string>,
  apiKey: string,
  systemPrompt: string,
  userText: string
): Promise<string> {
  const result = await completeSimple(
    model,
    {
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userText }],
          timestamp: Date.now()
        }
      ]
    },
    { apiKey }
  )
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
}

/** One line per entry for feeding an existing memory index to the LLM. */
function memoryIndexLine(m: MemoryRow): string {
  return `- [${m.id}] (${m.section}) ${m.key}: ${m.summary}`
}

// ─── Consolidation (write) ────────────────────────────────────────────────────

const MEMORY_MODEL = `A memory entry is ONE topic / person / profile-area:
- section: "profile" (identity, environment/setup, hard constraints, enduring personal preferences like diet, tools, working style) | "topic" (a lasting interest or ongoing project) | "person" (someone in the user's life)
- key: a short, stable title — e.g. "Classical Music", "Homelab", "Investing"
- summary: a compact noun phrase naming what the entry covers — NOT a sentence, no "User is…". e.g. "Japanese equities trading, thesis, and analytical frameworks"
- details: 2–5 bullets, each ONE durable, self-contained fact about the user, stated at a level that stays true for months — what they do, own, use, track, or have decided. Lead with specifics: names, tickers, tools, frameworks, places. Never a single purchase or one-time event, a backstory anecdote, a wish ("would like to see…"), or how they want answers formatted. Drop hedges ("interested in", "finds useful", "wants"). Merge and prune aggressively; never past 5.`

/** Exported for the faux-boot marker test only. */
export const CONSOLIDATE_SYSTEM = `You maintain a durable, long-term memory of the user across conversations.

You are given the latest conversation and the current memory index. Decide what — if anything — to change. The default is to change NOTHING: almost every conversation teaches nothing worth keeping. The running context of THIS conversation is handled elsewhere — your only job is the handful of facts that will still change how you help this person in unrelated chats months from now.

${MEMORY_MODEL}

Record something only if it passes EVERY test:
1. Lasting influence — knowing it would change how you help across future, unrelated conversations.
2. Commitment, not a mention — the conversation shows the user actually does this repeatedly, has invested in it, identifies with it, or is running it as an ongoing project. Naming something once — a game they played, a movie they saw, a place they went, a tool used for this one task — is NOT enough; wait for it to recur or for an explicit signal ("I've done X for years", "I always…", "my job is…").
3. About the user — their identity, work, expertise, holdings, skills, relationships, or a sustained interest. Not about the world.
4. Non-sensitive — no secrets, credentials, precise health data, exact balances/salary, private third-party info.
5. Stated or clearly implied by the user — not inferred by you from one exchange.

NEVER record:
- How the user wants answers shaped — format, length, tone, "wants comprehensive coverage", "likes diagrams", "prefers tables", "standardize the tickers". Style is not memory.
- A single transaction or event — "preordered X", "bought Y", "watched Z", "aware a sequel is coming". Gone in weeks.
- Backstory or anecdotes with no forward use — how they first discovered something, a one-time story.
- Wishes or speculation — "would like a remake", "hopes X ships".
- Transient state — today's question, a file just opened, what they're doing right now.

Example: the user says they watched a film last night and loved it → { "operations": [] }. One film is a one-off. Only a sustained pattern (they review films, they're writing a screenplay) is memory.

Prefer UPDATE over CREATE. If the conversation genuinely adds to an existing entry, update it and return its FULL revised summary + details (not just the new part). If your new fact belongs in an entry that already exists, update that one — don't create a near-duplicate. Only CREATE when no existing entry fits and the subject clearly clears all five tests.

Keep what is already there true. The five tests above are for NEW subjects; an entry in the index has already passed them, so when the conversation shows one of its facts has changed — a position sold or resized, a tool or city switched, a project finished, a plan dropped — UPDATE it to the new state, or DELETE it when nothing of it holds any more. Two entries that turn out to be one subject: UPDATE one with everything, DELETE the other. Change an entry only on what the user said, never on a guess.

Changes the assistant already made during the conversation (update_memory calls) are already in the index — don't make them again.

Respond ONLY with a JSON object:
{
  "operations": [
    { "op": "create", "section": "topic", "key": "Classical Music", "summary": "...", "details": ["...", "..."] },
    { "op": "update", "id": "<existing entry id>", "section": "topic", "key": "Classical Music", "summary": "...", "details": ["...", "..."] },
    { "op": "delete", "id": "<existing entry id>" }
  ]
}

Return { "operations": [] } when nothing durable was learned and nothing known has changed — this is the common case. Never invent an id — only use ids from the index.`

/** Exported for the faux-boot marker test only. */
export const INSTRUCTION_SYSTEM = `You edit the user's long-term memory from a direct instruction. They are looking at their memory and telling you what to add, change, or remove.

${MEMORY_MODEL}

Do exactly what the user asked — nothing more. Prefer UPDATE of an existing entry over CREATE. Use DELETE only when they clearly want an entry gone. For create/update, return the entry's FULL summary + details.

Respond ONLY with a JSON object:
{
  "operations": [
    { "op": "create", "section": "person", "key": "Gerald", "summary": "The user's plant", "details": ["Named Gerald"] },
    { "op": "update", "id": "<id>", "section": "topic", "key": "...", "summary": "...", "details": ["..."] },
    { "op": "delete", "id": "<id>" }
  ]
}

Return { "operations": [] } if the instruction doesn't call for a memory change. Never invent an id.`

export async function runMemoryConsolidation(
  messages: Array<{ role: string; content: unknown }>,
  model: Model<string>,
  apiKey: string
): Promise<void> {
  try {
    const existing = await getActiveMemories(LOCAL_USER_ID)
    const index =
      existing.length > 0 ? existing.map(memoryIndexLine).join('\n') : '(empty)'

    const responseText = await callLlm(
      model,
      apiKey,
      CONSOLIDATE_SYSTEM,
      `Current memory index:\n${index}\n\nConversation to analyze:\n\n${formatMessages(
        messages
      )}`
    )

    const parsed = ConsolidationSchema.safeParse(
      parseJsonFromResponse(responseText)
    )
    if (!parsed.success) return

    const validIds = new Set(existing.map((m) => m.id))

    for (const op of parsed.data.operations) {
      if (op.op === 'delete') {
        // Nobody watches this job to undo it: the entry is switched off, not
        // removed, and Settings → Memory can restore it.
        if (validIds.has(op.id)) await softDeleteMemory(op.id)
        continue
      }
      const fields = {
        section: op.section as MemorySection,
        key: op.key.trim(),
        summary: op.summary.trim(),
        details: op.details
          .map((d) => d.trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      if (op.op === 'update' && op.id && validIds.has(op.id)) {
        await updateMemory(op.id, {
          ...fields,
          confidence: op.confidence
        })
      } else {
        await createMemory({
          userId: LOCAL_USER_ID,
          source: 'implicit',
          confidence: op.confidence ?? 0.8,
          ...fields
        })
      }
    }
  } catch (err) {
    logger.error('memory', 'Consolidation failed', { error: err })
  }
}

// ─── User instruction (manual edit) ───────────────────────────────────────────

/** The field values an entry had (or now has), independent of its id — what
 *  a `MemoryChange`'s `before`/`after` carries and undo restores. */
export function snapshotOf(m: MemoryRow): MemorySnapshot {
  return {
    section: m.section,
    key: m.key,
    summary: m.summary,
    details: m.details,
    isActive: m.isActive ?? true
  }
}

function memoryEntryBlock(m: MemoryRow): string {
  const bullets = m.details.map((d) => `- ${d}`).join('\n')
  return `[${m.id}] (${m.section}) ${m.key}\nsummary: ${m.summary}${
    bullets ? `\n${bullets}` : ''
  }`
}

/**
 * Apply a free-text instruction from the user ("remember my plant is Gerald",
 * "drop the bullet about Helios", "delete this entry"). Unlike consolidation
 * this can DELETE, and runs synchronously so the route can report the result.
 * `scopeMemoryId` narrows the context to one entry the user is looking at.
 */
export async function runMemoryInstruction(
  instruction: string,
  scopeMemoryId: string | null,
  model: Model<string>,
  apiKey: string
): Promise<MemoryInstructionResult> {
  // Include inactive entries so the user can reference / restore / delete them.
  const all = await getAllMemories(LOCAL_USER_ID)
  const scoped = scopeMemoryId
    ? (all.find((m) => m.id === scopeMemoryId) ?? null)
    : null

  const context = scoped
    ? `The user is editing this entry:\n${memoryEntryBlock(scoped)}\n\n` +
      `Other entries (id + title only):\n${
        all
          .filter((m) => m.id !== scoped.id)
          .map((m) => `- [${m.id}] (${m.section}) ${m.key}`)
          .join('\n') || '(none)'
      }`
    : `Current memory:\n${
        all.length > 0 ? all.map(memoryEntryBlock).join('\n\n') : '(empty)'
      }`

  const responseText = await callLlm(
    model,
    apiKey,
    INSTRUCTION_SYSTEM,
    `${context}\n\nUser instruction:\n${instruction.trim()}`
  )

  const parsed = InstructionSchema.safeParse(
    parseJsonFromResponse(responseText)
  )
  if (!parsed.success) {
    throw new Error("Couldn't interpret that instruction — try rephrasing.")
  }

  const byId = new Map(all.map((m) => [m.id, m]))
  const changes: MemoryChange[] = []

  for (const op of parsed.data.operations) {
    if (op.op === 'delete') {
      const before = op.id ? byId.get(op.id) : undefined
      if (!before) continue // unknown id (or deleted earlier this reply): ignored, not reported
      await hardDeleteMemory(before.id)
      byId.delete(before.id)
      changes.push({
        op: 'delete',
        id: before.id,
        before: snapshotOf(before),
        after: null
      })
      continue
    }

    if (!op.section || !op.key?.trim() || !op.summary?.trim()) continue
    const fields = {
      section: op.section as MemorySection,
      key: op.key.trim(),
      summary: op.summary.trim(),
      details: (op.details ?? [])
        .map((d) => d.trim())
        .filter(Boolean)
        .slice(0, 8)
    }

    if (op.op === 'update') {
      const before = op.id ? byId.get(op.id) : undefined
      // unknown id, or deleted earlier this reply: ignored (never invents a create)
      if (!before) continue
      const updated = await updateMemory(before.id, {
        ...fields,
        confidence: op.confidence
      })
      if (!updated) continue
      byId.set(before.id, updated)
      changes.push({
        op: 'update',
        id: before.id,
        before: snapshotOf(before),
        after: snapshotOf(updated)
      })
    } else {
      const created = await createMemory({
        userId: LOCAL_USER_ID,
        source: 'explicit',
        confidence: op.confidence ?? 0.9,
        ...fields
      })
      changes.push({
        op: 'create',
        id: created.id,
        before: null,
        after: snapshotOf(created)
      })
    }
  }

  return { applied: changes.length, changes }
}

// ─── Read filter ──────────────────────────────────────────────────────────────

/** Exported for the faux-boot marker test only. */
export const READ_FILTER_SYSTEM = `You select which memory entries are directly relevant to a user's message.
Be conservative: only pick entries that would NOTICEABLY improve the reply.
Respond ONLY with JSON: { "selectedMemoryIds": ["id1", "id2"] }
If nothing is relevant: { "selectedMemoryIds": [] }`

/**
 * Picks the memory entries worth injecting for this message, records the usage,
 * and returns the selected rows (already fetched — no extra query needed).
 */
export async function loadRelevantMemories(
  question: string,
  model: Model<string>,
  apiKey: string,
  sessionId: string,
  runId: string
): Promise<MemoryRow[]> {
  try {
    const all = await getActiveMemories(LOCAL_USER_ID)
    if (all.length === 0) return []

    const listText = all
      .map(
        (m) =>
          `${m.id}: [${m.section}] ${m.key} — ${m.summary}` +
          (m.details.length ? `\n    ${m.details.join('; ')}` : '')
      )
      .join('\n')

    const responseText = await callLlm(
      model,
      apiKey,
      READ_FILTER_SYSTEM,
      `User message: ${question}\n\nMemory entries:\n${listText}`
    )

    const parsed = MemoryFilterResultSchema.safeParse(
      parseJsonFromResponse(responseText)
    )
    if (!parsed.success) return []

    const selectedIds = new Set(parsed.data.selectedMemoryIds)
    const selected = all.filter((m) => selectedIds.has(m.id))

    if (selected.length > 0) {
      const ids = selected.map((m) => m.id)
      await touchMemories(ids)
      await Promise.all(
        selected.map((m) =>
          logMemoryUsage({
            memoryId: m.id,
            sessionId,
            runId,
            key: m.key,
            section: m.section,
            reason: 'read-filter'
          }).catch(() => {})
        )
      )
    }

    return selected
  } catch (err) {
    logger.error('memory', 'Read filter failed', { error: err })
    return []
  }
}

/**
 * Every past run's memory block for a chat (`run-memory.ts`): what the read
 * filter chose for each run, rendered with the entries as they are now.
 */
export async function loadRunMemoryBlocks(
  chatId: string
): Promise<Map<string, string>> {
  const [usage, current] = await Promise.all([
    getMemoryUsageByChat(chatId),
    getAllMemories(LOCAL_USER_ID)
  ])
  return runMemoryBlocks(usage, current)
}
