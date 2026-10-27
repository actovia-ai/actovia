import type { ChatContextSnapshot } from '@actovia/shared/types/chat-context'
import { describe, expect, it } from 'vitest'

import { contextMeter } from '@/lib/context-meter'

function snapshot(
  over: Partial<ChatContextSnapshot> = {}
): ChatContextSnapshot {
  return {
    takenAt: '2026-10-27T10:00:00.000Z',
    runId: 'r1',
    model: 'm',
    contextWindow: 1_000_000,
    compactAt: 750_000,
    total: 586_300,
    estimated: false,
    parts: [
      { key: 'system', tokens: 6_300 },
      { key: 'skills', tokens: 0 },
      { key: 'mcp', tokens: 0 },
      { key: 'tools', tokens: 20_000 },
      { key: 'memory', tokens: 0 },
      { key: 'summaries', tokens: 60_000 },
      { key: 'messages', tokens: 500_000 }
    ],
    ...over
  }
}

const withConversation = (n: number) =>
  snapshot({
    parts: snapshot().parts.map((p) =>
      p.key === 'summaries'
        ? { ...p, tokens: 0 }
        : p.key === 'messages'
          ? { ...p, tokens: n }
          : p
    )
  })

describe('contextMeter', () => {
  it('reads the share of the window and what is left', () => {
    const m = contextMeter(snapshot())
    expect(m.percent).toBeCloseTo(58.63, 2)
    expect(m.free).toBe(413_700)
    expect(m.compactPercent).toBe(75)
    expect(m.rows.map((r) => r.key)).toEqual([
      'system',
      'skills',
      'mcp',
      'tools',
      'memory',
      'summaries',
      'messages'
    ])
    expect(m.rows.find((r) => r.key === 'messages')?.share).toBeCloseTo(50, 5)
  })

  it('is past compaction once summaries and messages reach the mark', () => {
    expect(contextMeter(withConversation(700_000)).pastCompaction).toBe(false)
    expect(contextMeter(withConversation(760_000)).pastCompaction).toBe(true)
  })

  it('has no share without a window', () => {
    const m = contextMeter(snapshot({ contextWindow: 0, compactAt: null }))
    expect(m.percent).toBeNull()
    expect(m.free).toBeNull()
    expect(m.compactPercent).toBeNull()
    expect(m.rows.every((r) => r.share === null)).toBe(true)
  })

  it('is never past a compaction that is off', () => {
    const m = contextMeter(snapshot({ compactAt: null, total: 990_000 }))
    expect(m.pastCompaction).toBe(false)
    expect(m.compactPercent).toBeNull()
  })
})
