import type {
  ChatAssistantMessage,
  ChatUserMessage
} from '@actovia/shared/types/chat'
import {
  stripId,
  toDbRow,
  withRunId
} from '@main/lib/server/routes/chat-persistence'
import { describe, expect, it } from 'vitest'

const RUN_ID = '11111111-1111-4111-8111-111111111111'

const user: ChatUserMessage = {
  id: RUN_ID,
  runId: RUN_ID,
  role: 'user',
  content: 'hi',
  timestamp: 1
}

const assistant: ChatAssistantMessage = {
  id: '22222222-2222-4222-8222-222222222222',
  runId: RUN_ID,
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'm',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  stopReason: 'stop',
  timestamp: 2
}

describe('chat persistence', () => {
  it('toDbRow carries runId on every role', () => {
    expect(toDbRow(user, 'c').runId).toBe(RUN_ID)
    expect(toDbRow(assistant, 'c').runId).toBe(RUN_ID)
    expect(
      toDbRow(
        {
          id: '33333333-3333-4333-8333-333333333333',
          runId: RUN_ID,
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'weather',
          content: [],
          details: null,
          isError: false,
          timestamp: 3
        },
        'c'
      ).runId
    ).toBe(RUN_ID)
  })

  it('withRunId stamps a copy, leaving the original alone', () => {
    const stamped = withRunId({ ...assistant, runId: '' }, RUN_ID)
    expect(stamped.runId).toBe(RUN_ID)
    expect(stamped).not.toBe(assistant)
  })

  it('stripId removes both the id and the runId for the model', () => {
    const forModel = stripId(user)
    expect(forModel).not.toHaveProperty('id')
    expect(forModel).not.toHaveProperty('runId')
    expect(forModel).toMatchObject({ role: 'user', content: 'hi' })
  })
})
