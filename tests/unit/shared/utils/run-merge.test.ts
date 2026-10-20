import type { ChatMessage } from '@actovia/shared/types/chat'
import { mergeRun } from '@actovia/shared/utils/run-merge'
import { describe, expect, it } from 'vitest'

const user = (id: string, extra: object = {}): ChatMessage =>
  ({
    id,
    runId: id,
    role: 'user',
    content: id,
    timestamp: 1,
    ...extra
  }) as ChatMessage
const answer = (id: string, runId: string, text: string): ChatMessage =>
  ({
    id,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2
  }) as ChatMessage

// Protocol 2 (spec 2026-10-01 §C2): `done` carries the run as stored and the
// regenerate states, not the whole conversation; the client merges.
describe('mergeRun', () => {
  it('replaces the run’s streamed copies with the stored run, in place', () => {
    const local = [
      user('u1'),
      answer('a1', 'u1', 'old answer'),
      user('u2'),
      answer('tmp', 'u2', 'streamed so fa')
    ]
    const run = [user('u2', { timestamp: 99 }), answer('a2', 'u2', 'final')]
    expect(mergeRun(local, run, {}).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2'
    ])
    expect(mergeRun(local, run, {})[2].timestamp).toBe(99)
  })

  it('keeps every earlier message as it was', () => {
    const earlier = answer('a1', 'u1', 'old answer')
    const merged = mergeRun(
      [user('u1'), earlier, user('u2')],
      [user('u2'), answer('a2', 'u2', 'x')],
      {}
    )
    expect(merged[1]).toBe(earlier)
  })

  it('applies the stored regenerate states to every run', () => {
    const merged = mergeRun(
      [
        user('u1', { attempt: 'comparing' }),
        answer('a1', 'u1', 'x'),
        user('u2')
      ],
      [
        user('u2', { alternateOf: 'u1', attempt: 'comparing' }),
        answer('a2', 'u2', 'y')
      ],
      { u1: 'folded', u2: 'chosen' }
    )
    expect(
      merged
        .filter((m) => m.role === 'user')
        .map((m) => [m.id, (m as { attempt?: string }).attempt])
    ).toEqual([
      ['u1', 'folded'],
      ['u2', 'chosen']
    ])
  })

  it('appends a run the client had not shown yet', () => {
    const merged = mergeRun(
      [user('u1')],
      [user('u2'), answer('a2', 'u2', 'x')],
      {}
    )
    expect(merged.map((m) => m.id)).toEqual(['u1', 'u2', 'a2'])
  })
})
