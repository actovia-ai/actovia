import { randomUUID } from 'crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ISSUE-132: the Costs page counts the PM's own rounds — one `usage` event
// per round, its tokens with the cache, from a given moment on.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const { pglite, db } = await import('@main/lib/db/db')
const { conversation, pmRoundEvent } = await import('@main/lib/db/schema')
const { getPmCostRows } = await import('@main/lib/db/pm-round-queries')

afterAll(async () => {
  await pglite.close()
})

let conversationId: string
beforeEach(async () => {
  await db.delete(pmRoundEvent)
  await db.delete(conversation)
  conversationId = randomUUID()
  await db.insert(conversation).values({ id: conversationId, title: 'G' })
})

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12))

async function event(
  kind: 'usage' | 'text',
  payload: Record<string, unknown>,
  createdAt: Date
) {
  await db.insert(pmRoundEvent).values({
    conversationId,
    roundId: randomUUID(),
    seq: 0,
    kind,
    payload,
    createdAt
  })
}

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 300,
  cacheWriteTokens: 50,
  costUsd: 0.012
}

describe('getPmCostRows', () => {
  it('reads each round’s usage, cache in its tokens', async () => {
    await event('usage', usage, day(10))
    await event('text', { text: 'hi' }, day(10))

    const rows = await getPmCostRows()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ conversationId, tokens: 470 })
    expect(rows[0].cost).toBeCloseTo(0.012)
    expect(rows[0].createdAt).toEqual(day(10))
  })

  it('keeps to the period asked for', async () => {
    await event('usage', usage, day(1))
    await event('usage', usage, day(20))

    expect(await getPmCostRows(day(15))).toHaveLength(1)
  })
})
