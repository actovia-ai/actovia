import type { Context, Model } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { afterAll, describe, expect, it, vi } from 'vitest'

// What the assembler hands to pi has to satisfy pi. Every provider builds its
// request through `clampMaxTokensToContext`, which estimates the context from
// the `usage` of the assistant messages in it — so from a chat's second
// request on, a message rebuilt without `usage` fails the request before it
// is sent ("Cannot read properties of undefined (reading 'totalTokens')").
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('0011')
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const { assembleContext } =
  await import('@main/lib/ai/context-management/context-assembler')

afterAll(async () => {
  await pglite.close()
})

const model = { contextWindow: 200_000 } as Model<string>
const USAGE = {
  input: 1200,
  output: 300,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1500,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
const q = (v: unknown) =>
  v === null ? 'NULL' : `'${JSON.stringify(v).replaceAll("'", "''")}'`

/** One finished run (a tool step, then the answer) and the next user message. */
async function seedFollowUp(usage: unknown): Promise<string> {
  const chatId = crypto.randomUUID()
  const first = crypto.randomUUID()
  const second = crypto.randomUUID()
  await pglite.exec(
    `INSERT INTO "chat" ("id","title") VALUES ('${chatId}','t')`
  )
  const text = (t: string) => [{ type: 'text', text: t }]
  const call = [
    { type: 'toolCall', id: 'call_1', name: 'weather', arguments: {} }
  ]
  const rows = [
    `('${first}','${chatId}','${first}','user',${q(text('q1'))},NULL,NULL,NULL,NULL,'${at(0)}')`,
    `('${crypto.randomUUID()}','${chatId}','${first}','assistant',${q(call)},${q(usage)},NULL,NULL,NULL,'${at(1)}')`,
    `('${crypto.randomUUID()}','${chatId}','${first}','toolResult',${q(text('sunny'))},NULL,'call_1','weather',false,'${at(2)}')`,
    `('${crypto.randomUUID()}','${chatId}','${first}','assistant',${q(text('a1'))},${q(usage)},NULL,NULL,NULL,'${at(3)}')`,
    `('${second}','${chatId}','${second}','user',${q(text('q2'))},NULL,NULL,NULL,NULL,'${at(4)}')`
  ]
  await pglite.exec(
    `INSERT INTO "message" ("id","chatId","runId","role","content","usage","toolCallId","toolName","isError","createdAt") VALUES ${rows.join(',')}`
  )
  return chatId
}

const contextOf = async (chatId: string): Promise<Context> => ({
  systemPrompt: 'system',
  messages: (await assembleContext(chatId, 100_000, 6)).messages
})

describe('assembleContext hands pi assistant messages it can read', () => {
  it("passes pi's max-token clamp on a follow-up request", async () => {
    const context = await contextOf(await seedFollowUp(USAGE))

    expect(clampMaxTokensToContext(model, context, 8192)).toBe(8192)
  })

  it('keeps the usage the row recorded', async () => {
    const { messages } = await contextOf(await seedFollowUp(USAGE))

    const assistants = messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    for (const m of assistants) expect(m.usage).toEqual(USAGE)
  })

  it('gives a row saved without usage a zero usage', async () => {
    const context = await contextOf(await seedFollowUp(null))

    const assistants = context.messages.filter((m) => m.role === 'assistant')
    for (const m of assistants) expect(m.usage.totalTokens).toBe(0)
    expect(clampMaxTokensToContext(model, context, 8192)).toBe(8192)
  })

  it('gives a row whose usage is not in pi’s shape a zero usage', async () => {
    const legacy = { promptTokens: 10, completionTokens: 5 }
    const context = await contextOf(await seedFollowUp(legacy))

    const assistants = context.messages.filter((m) => m.role === 'assistant')
    for (const m of assistants) expect(m.usage.totalTokens).toBe(0)
    expect(clampMaxTokensToContext(model, context, 8192)).toBe(8192)
  })
})

// The route puts each run's memory block before that run's question (the
// prompt cache needs it there, not in the system prompt), so it has to know
// which assembled message is which run's question.
describe('assembleContext says which message opens which run', () => {
  it('marks each run’s user message with its run, and nothing else', async () => {
    const chatId = await seedFollowUp(USAGE)
    const { messages, runHeads } = await assembleContext(chatId, 100_000, 6)

    expect(runHeads).toHaveLength(messages.length)
    const heads = messages.flatMap((m, i) =>
      runHeads[i] ? [[m.role, runHeads[i]] as const] : []
    )
    expect(heads.map(([role]) => role)).toEqual(['user', 'user'])
    // Assistant rows and tool results open nothing.
    messages.forEach((m, i) => {
      if (m.role !== 'user') expect(runHeads[i]).toBeNull()
    })
  })
})

// The context view counts compaction summaries apart from the chat's own
// messages (ISSUE-235); a summary is a user message of XML, so the assembler
// says which is which.
describe('assembleContext says which message is a summary', () => {
  it('marks a summary item and every message, parallel to messages', async () => {
    const chatId = await seedFollowUp(USAGE)
    await assembleContext(chatId, 100_000, 6) // seeds the context items
    await pglite.exec(
      `INSERT INTO "lcm_summary" ("id","chatId","kind","content","tokenCount","earliestAt","latestAt") VALUES ('sum_kinds','${chatId}','leaf','Earlier: the user asked about rain.',10,'${at(0)}','${at(0)}')`
    )
    await pglite.exec(
      `INSERT INTO "lcm_context_items" ("chatId","ordinal","kind","refId","tokenCount") VALUES ('${chatId}',-1,'summary','sum_kinds',10)`
    )

    const { messages, kinds } = await assembleContext(chatId, 100_000, 6)

    expect(kinds).toHaveLength(messages.length)
    expect(kinds).toEqual([
      'summary',
      ...messages.slice(1).map(() => 'message')
    ])
  })
})

// pi compares an assistant message's api / provider / model with the model it
// is sending to: rebuilt without them, every earlier answer looked like
// another model's, and pi turned its thinking into plain text and dropped
// its signatures (audit, 2026-10-01).
describe('assembleContext keeps who wrote each answer', () => {
  it('carries api, provider, model and stop reason onto assistant messages', async () => {
    const chatId = await seedFollowUp(USAGE)
    await pglite.exec(
      `UPDATE "message" SET "api"='anthropic-messages', "provider"='anthropic', "model"='claude-x', "stopReason"='stop' WHERE "chatId"='${chatId}' AND "role"='assistant'`
    )
    const { messages } = await assembleContext(chatId, 100_000, 6)
    const assistants = messages.filter((m) => m.role === 'assistant')
    expect(assistants.length).toBeGreaterThan(0)
    for (const m of assistants) {
      expect(m).toMatchObject({
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-x',
        stopReason: 'stop'
      })
    }
  })
})

// A chat begun with LCM off has rows and no context items. The route tracks
// the new question before it assembles, so the assembler found one item and
// never bootstrapped — the whole history was silently left out (audit,
// 2026-10-01). Tracking now seeds an untracked chat from its rows first.
describe('a chat that had LCM off keeps its history when LCM is switched on', () => {
  it('seeds the earlier runs before tracking the new question', async () => {
    const { trackContextMessages } =
      await import('@main/lib/ai/context-management')
    const chatId = await seedFollowUp(USAGE)
    const { rows } = await pglite.query<{ id: string; content: unknown }>(
      `SELECT "id","content" FROM "message" WHERE "chatId"='${chatId}' AND "role"='user' ORDER BY "createdAt" DESC LIMIT 1`
    )

    await trackContextMessages(chatId, [rows[0]])
    await trackContextMessages(chatId, [rows[0]]) // twice: still once

    const { messages } = await assembleContext(chatId, 100_000, 6)
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
      'user'
    ])
  })
})
