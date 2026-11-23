import { orderMessagesByRun } from '@actovia/shared/utils/run-order'
import { describe, expect, it } from 'vitest'

const question = (id: string) => ({ id, runId: id, role: 'user' })
const answer = (id: string, runId: string) => ({ id, runId, role: 'assistant' })

describe('orderMessagesByRun', () => {
  it('restores a question stamped after its own answer without dropping rows', () => {
    const rows = [
      question('u1'),
      answer('a1', 'u1'),
      answer('a2', 'u2'),
      question('u2')
    ]
    const ordered = orderMessagesByRun(rows)
    expect(ordered.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(ordered[3]).toBe(rows[2])
  })

  it('orders runs by their questions, keeping interleaved answer and tool rows together', () => {
    const rows = [
      answer('a2', 'u2'),
      question('u1'),
      question('u2'),
      answer('a1', 'u1'),
      { id: 't2', runId: 'u2', role: 'toolResult' }
    ]
    expect(orderMessagesByRun(rows).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      't2'
    ])
  })

  it('preserves orphan runs, regenerate questions and an already ordered transcript', () => {
    const rows = [
      answer('orphan', 'missing'),
      question('u1'),
      answer('a1', 'u1'),
      { ...question('u2'), alternateOf: 'u1' },
      answer('a2', 'u2')
    ]
    expect(orderMessagesByRun(rows)).toEqual(rows)
    expect(orderMessagesByRun([])).toEqual([])
  })
})
