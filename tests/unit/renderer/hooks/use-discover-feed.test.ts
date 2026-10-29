// @vitest-environment happy-dom
import type { DiscoverFeedDto } from '@actovia/shared/types/discover'
import {
  focusManager,
  type QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getDiscoverFeedService = vi.fn()
const refreshDiscoverFeedService = vi.fn()
vi.mock('@/services/discover', () => ({
  getDiscoverFeed: (...args: unknown[]) => getDiscoverFeedService(...args),
  refreshDiscoverFeed: (...args: unknown[]) =>
    refreshDiscoverFeedService(...args)
}))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    error: (...args: unknown[]) => toastError(...args)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const { discoverKeys, useDiscoverFeed, useRefreshDiscoverFeed } =
  await import('@/hooks/use-discover-feed')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (value: T, rerender: () => void) => void
}) {
  const [, setTick] = useState(0)
  onReady(hook(), () => setTick((n) => n + 1))
  return null
}

// Every mounted client listens to the one global focusManager, and a polling
// observer keeps its interval until it unmounts: a root left mounted would
// answer a later test's focus toggles and timers with requests of its own.
const mounted: Array<() => Promise<void>> = []

// The app's own client, so a failing write goes through the real
// `mutationCache.onError` and `refetchOnWindowFocus` is off unless the hook
// turns it on. Retries off so a failed read lands without a backoff.
async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
  let rerender!: () => void
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe<T>, {
          hook,
          onReady: (value, next) => {
            latest = value
            rerender = next
          }
        })
      )
    )
  })
  mounted.push(async () => {
    await act(async () => {
      root.unmount()
    })
  })
  return {
    queryClient,
    api: () => latest!,
    rerender: async () => {
      await act(async () => {
        rerender()
      })
    }
  }
}

const cachedFeed = (queryClient: QueryClient) =>
  queryClient.getQueryData<DiscoverFeedDto>(discoverKeys.feed)

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// React Query tells its observers through a `setTimeout(0)`, so a change (or
// the absence of one) only shows a macrotask after the request settled.
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const feedOf = (overrides: Partial<DiscoverFeedDto> = {}): DiscoverFeedDto => ({
  groups: [],
  generatedAt: '2026-09-24T03:00:00.000Z',
  status: 'idle',
  error: null,
  ...overrides
})

const group = {
  topic: 'Classical Music',
  memoryId: 'mem-1',
  articles: [
    {
      title: 'A new recording of the Goldberg Variations',
      url: 'https://example.com/goldberg',
      source: 'example.com',
      publishedAt: '2026-09-24T01:00:00.000Z'
    }
  ]
} as unknown as DiscoverFeedDto['groups'][number]

const idle = feedOf({ groups: [group] })
const refreshing = feedOf({ groups: [group], status: 'refreshing' })
const refreshed = feedOf({
  groups: [group, { ...group, memoryId: 'mem-2', topic: 'Go' }],
  generatedAt: '2026-09-24T09:30:00.000Z'
})
// What a read that left before the refresh would still bring back.
const older = feedOf({
  groups: [group],
  generatedAt: '2026-09-24T02:00:00.000Z'
})

afterEach(async () => {
  vi.useRealTimers()
  for (const unmount of mounted.splice(0)) await unmount()
  focusManager.setFocused(undefined)
  getDiscoverFeedService.mockReset()
  refreshDiscoverFeedService.mockReset()
  report.mockClear()
  toastError.mockClear()
})

describe('discoverKeys', () => {
  it('has one key for the feed, under a discover root', () => {
    expect(discoverKeys.feed).toEqual(['discover', 'feed'])
  })
})

