// @vitest-environment happy-dom
import type { ChatMessage, ChatSseEvent } from '@actovia/shared/types/chat'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('sileo', () => ({
  sileo: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))

const { isStreaming, startStream } = await import('@/lib/stream-manager')

function sseResponse(events: ChatSseEvent[]) {
  const encoder = new TextEncoder()
  const chunks = events.map((e) =>
    encoder.encode(`data: ${JSON.stringify(e)}\n\n`)
  )
  let i = 0
  const reader = {
    read: vi.fn(async () =>
      i < chunks.length
        ? { done: false, value: chunks[i++] }
        : { done: true, value: undefined }
    ),
    cancel: vi.fn(async () => {})
  }
  return {
    ok: true,
    body: { getReader: () => reader },
    headers: { get: () => null },
    json: async () => ({})
  } as unknown as Response
}

const user = (id: string, extra: object = {}) =>
  ({
    id,
    runId: id,
    role: 'user',
    content: id,
    timestamp: 1,
    ...extra
  }) as ChatMessage
const answer = (id: string, runId: string) =>
  ({
    id,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text: id }],
    timestamp: 2
  }) as ChatMessage

afterEach(() => {
  vi.unstubAllGlobals()
})

async function finish(initial: ChatMessage[], done: ChatSseEvent) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([done])))
  const onFinish = vi.fn()
  startStream({
    chatId: 'chat-1',
    chatTitle: 'Chat',
    api: '/api/v1/chat',
    body: {},
    initialMessages: initial,
    subscriber: {
      onMessages: vi.fn(),
      onStatus: vi.fn(),
      onTitle: vi.fn(),
      onError: vi.fn(),
      onFinish
    }
  })
  await vi.waitFor(() => expect(isStreaming('chat-1')).toBe(false))
  return onFinish.mock.calls[0][0] as ChatMessage[]
}

// Protocol 2 (spec 2026-10-01 §C2): `done` brings the run and the regenerate
// states; the conversation the client already holds stays where it is.
describe('stream-manager: done', () => {
  it('merges a protocol-2 done into the conversation it already holds', async () => {
    const earlier = answer('a1', 'u1')
    const messages = await finish([user('u1'), earlier, user('u2')], {
      type: 'done',
      messages: [user('u2', { timestamp: 9 }), answer('a2', 'u2')],
      attempts: {}
    })
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(messages[1]).toBe(earlier)
  })

  it('still takes a whole conversation from a done without attempts', async () => {
    const messages = await finish([user('u2')], {
      type: 'done',
      messages: [user('u1'), answer('a1', 'u1'), user('u2'), answer('a2', 'u2')]
    })
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })
})
