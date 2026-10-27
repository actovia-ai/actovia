import {
  type CurrentRun,
  excludedRuns,
  type RunAttemptInfo
} from '@actovia/shared/utils/attempts'
import type { Message } from '@earendil-works/pi-ai'
import { asc, eq } from 'drizzle-orm'

import { db } from '../../db/db'
import type { LcmContextItem, LcmSummary } from '../../db/schema'
import { message as messageTable } from '../../db/schema'
import { storedUsage } from '../utils/usage'
import { formatSummaryAsXml } from './prompts'
import {
  getContextItems,
  getMessagesByIds,
  getParentIds,
  getSummariesByIds,
  initContextItems
} from './queries'
import { estimateMessageTokens, estimateTokens } from './token-counter'

export interface AssembledContext {
  /** Messages to pass directly to the agent (summaries injected as user messages) */
  messages: Message[]
  /** Total token estimate of assembled context */
  totalTokens: number
  /** IDs of messages already tracked in lcm_context_items (for deduplication when appending) */
  trackedMessageIds: Set<string>
  /**
   * Aligned with `messages`: the run id where that message is the run's own
   * user message (its question), else null — a summary, an answer, a tool
   * result. The route puts each run's memory block before its question.
   */
  runHeads: (string | null)[]
  /**
   * Aligned with `messages`: whether it is a compaction summary (a user
   * message of `<summary>` XML, which a person could also type) or one of
   * the chat's own messages. The context view counts by it (ISSUE-235).
   */
  kinds: ContextMessageKind[]
}

export type ContextMessageKind = 'summary' | 'message'

/**
 * A run of context items: the rows of one `message.runId`, or one summary
 * on its own. The unit that assembly and compaction work in — a run is in the
 * context whole or not at all, so a request never carries a tool result
 * without its tool call, or opens on anything but a user message.
 */
export interface RunGroup {
  /** The `runId`, or `summary:<id>`. */
  key: string
  items: LcmContextItem[]
}

export function groupItemsIntoRuns(
  items: LcmContextItem[],
  runIdOf: Map<string, string>
): RunGroup[] {
  const groups: RunGroup[] = []
  for (const item of items) {
    const key =
      item.kind === 'summary'
        ? `summary:${item.refId}`
        : (runIdOf.get(item.refId) ?? `orphan:${item.refId}`)
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, items: [item] })
  }
  return groups
}

type MessageRow = typeof messageTable.$inferSelect

/** The runs among `rows`, as their user rows describe them. */
function runInfosOf(rows: MessageRow[]): RunAttemptInfo[] {
  return rows
    .filter((row) => row.role === 'user' && row.id === row.runId)
    .map((row) => ({
      runId: row.runId,
      alternateOf: row.alternateOf,
      attempt: row.attempt
    }))
}

/**
 * The context items as the runs the model may see: `groupItemsIntoRuns`,
 * less the runs a regenerate group keeps from it (`excludedRuns` — the answer
 * that was not kept, the attempts older than the newest two and, for a
 * regenerate, every other run of its group). Assembly and compaction both
 * start here, so the fresh tail counts runs the model sees and a run that is
 * out of sight is neither sent nor summarized.
 */
export function contextRuns(
  items: LcmContextItem[],
  rows: MessageRow[],
  current?: CurrentRun
): RunGroup[] {
  const runs = groupItemsIntoRuns(
    items,
    new Map(rows.map((row) => [row.id, row.runId]))
  )
  const excluded = excludedRuns(runInfosOf(rows), current)
  return excluded.size === 0
    ? runs
    : runs.filter((run) => !excluded.has(run.key))
}

/**
 * Assembles the LLM context for a chat session.
 *
 * Flow:
 * 1. If no context items exist for this chat, bootstrap from message table
 * 2. Group items into runs, less those a regenerate group keeps out of
 *    sight (`current` is the run being answered); the fresh tail is the most
 *    recent N of them
 * 3. Fill the token budget: the fresh tail whole, then whole older runs
 *    newest first, stopping at the first that does not fit
 * 4. Inject summaries as user messages with XML markers
 */
