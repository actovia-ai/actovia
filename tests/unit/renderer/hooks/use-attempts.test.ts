// @vitest-environment happy-dom
import type { Attempt, ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const chooseAttempt = vi.fn()
vi.mock('@/services/chat', () => ({
  chooseAttempt: (...args: unknown[]) => chooseAttempt(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))

const { useChooseAttempt } = await import('@/hooks/use-attempts')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const asked = (id: string, attempt: Attempt, alternateOf?: string) =>
  ({
    id,
    runId: id,
    role: 'user',
    content: 'q',
    timestamp: 1,
    attempt,
    ...(alternateOf ? { alternateOf } : {})
  }) as ChatMessage

/** A chat's message list, as `useChat().setMessages` keeps it. */
function chatOf(initial: ChatMessage[]) {
  let messages = initial
  return {
    get states() {
      return Object.fromEntries(messages.map((m) => [m.id, m.attempt ?? null]))
    },
    setMessages: (
      next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
    ) => {
      messages = typeof next === 'function' ? next(messages) : next
    }
  }
}

type Api = ReturnType<typeof useChooseAttempt>

/**
 * The hook, mounted on `chat`. Every mount has its own holder: an earlier
 * test's component is still there and renders again when its request
 * settles, and must not be what a later test talks to.
 */
async function mount(chat: ReturnType<typeof chatOf>) {
  const held: { api?: Api } = {}
  function Probe() {
    held.api = useChooseAttempt('chat-1', chat.setMessages)
    return null
  }
  await renderWithQueryClient(createElement(Probe))
  return {
    get choose() {
      return held.api!.choose
    }
  }
}

/** A request the test settles by hand. */
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The mutation runs a tick after `choose`; the choice itself does not wait. */
const requested = () =>
  vi.waitFor(() => expect(chooseAttempt).toHaveBeenCalled())

afterEach(() => {
  chooseAttempt.mockReset()
})

describe('useChooseAttempt', () => {
  it('shows the choice at once, then takes the states the server stored', async () => {
    const chat = chatOf([
      asked('g', 'comparing'),
      asked('r1', 'comparing', 'g')
    ])
    const request = pending<{ attempts: Record<string, Attempt> }>()
    chooseAttempt.mockReturnValue(request.promise)
    const api = await mount(chat)

    await act(async () => api.choose('r1'))

    expect(chat.states).toEqual({ g: 'folded', r1: 'chosen' })
    await requested()
    expect(chooseAttempt).toHaveBeenCalledWith('chat-1', 'r1')

    // What the server stored wins, whatever was shown meanwhile.
    await act(async () =>
      request.resolve({ attempts: { g: 'chosen', r1: 'folded' } })
    )
    await vi.waitFor(() =>
      expect(chat.states).toEqual({ g: 'chosen', r1: 'folded' })
    )
  })

  it('keeps the states of the chat’s other groups when the answer names one group', async () => {
    const chat = chatOf([
      asked('g', 'chosen'),
      asked('r1', 'folded', 'g'),
      asked('h', 'comparing'),
      asked('s1', 'comparing', 'h')
    ])
    chooseAttempt.mockResolvedValue({
      attempts: { h: 'chosen', s1: 'folded' }
    })
    const api = await mount(chat)

    await act(async () => api.choose('h'))
    await requested()
    await act(async () => {})

    expect(chat.states).toEqual({
      g: 'chosen',
      r1: 'folded',
      h: 'chosen',
      s1: 'folded'
    })
  })

  it('puts the states back when the server refuses', async () => {
    const chat = chatOf([
      asked('g', 'comparing'),
      asked('r1', 'comparing', 'g')
    ])
    const request = pending<never>()
    chooseAttempt.mockReturnValue(request.promise)
    const api = await mount(chat)

    await act(async () => api.choose('g'))
    expect(chat.states).toEqual({ g: 'chosen', r1: 'folded' })
    await requested()

    await act(async () => request.reject(new Error('locked')))
    await vi.waitFor(() =>
      expect(chat.states).toEqual({ g: 'comparing', r1: 'comparing' })
    )
  })

  it('sends one request for two quick clicks', async () => {
    const chat = chatOf([
      asked('g', 'comparing'),
      asked('r1', 'comparing', 'g')
    ])
    const request = pending<{ attempts: Record<string, Attempt> }>()
    chooseAttempt.mockReturnValue(request.promise)
    const api = await mount(chat)

    await act(async () => {
      api.choose('g')
      api.choose('r1')
    })
    await requested()
    await act(async () => {})

    expect(chooseAttempt).toHaveBeenCalledTimes(1)
    expect(chat.states).toEqual({ g: 'chosen', r1: 'folded' })
    await act(async () =>
      request.resolve({ attempts: { g: 'chosen', r1: 'folded' } })
    )
  })

  it('keeps `choose` the same function across renders', async () => {
    const chat = chatOf([
      asked('g', 'comparing'),
      asked('r1', 'comparing', 'g')
    ])
    chooseAttempt.mockResolvedValue({
      attempts: { g: 'chosen', r1: 'folded' }
    })
    const api = await mount(chat)
    const { choose } = api

    await act(async () => api.choose('g'))

    expect(api.choose).toBe(choose)
  })
})