describe('useDiscoverFeed', () => {
  it('reads the feed once through the service and caches it at discoverKeys.feed', async () => {
    getDiscoverFeedService.mockResolvedValue(idle)
    const { queryClient, api } = await mountHook(() => useDiscoverFeed(true))
    expect(api().feed).toBeNull()

    await act(async () => {
      await vi.waitFor(() => expect(api().feed).toEqual(idle))
    })

    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    expect(refreshDiscoverFeedService).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(discoverKeys.feed)).toEqual(idle)
  })

  it('returns the feed and nothing else, so a render on the chat path pays for one field', async () => {
    getDiscoverFeedService.mockResolvedValue(idle)
    const { api } = await mountHook(() => useDiscoverFeed(true))
    await act(async () => {
      await vi.waitFor(() => expect(api().feed).toEqual(idle))
    })

    expect(Object.keys(api())).toEqual(['feed'])
  })

  it('makes no request, on mount or on focus, while disabled', async () => {
    vi.useFakeTimers()
    const { api } = await mountHook(() => useDiscoverFeed(false))

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await advance(60_000)

    expect(getDiscoverFeedService).not.toHaveBeenCalled()
    expect(api().feed).toBeNull()
  })

  it('starts reading once it is enabled', async () => {
    getDiscoverFeedService.mockResolvedValue(idle)
    let enabled = false
    const { api, rerender } = await mountHook(() => useDiscoverFeed(enabled))
    expect(getDiscoverFeedService).not.toHaveBeenCalled()

    enabled = true
    await rerender()
    await act(async () => {
      await vi.waitFor(() => expect(api().feed).toEqual(idle))
    })

    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
  })

  it('polls every 3000 ms while the feed is refreshing, and stops when a response is not', async () => {
    vi.useFakeTimers()
    getDiscoverFeedService
      .mockResolvedValueOnce(refreshing)
      .mockResolvedValueOnce(refreshing)
      .mockResolvedValue(idle)
    const { queryClient } = await mountHook(() => useDiscoverFeed(true))
    await advance(0)
    expect(cachedFeed(queryClient)?.status).toBe('refreshing')
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)

    await advance(2999)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)

    // Still refreshing: the next tick comes a full interval later.
    await advance(2999)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(3)
    await advance(0)
    expect(cachedFeed(queryClient)?.status).toBe('idle')

    await advance(60_000)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(3)
  })

  it.each(['idle', 'failed'] as const)(
    'does not poll a feed that is %s',
    async (status) => {
      vi.useFakeTimers()
      getDiscoverFeedService.mockResolvedValue(feedOf({ status }))
      const { queryClient } = await mountHook(() => useDiscoverFeed(true))
      await advance(0)
      expect(cachedFeed(queryClient)?.status).toBe(status)

      await advance(60_000)

      expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    }
  )

  it('re-reads when the window regains focus, although the app turns that off', async () => {
    getDiscoverFeedService.mockResolvedValueOnce(idle)
    const { queryClient, api } = await mountHook(() => useDiscoverFeed(true))
    await act(async () => {
      await vi.waitFor(() => expect(api().feed).toEqual(idle))
    })
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      false
    )

    getDiscoverFeedService.mockResolvedValue(refreshed)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().feed).toEqual(refreshed))
    })

    expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData(discoverKeys.feed)).toEqual(refreshed)
    expect(report).not.toHaveBeenCalled()
  })

  it('a failed read is reported and never toasted, and leaves the feed null', async () => {
    getDiscoverFeedService.mockRejectedValue(new Error('feed is down'))
    const { queryClient, api } = await mountHook(() => useDiscoverFeed(true))

    await act(async () => {
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    })

    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: discoverKeys.feed
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().feed).toBeNull()
    expect(queryClient.getQueryData(discoverKeys.feed)).toBeUndefined()
  })
})