export async function assembleContext(
  chatId: string,
  tokenBudget: number,
  freshTailRuns: number,
  current?: CurrentRun
): Promise<AssembledContext> {
  // Bootstrap: if no context items tracked yet, seed from DB messages
  let items = await getContextItems(chatId)
  if (items.length === 0) {
    await bootstrapContextItems(chatId)
    items = await getContextItems(chatId)
  }

  const trackedMessageIds = new Set<string>(
    items.filter((i) => i.kind === 'message').map((i) => i.refId)
  )

  if (items.length === 0) {
    return {
      messages: [],
      totalTokens: 0,
      trackedMessageIds,
      runHeads: [],
      kinds: []
    }
  }

  const rows = await getMessagesByIds(Array.from(trackedMessageIds))
  const rowById = new Map(rows.map((m) => [m.id, m]))
  const runs = contextRuns(items, rows, current)

  type Materialized = {
    messages: Message[]
    heads: (string | null)[]
    kinds: ContextMessageKind[]
    tokens: number
  }
  const materialize = async (group: RunGroup): Promise<Materialized> => {
    const out: Message[] = []
    const heads: (string | null)[] = []
    const kinds: ContextMessageKind[] = []
    let tokens = 0
    for (const item of group.items) {
      if (item.kind === 'message') {
        const row = rowById.get(item.refId)
        if (!row) continue
        tokens += item.tokenCount ?? estimateMessageTokens(row.content)
        out.push(dbMessageToLlmMessage(row))
        heads.push(
          row.role === 'user' && row.id === row.runId ? row.runId : null
        )
        kinds.push('message')
      } else {
        const [summary] = await getSummariesByIds([item.refId])
        if (!summary) continue
        tokens += item.tokenCount ?? estimateTokens(summary.content)
        out.push(summaryToMessage(summary, await getParentIds(summary.id)))
        heads.push(null)
        kinds.push('summary')
      }
    }
    return { messages: out, heads, kinds, tokens }
  }

  // Fresh tail: the most recent N runs, always included whole.
  const freshRuns = runs.slice(-freshTailRuns)
  const evictableRuns = runs.slice(0, -freshTailRuns)

  const fresh = await Promise.all(freshRuns.map(materialize))
  const freshTokens = fresh.reduce((n, r) => n + r.tokens, 0)

  // Back-fill whole runs, newest first; the first that does not fit ends it —
  // a run is never trimmed to fit.
  let remaining = tokenBudget - freshTokens
  const prefix: Materialized[] = []
  let prefixTokens = 0
  for (let i = evictableRuns.length - 1; i >= 0; i--) {
    const run = await materialize(evictableRuns[i])
    if (run.tokens > remaining) break
    remaining -= run.tokens
    prefixTokens += run.tokens
    prefix.unshift(run)
  }

  const all = [...prefix, ...fresh]
  return {
    messages: all.flatMap((r) => r.messages),
    totalTokens: prefixTokens + freshTokens,
    trackedMessageIds,
    runHeads: all.flatMap((r) => r.heads),
    kinds: all.flatMap((r) => r.kinds)
  }
}

/** Convert a DB message row to a pi-ai Message (handling all roles) */
export function dbMessageToLlmMessage(msg: MessageRow): Message {
  if (msg.role === 'toolResult') {
    return {
      role: 'toolResult',
      content: msg.content as Message['content'],
      toolCallId: msg.toolCallId ?? '',
      toolName: msg.toolName ?? '',
      // Not sent to the provider; a past search's digest is made from it
      // (`aging.ts`).
      details: msg.details,
      isError: msg.isError ?? false,
      timestamp: msg.createdAt.getTime()
    } as Message
  }
  if (msg.role === 'assistant') {
    // Who wrote it: pi compares these with the model it sends to, and an
    // answer without them reads as another model's — its thinking turned to
    // plain text, its signatures dropped.
    return {
      role: 'assistant',
      content: msg.content as Message['content'],
      api: msg.api ?? undefined,
      provider: msg.provider ?? undefined,
      model: msg.model ?? undefined,
      stopReason: msg.stopReason ?? 'stop',
      ...(msg.errorMessage ? { errorMessage: msg.errorMessage } : {}),
      usage: storedUsage(msg.usage),
      timestamp: msg.createdAt.getTime()
    } as Message
  }
  return {
    role: 'user',
    content: msg.content as Message['content'],
    timestamp: msg.createdAt.getTime()
  } as Message
}

/** Seed lcm_context_items from existing messages in the DB for a chat */
export async function bootstrapContextItems(chatId: string): Promise<void> {
  const messages = await db
    .select()
    .from(messageTable)
    .where(eq(messageTable.chatId, chatId))
    .orderBy(asc(messageTable.createdAt))

  if (messages.length === 0) return

  await initContextItems(
    chatId,
    messages.map((m) => ({
      kind: 'message' as const,
      refId: m.id,
      tokenCount: estimateMessageTokens(m.content)
    }))
  )
}

/** Convert a summary to a pi-ai compatible Message with XML wrapper */
function summaryToMessage(summary: LcmSummary, parentIds: string[]): Message {
  const xml = formatSummaryAsXml({
    id: summary.id,
    kind: summary.kind as 'leaf' | 'condensed',
    depth: summary.depth,
    content: summary.content,
    descendantCount: summary.descendantCount,
    earliestAt: summary.earliestAt,
    latestAt: summary.latestAt,
    parentIds
  })

  return {
    role: 'user',
    content: [{ type: 'text', text: xml }],
    timestamp: summary.createdAt.getTime()
  }
}
