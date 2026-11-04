import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const {
  appendRoundEvent,
  getLatestPmContextSnapshot,
  listRoundEvents,
  lastRoundStartedAt
} = await import('@main/lib/db/pm-round-queries')

const G1 = '00000000-0000-0000-0000-000000000001'
const G2 = '00000000-0000-0000-0000-000000000002'
const R1 = '00000000-0000-0000-0000-0000000000a1'
const R2 = '00000000-0000-0000-0000-0000000000a2'

afterAll(async () => {
  await pglite.close()
})

describe('pm round queries', () => {
  it('lists events in seq order, scoped to the group and round', async () => {
    await pglite.exec(
      `INSERT INTO conversation (id, title) VALUES ('${G1}','A'), ('${G2}','B')`
    )
    await appendRoundEvent({
      conversationId: G1,
      roundId: R1,
      seq: 2,
      kind: 'text',
      payload: { text: 'c' }
    })
    await appendRoundEvent({
      conversationId: G1,
      roundId: R1,
      seq: 0,
      kind: 'input',
      payload: { text: 'a' }
    })
    await appendRoundEvent({
      conversationId: G1,
      roundId: R1,
      seq: 1,
      kind: 'thinking',
      payload: { text: 'b' }
    })
    expect((await listRoundEvents(G1, R1)).map((e) => e.seq)).toEqual([0, 1, 2])
    expect(await listRoundEvents(G2, R1)).toEqual([])
    expect(await listRoundEvents(G1, R2)).toEqual([])
  })

  it('lastRoundStartedAt is the newest input event, null without one', async () => {
    expect(await lastRoundStartedAt(G2)).toBeNull()
    await appendRoundEvent({
      conversationId: G1,
      roundId: R2,
      seq: 0,
      kind: 'input',
      payload: {}
    })
    const [second] = await listRoundEvents(G1, R2)
    expect(await lastRoundStartedAt(G1)).toEqual(second.createdAt)
  })

  it('reads the newest validated PM context snapshot for its conversation', async () => {
    const snapshot = {
      takenAt: '2026-11-02T10:00:00.000Z',
      roundId: R1,
      model: 'gpt-test',
      contextWindow: 128_000,
      compactAt: 96_000,
      lcmTokens: 42,
      total: 100,
      estimated: true,
      parts: [
        { key: 'system', tokens: 10 },
        { key: 'skills', tokens: 0 },
        { key: 'mcp', tokens: 0 },
        { key: 'tools', tokens: 10 },
        { key: 'memory', tokens: 0 },
        { key: 'summaries', tokens: 20 },
        { key: 'messages', tokens: 60 }
      ]
    }
    await appendRoundEvent({
      conversationId: G1,
      roundId: R1,
      seq: 10,
      kind: 'context',
      payload: snapshot
    })
    expect(await getLatestPmContextSnapshot(G1)).toEqual(snapshot)
    expect(await getLatestPmContextSnapshot(G2)).toBeNull()
  })

  it('does not expose malformed context event payloads', async () => {
    await appendRoundEvent({
      conversationId: G1,
      roundId: R2,
      seq: 0,
      kind: 'context',
      payload: { model: 'gpt-test' }
    })
    expect(await getLatestPmContextSnapshot(G1)).toBeNull()
  })
})
