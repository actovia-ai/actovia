// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamSubscriber } from '@/lib/stream-manager'

const startStream = vi.fn()
vi.mock('@/lib/stream-manager', () => ({
  startStream: (...args: unknown[]) => startStream(...args),
  stopStream: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  isStreaming: () => false
}))

const { useChat } = await import('@/hooks/use-chat')
type Helpers = ReturnType<typeof useChat>

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let latest: Helpers

function Probe({
  prepareBody
}: {
  prepareBody: () => Record<string, unknown>
}) {
  latest = useChat({
    id: 'chat-1',
    chatTitle: 'Title',
    api: '/api/v1/chat',
    messages: [],
    prepareBody: ({ messages }) => ({ ...prepareBody(), messages })
  })
  return null
}

function assistantFrame(text: string): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input: 1, output: text.length, totalTokens: 1 + text.length },
    timestamp: 1
  } as unknown as ChatMessage
}

let root: ReturnType<typeof createRoot>

async function mount(prepareBody: () => Record<string, unknown>) {
  root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Probe, { prepareBody })))
}

beforeEach(() => {
  startStream.mockReset()
})

describe('useChat', () => {
  // `regenerate` is a prop of every assistant turn in the transcript and
  // `sendMessage` of the composer, both memoized. An identity that changes per
  // streamed frame re-renders all of them per frame — which is what happened.
  it('keeps sendMessage / regenerate / stop stable while a reply streams', async () => {
    await mount(() => ({}))
    await act(async () => latest.sendMessage({ text: 'hi' }))
    const { sendMessage, regenerate, stop, setMessages } = latest
    const subscriber = startStream.mock.calls[0][0]
      .subscriber as StreamSubscriber
    const user = latest.messages[0]

    for (const text of ['H', 'He', 'Hel', 'Hello']) {
      await act(async () => subscriber.onMessages([user, assistantFrame(text)]))
      expect(latest.sendMessage).toBe(sendMessage)
      expect(latest.regenerate).toBe(regenerate)
      expect(latest.stop).toBe(stop)
      expect(latest.setMessages).toBe(setMessages)
    }
    expect(latest.messages).toHaveLength(2)
  })

  it('still sends the live transcript and the latest prepareBody, stable identity or not', async () => {
    let tools = ['web_search']
    await mount(() => ({ advancedTools: tools }))
    await act(async () => latest.sendMessage({ text: 'first' }))
    const subscriber = startStream.mock.calls[0][0]
      .subscriber as StreamSubscriber
    await act(async () =>
      subscriber.onMessages([latest.messages[0], assistantFrame('answer')])
    )

    tools = ['terminal']
    await act(async () =>
      root.render(
        createElement(Probe, { prepareBody: () => ({ advancedTools: tools }) })
      )
    )
    await act(async () => latest.sendMessage({ text: 'second' }))

    const body = startStream.mock.calls[1][0].body as {
      advancedTools: string[]
      messages: ChatMessage[]
    }
    expect(body.advancedTools).toEqual(['terminal'])
    expect(body.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user'
    ])
  })

  it('applies a functional setMessages against the live list', async () => {
    await mount(() => ({}))
    await act(async () => latest.sendMessage({ text: 'hi' }))
    await act(async () =>
      latest.setMessages((prev) => [...prev, assistantFrame('x')])
    )
    await act(async () => latest.setMessages((prev) => prev.slice(1)))

    expect(latest.messages.map((m) => m.role)).toEqual(['assistant'])
  })

  it('regenerates the last question of a chat reopened from history', async () => {
    const history = [
      { id: 'u1', runId: 'u1', role: 'user', content: 'first', timestamp: 1 },
      assistantFrame('one'),
      {
        id: 'u2',
        runId: 'u2',
        role: 'user',
        content: [
          { type: 'text', text: 'second' },
          {
            type: 'image',
            data: 'data:image/png;base64,AA',
            mimeType: 'image/png'
          }
        ],
        timestamp: 2
      },
      assistantFrame('two')
    ] as ChatMessage[]
    function Reopened() {
      latest = useChat({
        id: 'chat-1',
        chatTitle: 'Title',
        api: '/api/v1/chat',
        messages: history
      })
      return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Reopened)))

    await act(async () => latest.regenerate())

    expect(startStream).toHaveBeenCalledTimes(1)
    const sent = latest.messages.at(-1) as ChatMessage
    expect(sent.role).toBe('user')
    expect(sent.id).not.toBe('u2')
    expect(sent.content).toEqual([
      { type: 'text', text: 'second' },
      { type: 'image', data: 'data:image/png;base64,AA', mimeType: 'image/png' }
    ])
  })

  // Regenerate groups (spec 2026-09-26). The server decides and stores the
  // states; what the hook sets here is what the screen shows until it answers.
  describe('regenerate groups', () => {
    const asked = (id: string, extra: object = {}) =>
      ({
        id,
        runId: id,
        role: 'user',
        content: 'why is the sky blue',
        timestamp: 1,
        ...extra
      }) as ChatMessage
    const answered = (runId: string, stopReason = 'stop') =>
      ({
        id: `${runId}-answer`,
        runId,
        role: 'assistant',
        content: [{ type: 'text', text: 'because' }],
        stopReason,
        timestamp: 2
      }) as unknown as ChatMessage

    async function reopen(history: ChatMessage[]) {
      function Reopened() {
        latest = useChat({
          id: 'chat-1',
          chatTitle: 'Title',
          api: '/api/v1/chat',
          messages: history
        })
        return null
      }
      root = createRoot(document.createElement('div'))
      await act(async () => root.render(createElement(Reopened)))
    }

    const states = () =>
      latest.messages
        .filter((m) => m.role === 'user')
        .map((m) => [
          m.id === latest.messages.at(-1)?.id ? 'new' : m.id,
          m.attempt ?? null
        ])
    const sentBody = () =>
      startStream.mock.calls.at(-1)![0].body as { messages: ChatMessage[] }

    it('names the run it re-asks, and compares it with the new one', async () => {
      await reopen([asked('u0'), answered('u0'), asked('g'), answered('g')])

      await act(async () => latest.regenerate())

      const sent = sentBody().messages.at(-1)!
      expect(sent).toMatchObject({ role: 'user', alternateOf: 'g' })
      expect(sent.id).not.toBe('g')
      expect(states()).toEqual([
        ['u0', null],
        ['g', 'comparing'],
        ['new', 'comparing']
      ])
    })

    it('names the group, not the attempt, when regenerating again', async () => {
      await reopen([
        asked('g', { attempt: 'comparing' }),
        answered('g'),
        asked('r1', { alternateOf: 'g', attempt: 'comparing' }),
        answered('r1')
      ])

      await act(async () => latest.regenerate())

      expect(sentBody().messages.at(-1)).toMatchObject({ alternateOf: 'g' })
      expect(states()).toEqual([
        ['g', 'hidden'],
        ['r1', 'comparing'],
        ['new', 'comparing']
      ])
    })

    it('an ordinary message sent mid-comparison keeps the newer answer', async () => {
      await reopen([
        asked('g', { attempt: 'comparing' }),
        answered('g'),
        asked('r1', { alternateOf: 'g', attempt: 'comparing' }),
        answered('r1')
      ])

      await act(async () => latest.sendMessage({ text: 'and at sunset?' }))

      const sent = sentBody().messages.at(-1)!
      expect(sent.alternateOf ?? null).toBeNull()
      expect(states()).toEqual([
        ['g', 'folded'],
        ['r1', 'chosen'],
        ['new', null]
      ])
    })

    it('leaves the messages of a chat with no group untouched', async () => {
      const history = [asked('u0'), answered('u0')]
      await reopen(history)

      await act(async () => latest.sendMessage({ text: 'next' }))

      expect(latest.messages[0]).toBe(history[0])
      expect(latest.messages[1]).toBe(history[1])
    })

    it('keeps regenerate stable while the new answer streams', async () => {
      await reopen([asked('g'), answered('g')])
      await act(async () => latest.regenerate())
      const { regenerate, sendMessage } = latest
      const subscriber = startStream.mock.calls[0][0]
        .subscriber as StreamSubscriber
      const before = latest.messages

      for (const text of ['b', 'be', 'because']) {
        await act(async () =>
          subscriber.onMessages([...before, assistantFrame(text)])
        )
        expect(latest.regenerate).toBe(regenerate)
        expect(latest.sendMessage).toBe(sendMessage)
      }
    })
  })

  it('does nothing when there is no question to repeat', async () => {
    await mount(() => ({}))
    await act(async () => latest.regenerate())
    expect(startStream).not.toHaveBeenCalled()
  })

  it('does not re-render for a frame whose usage numbers did not change', async () => {
    await mount(() => ({}))
    await act(async () => latest.sendMessage({ text: 'hi' }))
    const subscriber = startStream.mock.calls[0][0]
      .subscriber as StreamSubscriber
    const frame = [latest.messages[0], assistantFrame('same')]
    await act(async () => subscriber.onMessages(frame))
    const usageBefore = latest.lastUsage

    // Same numbers, but a freshly parsed object — as every SSE frame is.
    await act(async () =>
      subscriber.onMessages([frame[0], assistantFrame('same')])
    )
    expect(latest.lastUsage).toBe(usageBefore)
  })
})
