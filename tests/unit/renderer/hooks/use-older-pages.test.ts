// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import type { ChatPage } from '@actovia/shared/types/chat-page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchChatPage = vi.fn()
const fetchChatRow = vi.fn()
vi.mock('@/services/chat', () => ({
  fetchChatPage: (...args: unknown[]) => fetchChatPage(...args),
  fetchChatRow: (...args: unknown[]) => fetchChatRow(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('@/lib/report-error', () => ({ reportRendererError: vi.fn() }))

const { useOlderPages } = await import('@/hooks/use-older-pages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Loading a chat's history a page at a time (spec 2026-10-01 §C4): older
// runs go in front of what is shown, and what the client needs of runs it
// has not loaded — their sources, their questions — comes with each page.

const row = (id: string, runId: string, role = 'user') => ({
  id,
  runId,
  role,
  content: role === 'user' ? `question ${id}` : [{ type: 'text', text: id }],
  createdAt: '2026-10-01T00:00:00.000Z'
})

const source = (rank: number, runId: string) => ({
  rank,
  link: `https://s${rank}.example/`,
  title: `S${rank}`,
  runId
})

const page = (over: Partial<ChatPage>): ChatPage => ({
  messages: [],
  sources: [],
  questions: [],
  hasOlder: false,
  olderCursor: null,
  ...over
})

function mount(initial: ChatPage, messages: ChatMessage[]) {
  let state = messages
  const setMessages = vi.fn(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      state = typeof next === 'function' ? next(state) : next
    }
  )
  let api: ReturnType<typeof useOlderPages> | undefined
  function Probe() {
    api = useOlderPages({ chatId: 'c1', initial, setMessages })
    return null
  }
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } }
  })
  const root = createRoot(document.createElement('div'))
  act(() => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Probe))
    )
  })
  return {
    api: () => api!,
    messages: () => state,
    unmount: () => root.unmount()
  }
}

const ui = (id: string, runId: string) =>
  ({ id, runId, role: 'user', content: id, timestamp: 1 }) as ChatMessage

afterEach(() => {
  fetchChatPage.mockReset()
  fetchChatRow.mockReset()
})

describe('useOlderPages', () => {
  it('starts from the page the chat opened with', () => {
    const { api } = mount(
      page({
        messages: [row('r3', 'r3')],
        hasOlder: true,
        olderCursor: 'r3',
        sources: [source(1, 'r1'), source(2, 'r3')],
        questions: [
          { runId: 'r1', text: 'one', createdAt: 1 },
          { runId: 'r3', text: 'three', createdAt: 3 }
        ]
      }),
      [ui('r3', 'r3')]
    )
    expect(api().hasOlder).toBe(true)
    // Of the runs not loaded: their sources (for citations) and questions
    // (for the outline).
    expect(api().olderSources.map((s) => s.rank)).toEqual([1])
    expect(api().olderSources[0]).toMatchObject({ content: '', snippet: '' })
    expect(api().olderQuestions.map((q) => q.runId)).toEqual(['r1'])
    expect(api().historyIds.has('r3')).toBe(true)
  })

  it('puts an older page in front of what is shown', async () => {
    fetchChatPage.mockResolvedValue(
      page({
        messages: [row('r2', 'r2'), row('a2', 'r2', 'assistant')],
        hasOlder: false,
        olderCursor: null,
        sources: [source(1, 'r2')],
        questions: [{ runId: 'r2', text: 'two', createdAt: 2 }]
      })
    )
    const { api, messages } = mount(
      page({ hasOlder: true, olderCursor: 'r3', messages: [row('r3', 'r3')] }),
      [ui('r3', 'r3')]
    )
    await act(async () => {
      await api().loadOlder()
    })
    expect(fetchChatPage).toHaveBeenCalledWith('c1', {
      before: 'r3',
      through: undefined
    })
    expect(messages().map((m) => m.id)).toEqual(['r2', 'a2', 'r3'])
    expect(api().hasOlder).toBe(false)
    expect(api().olderSources).toEqual([])
    // Older runs are history, not fresh: they do not animate in.
    expect(api().historyIds.has('a2')).toBe(true)
  })

  it('reaches back through a run picked in the outline', async () => {
    fetchChatPage.mockResolvedValue(page({ messages: [row('r1', 'r1')] }))
    const { api } = mount(page({ hasOlder: true, olderCursor: 'r3' }), [])
    await act(async () => {
      await api().loadOlder('r1')
    })
    expect(fetchChatPage).toHaveBeenCalledWith('c1', {
      before: 'r3',
      through: 'r1'
    })
  })

  it('does nothing when there is nothing older', async () => {
    const { api } = mount(page({}), [])
    await act(async () => {
      await api().loadOlder()
    })
    expect(fetchChatPage).not.toHaveBeenCalled()
  })

  // A row too large for a page comes cut; the whole row replaces it.
  it('replaces a cut row with the whole one', async () => {
    fetchChatRow.mockResolvedValue({
      ...row('a3', 'r3', 'assistant'),
      content: [{ type: 'text', text: 'the whole answer' }]
    })
    const cut = {
      ...row('a3', 'r3', 'assistant'),
      content: [{ type: 'text', text: 'the who…' }],
      truncated: true
    }
    const { messages } = mount(page({ messages: [row('r3', 'r3'), cut] }), [
      ui('r3', 'r3'),
      {
        id: 'a3',
        runId: 'r3',
        role: 'assistant',
        content: [{ type: 'text', text: 'the who…' }]
      } as unknown as ChatMessage
    ])
    await act(async () => {
      await vi.waitFor(() =>
        expect((messages()[1].content as { text: string }[])[0].text).toBe(
          'the whole answer'
        )
      )
    })
    expect(fetchChatRow).toHaveBeenCalledWith('c1', 'a3')
  })
})
