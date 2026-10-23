import { describe, expect, it } from 'vitest'

import { agentMemoryEntry } from '@/lib/agent-memory-entry'

describe('agentMemoryEntry', () => {
  it('a task memory reads as the task and what came of it', () => {
    expect(
      agentMemoryEntry('task:Check every claim', {
        instructions: 'Check every claim on the page ',
        outcome: ' All six claims hold.'
      })
    ).toEqual({
      title: 'Check every claim on the page',
      body: 'All six claims hold.'
    })
  })

  it('anything else keeps its key, without the task: prefix', () => {
    expect(agentMemoryEntry('task:tone', 'Plain, warm')).toEqual({
      title: 'tone',
      body: 'Plain, warm'
    })
    expect(agentMemoryEntry('prefers', { a: 1 })).toEqual({
      title: 'prefers',
      body: '{"a":1}'
    })
  })
})
