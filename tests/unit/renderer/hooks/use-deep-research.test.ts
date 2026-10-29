// @vitest-environment happy-dom
import {
  focusManager,
  type QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DeepResearch } from '@/types/db'

const fetchDeepResearchResultService = vi.fn()
const fetchDeepResearchMessagesService = vi.fn()
vi.mock('@/services/deep-research', () => ({
  fetchDeepResearchResult: (...args: unknown[]) =>
    fetchDeepResearchResultService(...args),
  fetchDeepResearchMessages: (...args: unknown[]) =>
    fetchDeepResearchMessagesService(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
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

const { deepResearchKeys, useDeepResearchResult } =
  await import('@/hooks/use-deep-research')
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

// Every mounted client listens to the one global focusManager: a root left
// mounted would answer a later test's focus toggles with requests of its own.
const mounted: Array<() => Promise<void>> = []

// Mounts on a client the test owns, so a second mount can share its cache and
// the first can be unmounted (the panel closing and opening again).
async function mountOn<T>(queryClient: QueryClient, hook: () => T) {
  let latest: T | undefined
  let rerender!: () => void
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
  const unmount = async () => {
    await act(async () => {
      root.unmount()
    })
  }
  mounted.push(unmount)
  return {
    api: () => latest!,
    rerender: async () => {
      await act(async () => {
        rerender()
      })
    },
    unmount
  }
}

// The app's own client, so a failing read goes through the real
// `queryCache.onError` and the app-wide defaults (no refetch on focus, no
// staleTime) are the ones under test. Retries off unless a test is about them,
// so a failure lands without a backoff.
function appClient() {
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  return queryClient
}

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
      setTimeout(resolve, 5)
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

const ID = '7d1b2f0e-3c4a-4e1b-9a55-0c2f6f1d9a10'
const OTHER_ID = 'a3b1c7d2-5e6f-4a8b-8c9d-1e2f3a4b5c6d'

// The route's JSON: a fresh, equal object on every call, timestamps as strings
// — what a refetch actually hands React Query.
const research = (over: Partial<DeepResearch> = {}): DeepResearch =>
  JSON.parse(
    JSON.stringify({
      id: ID,
      toolCallId: 'call-1',
      title: 'Sea levels',
      jobStatus: 'streaming',
      finalReport: null,
      webSources: null,
      startTime: '2026-09-23T10:00:00.000Z',
      endTime: null,
      ...over
    })
  ) as DeepResearch

afterEach(async () => {
  vi.useRealTimers()
  for (const unmount of mounted.splice(0)) await unmount()
  focusManager.setFocused(undefined)
  fetchDeepResearchResultService.mockReset()
  fetchDeepResearchMessagesService.mockReset()
  report.mockClear()
  toastError.mockClear()
})

describe('deepResearchKeys', () => {
  it('nests a result under the deep-research root, one key per id', () => {
    expect(deepResearchKeys.result(ID)).toEqual(['deep-research', 'result', ID])
    expect(deepResearchKeys.result(ID)).not.toEqual(
      deepResearchKeys.result(OTHER_ID)
    )
  })
})

describe('useDeepResearchResult', () => {
  it('reads the result of the id it is given once, and caches it at deepResearchKeys.result(id)', async () => {
    const first = deferred<DeepResearch>()
    fetchDeepResearchResultService.mockReturnValue(first.promise)
    const queryClient = appClient()
    const { api } = await mountOn(queryClient, () => useDeepResearchResult(ID))
    expect(api().data).toBeUndefined()

    await act(async () => {
      first.resolve(research())
      await vi.waitFor(() => expect(api().data).toEqual(research()))
    })

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)
    expect(fetchDeepResearchResultService).toHaveBeenCalledWith(ID)
    expect(queryClient.getQueryData(deepResearchKeys.result(ID))).toEqual(
      research()
    )
    expect(fetchDeepResearchMessagesService).not.toHaveBeenCalled()
  })

  it('exposes only what the two components read', async () => {
    fetchDeepResearchResultService.mockResolvedValue(research())
    const { api } = await mountOn(appClient(), () => useDeepResearchResult(ID))

    expect(Object.keys(api()).toSorted()).toEqual(['data', 'refetch'])
  })

  it.each([
    ['undefined', undefined],
    ['an empty string', '']
  ])('makes no request while the id is %s', async (_name, id) => {
    vi.useFakeTimers()
    const queryClient = appClient()
    const { api } = await mountOn(queryClient, () => useDeepResearchResult(id))

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await advance(60_000)

    expect(fetchDeepResearchResultService).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
    expect(
      queryClient.getQueryData(deepResearchKeys.result(ID))
    ).toBeUndefined()
  })

  it('starts reading once an id is given, and reads the new id when it changes, keeping each in a cache of its own', async () => {
    const other = deferred<DeepResearch>()
    fetchDeepResearchResultService
      .mockResolvedValueOnce(research())
      .mockReturnValueOnce(other.promise)
    let id: string | undefined
    const queryClient = appClient()
    const { api, rerender } = await mountOn(queryClient, () =>
      useDeepResearchResult(id)
    )
    expect(fetchDeepResearchResultService).not.toHaveBeenCalled()

    id = ID
    await rerender()
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.id).toBe(ID))
    })

    id = OTHER_ID
    await rerender()
    expect(fetchDeepResearchResultService).toHaveBeenLastCalledWith(OTHER_ID)
    expect(api().data).toBeUndefined()

    await act(async () => {
      other.resolve(research({ id: OTHER_ID }))
      await vi.waitFor(() => expect(api().data?.id).toBe(OTHER_ID))
    })
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
    expect(
      queryClient.getQueryData<DeepResearch>(deepResearchKeys.result(ID))?.id
    ).toBe(ID)
  })

  it('shares one request between the card and the panel reading the same id', async () => {
    const first = deferred<DeepResearch>()
    fetchDeepResearchResultService.mockReturnValue(first.promise)
    const queryClient = appClient()
    const card = await mountOn(queryClient, () => useDeepResearchResult(ID))
    const panel = await mountOn(queryClient, () => useDeepResearchResult(ID))

    await act(async () => {
      first.resolve(research())
      await vi.waitFor(() => expect(panel.api().data).toEqual(research()))
    })

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)
    expect(fetchDeepResearchResultService).toHaveBeenCalledWith(ID)
    expect(card.api().data).toBe(panel.api().data)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('refetch reads the route again, once for every observer, and both see the new row', async () => {
    const first = deferred<DeepResearch>()
    fetchDeepResearchResultService
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        research({ jobStatus: 'archived', finalReport: '# Report' })
      )
    const queryClient = appClient()
    const card = await mountOn(queryClient, () => useDeepResearchResult(ID))
    const panel = await mountOn(queryClient, () => useDeepResearchResult(ID))
    await act(async () => {
      first.resolve(research())
      await vi.waitFor(() =>
        expect(panel.api().data?.jobStatus).toBe('streaming')
      )
    })
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)

    await act(async () => {
      await panel.api().refetch()
      await vi.waitFor(() =>
        expect(card.api().data?.jobStatus).toBe('archived')
      )
    })

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
    expect(panel.api().data?.jobStatus).toBe('archived')
    expect(card.api().data?.finalReport).toBe('# Report')
    expect(card.api().data).toBe(panel.api().data)
  })

  it('refetch reads the id the hook has now, not the one it was created with', async () => {
    fetchDeepResearchResultService.mockImplementation((id: string) =>
      Promise.resolve(research({ id }))
    )
    let id = ID
    const { api, rerender } = await mountOn(appClient(), () =>
      useDeepResearchResult(id)
    )
    const refetchAtFirstId = api().refetch
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.id).toBe(ID))
    })

    id = OTHER_ID
    await rerender()
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.id).toBe(OTHER_ID))
    })
    fetchDeepResearchResultService.mockClear()
    await act(async () => {
      await refetchAtFirstId()
    })

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)
    expect(fetchDeepResearchResultService).toHaveBeenCalledWith(OTHER_ID)
  })

  // `refetch` bypasses `enabled`, and the panel's stream can call it after the
  // id was cleared; a request for an empty id must never leave the renderer.
  it.each([
    ['undefined', undefined],
    ['an empty string', '']
  ])(
    'refetch makes no request while the id is %s, and neither reports nor fails',
    async (_name, id) => {
      const queryClient = appClient()
      const { api } = await mountOn(queryClient, () =>
        useDeepResearchResult(id)
      )

      let result: { isError: boolean } | undefined
      await act(async () => {
        result = await api().refetch()
      })
      await settle()

      expect(fetchDeepResearchResultService).not.toHaveBeenCalled()
      expect(result?.isError).toBe(false)
      expect(api().data).toBeUndefined()
      expect(report).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    }
  )

  it('a refetch from a stream that outlived its id makes no request and reports nothing', async () => {
    fetchDeepResearchResultService.mockResolvedValue(research())
    let id = ID
    const { api, rerender } = await mountOn(appClient(), () =>
      useDeepResearchResult(id)
    )
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.id).toBe(ID))
    })
    const refetchFromTheStream = api().refetch

    id = ''
    await rerender()
    expect(api().data).toBeUndefined()
    fetchDeepResearchResultService.mockClear()
    await act(async () => {
      await refetchFromTheStream()
    })
    await settle()

    expect(fetchDeepResearchResultService).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
    expect(report).not.toHaveBeenCalled()
  })

  describe('as a useEffect dependency', () => {
    it('hands out the same refetch on every render, and after the data changes', async () => {
      fetchDeepResearchResultService
        .mockResolvedValueOnce(research())
        .mockResolvedValueOnce(research({ jobStatus: 'archived' }))
      const { api, rerender } = await mountOn(appClient(), () =>
        useDeepResearchResult(ID)
      )
      const first = api().refetch
      await act(async () => {
        await vi.waitFor(() => expect(api().data).toBeDefined())
      })
      expect(api().refetch).toBe(first)

      await rerender()
      await rerender()
      expect(api().refetch).toBe(first)

      await act(async () => {
        await api().refetch()
        await vi.waitFor(() => expect(api().data?.jobStatus).toBe('archived'))
      })
      expect(api().refetch).toBe(first)
    })

    it('does not re-run an effect listing refetch and jobStatus on a re-render or an equal refetch, and re-runs it once when the status changes', async () => {
      fetchDeepResearchResultService
        .mockResolvedValueOnce(research())
        .mockResolvedValueOnce(research())
        .mockResolvedValueOnce(research({ jobStatus: 'archived' }))
      let runs = 0
      const cleanups = vi.fn()
      const { api, rerender } = await mountOn(appClient(), () => {
        const { data, refetch } = useDeepResearchResult(ID)
        // DeepResearchProcess's SSE effect: the stream is opened here, so a
        // re-run is a torn-down connection and a second history fetch.
        useEffect(() => {
          runs++
          return cleanups
        }, [ID, data?.jobStatus, refetch])
        return { data, refetch }
      })
      await act(async () => {
        await vi.waitFor(() => expect(api().data?.jobStatus).toBe('streaming'))
      })
      // Mount (status unknown), then once the status arrives.
      expect(runs).toBe(2)
      expect(cleanups).toHaveBeenCalledTimes(1)

      await rerender()
      await rerender()
      await act(async () => {
        await api().refetch()
      })
      await settle()
      expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
      expect(runs).toBe(2)
      expect(cleanups).toHaveBeenCalledTimes(1)

      await act(async () => {
        await api().refetch()
        await vi.waitFor(() => expect(api().data?.jobStatus).toBe('archived'))
      })
      expect(runs).toBe(3)
      expect(cleanups).toHaveBeenCalledTimes(2)
    })

    it('keeps the data object when a refetch returns an equal row, and replaces it when the row changed', async () => {
      fetchDeepResearchResultService
        .mockResolvedValueOnce(research())
        .mockResolvedValueOnce(research())
        .mockResolvedValueOnce(research({ finalReport: '# Report' }))
      const { api } = await mountOn(appClient(), () =>
        useDeepResearchResult(ID)
      )
      await act(async () => {
        await vi.waitFor(() => expect(api().data).toBeDefined())
      })
      const first = api().data

      await act(async () => {
        await api().refetch()
      })
      await settle()
      expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
      expect(api().data).toBe(first)

      await act(async () => {
        await api().refetch()
        await vi.waitFor(() => expect(api().data?.finalReport).toBe('# Report'))
      })
      expect(api().data).not.toBe(first)
    })
  })

  it('reads again when a closed panel is opened again (default staleTime), showing the row it has meanwhile', async () => {
    vi.useFakeTimers()
    const second = deferred<DeepResearch>()
    fetchDeepResearchResultService
      .mockResolvedValueOnce(research())
      .mockReturnValueOnce(second.promise)
    const queryClient = appClient()
    const first = await mountOn(queryClient, () => useDeepResearchResult(ID))
    await advance(0)
    expect(first.api().data?.jobStatus).toBe('streaming')
    await first.unmount()

    const again = await mountOn(queryClient, () => useDeepResearchResult(ID))
    await advance(0)

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
    expect(again.api().data?.jobStatus).toBe('streaming')

    second.resolve(research({ jobStatus: 'archived' }))
    await advance(0)
    expect(again.api().data?.jobStatus).toBe('archived')
  })

  it('does not poll and does not re-read when the window regains focus', async () => {
    vi.useFakeTimers()
    fetchDeepResearchResultService.mockResolvedValue(research())
    await mountOn(appClient(), () => useDeepResearchResult(ID))
    await advance(0)
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)

    await advance(10 * 60_000)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await advance(0)

    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)
  })

  it('a failed read is retried once, then reported once and never toasted, and leaves the data undefined', async () => {
    vi.useFakeTimers()
    fetchDeepResearchResultService.mockRejectedValue(
      new Error('result is down')
    )
    const queryClient = createAppQueryClient()
    const { api } = await mountOn(queryClient, () => useDeepResearchResult(ID))

    await advance(0)
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()

    await advance(500)
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: deepResearchKeys.result(ID)
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
    expect(
      queryClient.getQueryData(deepResearchKeys.result(ID))
    ).toBeUndefined()

    await advance(30_000)
    expect(fetchDeepResearchResultService).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('a failed refetch keeps the row it had, and a second refetch can recover it', async () => {
    fetchDeepResearchResultService
      .mockResolvedValueOnce(research())
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(research({ jobStatus: 'archived' }))
    const { api } = await mountOn(appClient(), () => useDeepResearchResult(ID))
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toBeDefined())
    })

    await act(async () => {
      await expect(api().refetch()).resolves.toBeDefined()
    })
    await settle()
    expect(api().data?.jobStatus).toBe('streaming')
    expect(report).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()

    await act(async () => {
      await api().refetch()
      await vi.waitFor(() => expect(api().data?.jobStatus).toBe('archived'))
    })
  })
})
