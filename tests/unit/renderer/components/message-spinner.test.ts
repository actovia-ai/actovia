import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import { shouldShowMessageSpinner } from '@/components/chat/message-spinner'
import { groupIntoSegments } from '@/components/chat/messages'

const user = (id: string): ChatMessage => ({
  id,
  role: 'user',
  content: 'hello',
  timestamp: 1
})

const assistant = (id: string, content: unknown): ChatMessage =>
  ({ id, role: 'assistant', content, timestamp: 2 }) as ChatMessage

describe('shouldShowMessageSpinner', () => {
  it('shows right after submit (only a user message)', () => {
    const segments = groupIntoSegments([user('u1')])
    expect(shouldShowMessageSpinner(segments, true)).toBe(true)
  })

  it('keeps showing while pi-ai has only emitted an empty assistant message', () => {
    // The gap the fix targets: stream opened, no content yet.
    const segments = groupIntoSegments([
      user('u1'),
      assistant('a1', []),
      assistant('a2', [{ type: 'text', text: '' }])
    ])
    expect(segments.at(-1)?.type).toBe('user')
    expect(shouldShowMessageSpinner(segments, true)).toBe(true)
  })

  it('hides once streamed text appears', () => {
    const segments = groupIntoSegments([
      user('u1'),
      assistant('a1', [{ type: 'text', text: 'Here is' }])
    ])
    expect(shouldShowMessageSpinner(segments, true)).toBe(false)
  })

  it('hides once a tool call appears', () => {
    const segments = groupIntoSegments([
      user('u1'),
      assistant('a1', [
        { type: 'toolCall', id: 'c1', name: 'web_search', arguments: {} }
      ])
    ])
    expect(shouldShowMessageSpinner(segments, true)).toBe(false)
  })

  it('hides once a thinking block has real content', () => {
    const segments = groupIntoSegments([
      user('u1'),
      assistant('a1', [{ type: 'thinking', thinking: 'Let me consider…' }])
    ])
    expect(shouldShowMessageSpinner(segments, true)).toBe(false)
  })

  it('leaves the waiting to the comparison when a regenerate is in flight', () => {
    // The new answer has not started: its column waits, not the list.
    const segments = groupIntoSegments([
      { ...user('g'), runId: 'g', attempt: 'comparing' } as ChatMessage,
      {
        ...assistant('a1', [{ type: 'text', text: 'first' }]),
        runId: 'g'
      } as ChatMessage,
      {
        ...user('r1'),
        runId: 'r1',
        alternateOf: 'g',
        attempt: 'comparing'
      } as ChatMessage
    ])
    expect(segments.at(-1)?.type).toBe('compare')
    expect(shouldShowMessageSpinner(segments, true)).toBe(false)
  })

  it('never shows when not loading', () => {
    const segments = groupIntoSegments([user('u1')])
    expect(shouldShowMessageSpinner(segments, false)).toBe(false)
  })
})
