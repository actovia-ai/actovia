import type { Model } from '@earendil-works/pi-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock modules that transitively import Electron
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

// Mock queries + compaction so we never hit the DB or LLM — and the database
// module itself: imported for real, it starts a PGlite whose unfinished
// boot outlives the file and rejects as an unhandled ErrnoError.
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('@main/lib/ai/context-management/queries', () => ({
  getContextItems: vi.fn(),
  appendContextItem: vi.fn()
}))
vi.mock('@main/lib/ai/context-management/compaction', () => ({
  runFullCompaction: vi.fn()
}))

import type { LcmStatusEvent } from '@main/lib/ai/context-management/lcm-status-bus'

const { lcmStatusBus } =
  await import('@main/lib/ai/context-management/lcm-status-bus')
const { LcmManager } = await import('@main/lib/ai/context-management/index')
const { runFullCompaction } =
  await import('@main/lib/ai/context-management/compaction')
const { getContextItems } =
  await import('@main/lib/ai/context-management/queries')

const fakeModel = { id: 'gpt-4.1-mini' } as unknown as Model<string>

function makeItems(count: number, perItemTokens: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `it-${i}`,
    chatId: 'chat-test',
    ordinal: i,
    kind: 'message' as const,
    refId: `msg-${i}`,
    tokenCount: perItemTokens
  }))
}

// ISSUE-235: the threshold is the chat model's window × the percent, not a
// fixed 128k — 100k of messages is far from full on a 1M model.
describe("LcmManager compacts against the model's window", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function startsAt(
    contextWindow: number,
    items = 100
  ): Promise<boolean> {
    // 100 items × 1 000 = 100 000 tokens; compaction leaves them as they are.
    vi.mocked(getContextItems).mockResolvedValue(makeItems(items, 1_000))
    vi.mocked(runFullCompaction).mockResolvedValue(undefined)
    const events: LcmStatusEvent[] = []
    const off = lcmStatusBus.subscribe('chat-test', (e) => events.push(e))
    const lcm = new LcmManager('chat-test', fakeModel, 'k', {
      contextWindow,
      contextWindowPercent: 75,
      freshTailRuns: 6
    })
    await lcm.compactAfterTurn()
    off()
    return events.some((e) => e.type === 'start')
  }

  it('does not compact 100k of messages on a 1M model', async () => {
    expect(await startsAt(1_000_000)).toBe(false)
  })

  it('compacts 100k of messages on a 128k model', async () => {
    expect(await startsAt(128_000)).toBe(true)
  })

  // 90k is under 75 % of the 128k fallback; a window of 0 taken as given
  // would compact every turn.
  it('falls back to 128k for a model with no window', async () => {
    expect(await startsAt(0, 90)).toBe(false)
  })
})

describe('LcmManager.compactAfterTurn emits status events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not emit when under threshold', async () => {
    // 10 items × 100 tokens = 1000 — well under threshold
    vi.mocked(getContextItems).mockResolvedValue(makeItems(10, 100))

    const events: LcmStatusEvent[] = []
    const off = lcmStatusBus.subscribe('chat-test', (e) => events.push(e))

    const lcm = new LcmManager('chat-test', fakeModel, 'k', {
      contextWindow: 10_000,
      contextWindowPercent: 75,
      freshTailRuns: 6
    })
    await lcm.compactAfterTurn()
    off()

    expect(events).toEqual([])
    expect(runFullCompaction).not.toHaveBeenCalled()
  })

  it('emits start then complete when over threshold', async () => {
    // First call (before): 100 items × 100 = 10000 tokens, ABOVE 75% of 10_000.
    // Subsequent calls (loop guard + after): same items but shrink each round.
    vi.mocked(getContextItems)
      .mockResolvedValueOnce(makeItems(100, 100)) // initial threshold check
      .mockResolvedValueOnce(makeItems(100, 100)) // round 0 guard
      .mockResolvedValueOnce(makeItems(20, 100)) // round 1 guard — below target
      .mockResolvedValueOnce(makeItems(20, 100)) // final "after" snapshot
    vi.mocked(runFullCompaction).mockResolvedValue(undefined)

    const events: LcmStatusEvent[] = []
    const off = lcmStatusBus.subscribe('chat-test', (e) => events.push(e))

    const lcm = new LcmManager('chat-test', fakeModel, 'k', {
      contextWindow: 10_000,
      contextWindowPercent: 75,
      freshTailRuns: 6
    })
    await lcm.compactAfterTurn()
    off()

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'start', chatId: 'chat-test' })
    expect(events[1]).toMatchObject({
      type: 'complete',
      chatId: 'chat-test',
      messagesBefore: 100,
      messagesAfter: 20
    })
    if (events[1].type === 'complete') {
      expect(events[1].tokensSaved).toBe(10000 - 2000)
      expect(events[1].durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('emits start then error when compaction throws', async () => {
    vi.mocked(getContextItems)
      .mockResolvedValueOnce(makeItems(100, 100)) // threshold check — over
      .mockResolvedValue(makeItems(100, 100))
    vi.mocked(runFullCompaction).mockRejectedValue(new Error('boom'))

    const events: LcmStatusEvent[] = []
    const off = lcmStatusBus.subscribe('chat-test', (e) => events.push(e))

    const lcm = new LcmManager('chat-test', fakeModel, 'k', {
      contextWindow: 10_000,
      contextWindowPercent: 75,
      freshTailRuns: 6
    })
    // compactAfterTurn catches errors internally — we don't expect a throw.
    await lcm.compactAfterTurn()
    off()

    expect(events[0]).toMatchObject({ type: 'start' })
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      chatId: 'chat-test',
      error: expect.stringContaining('boom')
    })
  })
})
