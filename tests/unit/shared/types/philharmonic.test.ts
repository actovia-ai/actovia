import {
  CONVERSATION_MESSAGE_ROLES,
  type PhilharmonicSseEvent
} from '@actovia/shared/types/philharmonic'
// src/shared/types/philharmonic.test.ts
import { describe, expect, it } from 'vitest'

describe('philharmonic shared types', () => {
  it('lists the four conversation roles', () => {
    expect(CONVERSATION_MESSAGE_ROLES).toEqual([
      'user',
      'pm',
      'employee',
      'system'
    ])
  })

  it('accepts the new conversation SSE events (compile-time)', () => {
    const events: PhilharmonicSseEvent[] = [
      {
        type: 'message_start',
        conversationId: 'c',
        role: 'employee',
        agentId: 'a',
        messageId: 'm'
      },
      {
        type: 'message_delta',
        conversationId: 'c',
        messageId: 'm',
        delta: 'hi'
      },
      { type: 'message_end', conversationId: 'c', messageId: 'm' },
      { type: 'member_joined', conversationId: 'c', agentId: 'a' },
      { type: 'round_start', conversationId: 'c', label: '[定时] X' }
    ]
    expect(events).toHaveLength(5)
  })
})