describe('useRefreshDiscoverFeed', () => {
  it('posts with no arguments and writes the returned feed to the cache without reading it again', async () => {
    getDiscoverFeedService.mockResolvedValue(idle)
    refreshDiscoverFeedService.mockResolvedValue(refreshed)
    const { queryClient, api } = await mountHook(() => ({
      read: useDiscoverFeed(true),
      refresh: useRefreshDiscoverFeed()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().read.feed).toEqual(idle))
    })

    let returned: DiscoverFeedDto | undefined
    await act(async () => {
      returned = await api().refresh.mutateAsync()
    })

    // React Query hands a mutationFn (variables, context); the service takes
    // none, so it must be called bare.
    expect(refreshDiscoverFeedService).toHaveBeenCalledTimes(1)
    expect(refreshDiscoverFeedService).toHaveBeenCalledWith()
    expect(returned).toEqual(refreshed)
    expect(queryClient.getQueryData(discoverKeys.feed)).toEqual(refreshed)
    await act(async () => {
      await vi.waitFor(() => expect(api().read.feed).toEqual(refreshed))
    })
    // Not invalidated: the POST's own answer is the new state, and asking
    // the server again would race it.
    expect(queryClient.getQueryState(discoverKeys.feed)?.isInvalidated).toBe(
      false
    )
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('a read already in flight when the POST returns cannot overwrite the feed the POST wrote', async () => {
    const inFlight = deferred<DiscoverFeedDto>()
    getDiscoverFeedService
      .mockResolvedValueOnce(idle)
      .mockReturnValueOnce(inFlight.promise)
    refreshDiscoverFeedService.mockResolvedValue(refreshed)
    const { queryClient, api } = await mountHook(() => ({
      read: useDiscoverFeed(true),
      refresh: useRefreshDiscoverFeed()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().read.feed).toEqual(idle))
    })
    // Coming back to the window starts a read, and the POST answers before it.
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() =>
        expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)
      )
    })

    await act(async () => {
      await api().refresh.mutateAsync()
    })
    expect(cachedFeed(queryClient)).toEqual(refreshed)

    await act(async () => {
      inFlight.resolve(older)
    })
    await settle()

    expect(cachedFeed(queryClient)).toEqual(refreshed)
    expect(api().read.feed).toEqual(refreshed)
    expect(report).not.toHaveBeenCalled()
  })

  it('writes the feed even when nothing is mounted to read it', async () => {
    refreshDiscoverFeedService.mockResolvedValue(refreshed)
    const { queryClient, api } = await mountHook(useRefreshDiscoverFeed)

    await act(async () => {
      await api().mutateAsync()
    })

    expect(queryClient.getQueryData(discoverKeys.feed)).toEqual(refreshed)
    expect(getDiscoverFeedService).not.toHaveBeenCalled()
  })

  it('a feed the POST returns as refreshing starts the poll, which ends with the finished feed', async () => {
    vi.useFakeTimers()
    getDiscoverFeedService
      .mockResolvedValueOnce(feedOf())
      .mockResolvedValue(refreshed)
    refreshDiscoverFeedService.mockResolvedValue(
      feedOf({ status: 'refreshing' })
    )
    const { queryClient, api } = await mountHook(() => ({
      read: useDiscoverFeed(true),
      refresh: useRefreshDiscoverFeed()
    }))
    await advance(0)
    expect(cachedFeed(queryClient)?.status).toBe('idle')

    await act(async () => {
      await api().refresh.mutateAsync()
    })
    expect(cachedFeed(queryClient)?.status).toBe('refreshing')
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)

    await advance(2999)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)
    await advance(0)
    expect(cachedFeed(queryClient)).toEqual(refreshed)

    await advance(60_000)
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(2)
  })

  it('is pending while the POST runs and settles afterwards', async () => {
    let finish!: (value: DiscoverFeedDto) => void
    refreshDiscoverFeedService.mockReturnValue(
      new Promise<DiscoverFeedDto>((resolve) => {
        finish = resolve
      })
    )
    const { api } = await mountHook(useRefreshDiscoverFeed)
    expect(api().isPending).toBe(false)

    await act(async () => {
      api().mutate()
      await vi.waitFor(() => expect(api().isPending).toBe(true))
    })

    await act(async () => {
      finish(refreshed)
      await vi.waitFor(() => expect(api().isPending).toBe(false))
    })
  })

  it('keeps mutateAsync the same function across renders, so an effect can depend on it', async () => {
    refreshDiscoverFeedService.mockResolvedValue(refreshed)
    const { api, rerender } = await mountHook(useRefreshDiscoverFeed)
    const first = api().mutateAsync

    await rerender()
    await act(async () => {
      await first()
    })
    await rerender()

    expect(api().mutateAsync).toBe(first)
  })

  it('a failed POST rejects to the caller, is reported once and never toasted, and leaves the feed alone', async () => {
    getDiscoverFeedService.mockResolvedValue(idle)
    refreshDiscoverFeedService.mockRejectedValue(new Error('brave is down'))
    const { queryClient, api } = await mountHook(() => ({
      read: useDiscoverFeed(true),
      refresh: useRefreshDiscoverFeed()
    }))
    await act(async () => {
      await vi.waitFor(() => expect(api().read.feed).toEqual(idle))
    })
    const before = queryClient.getQueryState(discoverKeys.feed)

    let caught: unknown
    await act(async () => {
      await api()
        .refresh.mutateAsync()
        .catch((e: unknown) => {
          caught = e
        })
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('brave is down')
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
      mutationKey: undefined
    })
    // `silent`: each call site decides what a failure looks like (the initial
    // kick says nothing, the button toasts its own localized message).
    expect(toastError).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(discoverKeys.feed)).toBe(before?.data)
    expect(queryClient.getQueryState(discoverKeys.feed)?.dataUpdatedAt).toBe(
      before?.dataUpdatedAt
    )
    expect(getDiscoverFeedService).toHaveBeenCalledTimes(1)
  })
})
