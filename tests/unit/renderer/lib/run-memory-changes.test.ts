import type { ChatMessage } from '@actovia/shared/types/chat'
import type { MemoryChange } from '@actovia/shared/types/memory'
import { describe, expect, it } from 'vitest'

import { runMemoryChanges } from '@/lib/run-memory-changes'

const change = (id: string, key: string): MemoryChange => ({
  op: 'update',
  id,
  before: {
    section: 'topic',
    key,
    summary: 'old',
    details: [],
    isActive: true
  },
  after: {
    section: 'topic',
    key,
    summary: 'new',
    details: [],
    isActive: true
  }
})

const call = (id: string, name = 'update_memory', stopReason = 'toolUse') =>
  ({
    id: `a-${id}`,
    runId: 'u1',
    role: 'assistant',
    stopReason,
    content: [{ type: 'toolCall', id, name, arguments: { instruction: 'x' } }],
    timestamp: 2
  }) as unknown as ChatMessage

const result = (
  toolCallId: string,
  changes: MemoryChange[],
  { isError = false, toolName = 'update_memory' } = {}
) =>
  ({
    id: `r-${toolCallId}`,
    runId: 'u1',
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    details: isError ? undefined : { changes },
    isError,
    timestamp: 3
  }) as unknown as ChatMessage

const user = {
  id: 'u1',
  runId: 'u1',
  role: 'user',
  content: 'hi',
  timestamp: 1
} as unknown as ChatMessage

describe('runMemoryChanges', () => {
  it('is empty for a run that never called update_memory', () => {
    expect(
      runMemoryChanges([
        user,
        call('c1', 'web_search'),
        result('c1', [], { toolName: 'web_search' })
      ])
    ).toEqual({ running: false, failed: false, changes: [] })
    expect(runMemoryChanges([])).toEqual({
      running: false,
      failed: false,
      changes: []
    })
  })

  it('is running while a call has no result yet', () => {
    expect(runMemoryChanges([user, call('c1')])).toEqual({
      running: true,
      failed: false,
      changes: []
    })
  })

  it('is not running when the message holding the call was aborted', () => {
    expect(
      runMemoryChanges([user, call('c1', 'update_memory', 'aborted')])
    ).toMatchObject({ running: false })
  })

  it('collects every call’s changes in call order', () => {
    const a = change('m1', 'Work setup')
    const b = change('m2', 'Old address')
    const c = change('m3', 'Pets')
    expect(
      runMemoryChanges([
        user,
        call('c1'),
        result('c1', [a, b]),
        call('c2'),
        result('c2', [c])
      ])
    ).toEqual({ running: false, failed: false, changes: [a, b, c] })
  })

  it('is failed when a call’s result is an error', () => {
    expect(
      runMemoryChanges([user, call('c1'), result('c1', [], { isError: true })])
    ).toEqual({ running: false, failed: true, changes: [] })
  })

  it('tolerates a result whose details carry no changes', () => {
    const bad = {
      ...(result('c1', []) as object),
      details: undefined
    } as unknown as ChatMessage
    expect(runMemoryChanges([user, call('c1'), bad])).toEqual({
      running: false,
      failed: false,
      changes: []
    })
  })
})
