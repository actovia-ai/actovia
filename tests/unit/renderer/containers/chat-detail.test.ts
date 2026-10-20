// @vitest-environment happy-dom
// A chat reopened from history is seeded once, when <Chat> mounts — so what
// it is seeded with has to be what the database holds now, not what this
// window fetched the last time the chat was open: runs sent since, and the
// state of a regenerate group, would be missing until a reload. It opens on
// its newest page (spec 2026-10-01 §C3).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', () => ({
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }))
const fetchChatPage = vi.fn()
vi.mock('@/services/chat', () => ({
  deleteChat: vi.fn(),
  updateChat: vi.fn(),
  fetchChatPage: (...args: unknown[]) => fetchChatPage(...args)
}))

// What <Chat> was mounted with, per mount.
const mounts: string[][] = []
vi.mock('@/components/chat/chat', async () => {
  const { useState } = await import('react')
  return {
    Chat: ({ initialMessages }: { initialMessages: Array<{ id: string }> }) => {
      // Seeded once, like `useChat`.
      const [seed] = useState(() => initialMessages.map((m) => m.id))
      if (mounts.at(-1) !== seed) mounts.push(seed)
      return createElement('div', { 'data-chat': seed.join(',') })
    }
  }
})

const { ChatDetail } = await import('@/containers/chat-detail')
const { historyKeys } = await import('@/hooks/use-chat-history')

const CHAT = '5b30d978-ebe8-4da6-9e73-02c6fc42b771'
const pageOf = (messages: unknown[]) => ({
  messages,
  sources: [],
  questions: [],
  hasOlder: false,
  olderCursor: null
})
const row = (id: string) => ({
  id,
  chatId: CHAT,
  runId: id,
  role: 'user',
  content: [{ type: 'text', text: 'q' }],
  createdAt: '2026-01-01T00:00:00.000Z'
})

/** A request the test settles by hand. */
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let queryClient: QueryClient

async function open() {
  const router = createMemoryRouter(
    [{ path: '/chat/:id', Component: ChatDetail }],
    { initialEntries: [`/chat/${CHAT}`] }
  )
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router })
      )
    )
  )
}

beforeEach(() => {
  mounts.length = 0
  fetcherMock.mockReset()
  fetcherMock.mockResolvedValue([])
  fetchChatPage.mockReset()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('<ChatDetail>', () => {
  it('seeds the chat with what the database holds now, not with what it fetched before', async () => {
    // The last visit's fetch: one run. One more has been sent since.
    queryClient.setQueryData(historyKeys.page(CHAT), pageOf([row('u1')]))
    const messages = pending<unknown>()
    fetchChatPage.mockImplementation((id: string) =>
      id === CHAT ? messages.promise : Promise.resolve(pageOf([]))
    )

    await open()
    // Nothing is seeded from the stale copy while the fresh one is on its way.
    expect(mounts).toEqual([])

    await act(async () => messages.resolve(pageOf([row('u1'), row('u2')])))

    await vi.waitFor(() => expect(mounts).toEqual([['u1', 'u2']]))
    expect(host.querySelector('[data-chat]')?.dataset.chat).toBe('u1,u2')
  })

  it('seeds a chat opened for the first time as soon as its messages arrive', async () => {
    fetchChatPage.mockResolvedValue(pageOf([row('u1')]))

    await open()
    await vi.waitFor(() => expect(mounts).toEqual([['u1']]))
  })
})
