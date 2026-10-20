// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))

const { chatSearchKeys, useChatSearch } =
  await import('@/hooks/use-chat-search')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const DEBOUNCE_MS = 300

const result = (chatId: string, title: string) => ({
  chatId,
  title,
  matchedAt: '2026-10-14T00:00:00.000Z',
  snippets: []
})
const hits = [result('c1', 'Chat one')]
const otherHits = [result('c2', 'Chat two')]

type Harness = ReturnType<typeof useChatSearch> & {
  setQuery: (value: string) => void
}

function Probe({ onReady }: { onReady: (value: Harness) => void }) {
  const [query, setQuery] = useState('')
  onReady({ ...useChatSearch(query), setQuery })
  return null
}

async function mountSearch() {
  let latest: Harness | undefined
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe, { onReady: (value) => (latest = value) })
  )
  return {
    queryClient,
    api: () => latest!,
    type: (value: string) => {
      act(() => {
        latest!.setQuery(value)
      })
    },
    advance: async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
      // The render a timer queued only runs as `act` exits, and React Query
      // then notifies its observers from a 0 ms timer of its own.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
  }
}

describe('chatSearchKeys', () => {
  it('nests each term under the chat-search root', () => {
    expect(chatSearchKeys.all).toEqual(['chat-search'])
    expect(chatSearchKeys.term('hello')).toEqual(['chat-search', 'hello'])
  })
})

describe('useChatSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    fetcherMock.mockReset()
  })

  it('does not fetch, and returns an empty list, before anything is typed', async () => {
    const { api, advance } = await mountSearch()
    await advance(DEBOUNCE_MS * 2)

    expect(fetcherMock).not.toHaveBeenCalled()
    expect(api().data).toEqual([])
  })

  it('issues one fetch for the settled term, however many keystrokes led to it', async () => {
    fetcherMock.mockResolvedValue(hits)
    const { queryClient, api, type, advance } = await mountSearch()

    type('c')
    await advance(100)
    type('ch')
    await advance(100)
    type('chat')
    await advance(DEBOUNCE_MS - 1)
    expect(fetcherMock).not.toHaveBeenCalled()

    await advance(1)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/chat/search?query=chat')
    expect(api().data).toEqual(hits)
    expect(queryClient.getQueryData(chatSearchKeys.term('chat'))).toEqual(hits)
  })

  it('encodes the term, so &, #, % and spaces reach the server intact', async () => {
    fetcherMock.mockResolvedValue([])
    const { type, advance } = await mountSearch()

    type('a&b #c%d e')
    await advance(DEBOUNCE_MS)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/chat/search?query=a%26b%20%23c%25d%20e'
    )
  })

  it('returns an empty list the moment the input is cleared, though the cache still holds the earlier term', async () => {
    fetcherMock.mockResolvedValue(hits)
    const { queryClient, api, type, advance } = await mountSearch()
    type('chat')
    await advance(DEBOUNCE_MS)
    expect(api().data).toEqual(hits)

    type('')

    expect(api().data).toEqual([])
    expect(queryClient.getQueryData(chatSearchKeys.term('chat'))).toEqual(hits)

    await advance(DEBOUNCE_MS * 2)
    expect(api().data).toEqual([])
    expect(fetcherMock).toHaveBeenCalledTimes(1)
  })

  it('keeps each term under its own key, and shows only the current one', async () => {
    fetcherMock.mockResolvedValueOnce(hits).mockResolvedValueOnce(otherHits)
    const { queryClient, api, type, advance } = await mountSearch()

    type('one')
    await advance(DEBOUNCE_MS)
    expect(api().data).toEqual(hits)

    type('two')
    await advance(DEBOUNCE_MS)

    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(fetcherMock).toHaveBeenLastCalledWith(
      '/api/v1/chat/search?query=two'
    )
    expect(api().data).toEqual(otherHits)
    expect(queryClient.getQueryData(chatSearchKeys.term('one'))).toEqual(hits)
    expect(queryClient.getQueryData(chatSearchKeys.term('two'))).toEqual(
      otherHits
    )
  })

  it('a failed search shows no hits', async () => {
    fetcherMock.mockRejectedValue(new Error('search is down'))
    const { api, type, advance } = await mountSearch()

    type('chat')
    await advance(DEBOUNCE_MS)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(api().data).toEqual([])
  })

  it('names the term its rows answer, and says it is searching until the typed one is answered', async () => {
    const pending = Promise.withResolvers<unknown>()
    fetcherMock.mockReturnValue(pending.promise)
    const { api, type, advance } = await mountSearch()

    type('  duck ')
    expect(api().isSearching).toBe(true)
    expect(api().data).toEqual([])

    await advance(DEBOUNCE_MS)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/chat/search?query=duck')
    expect(api().isSearching).toBe(true)

    await act(async () => {
      pending.resolve(hits)
      await pending.promise
    })
    await advance(0)
    expect(api()).toMatchObject({
      data: hits,
      term: 'duck',
      isSearching: false
    })

    type('')
    expect(api()).toMatchObject({ data: [], term: '', isSearching: false })
  })
})
