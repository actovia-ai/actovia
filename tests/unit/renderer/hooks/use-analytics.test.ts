// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
const getAnalyticsStatusService = vi.fn()
vi.mock('@/services/analytics', () => ({
  getAnalyticsStatus: (...args: unknown[]) => getAnalyticsStatusService(...args)
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

const { analyticsKeys, useAnalyticsStatus } =
  await import('@/hooks/use-analytics')
const { createAppQueryClient } = await import('@/lib/query-client')
const realService = await vi.importActual<
  typeof import('@/services/analytics')
>('@/services/analytics')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Probe<T>({
  hook,
  onReady
}: {
  hook: () => T
  onReady: (value: T) => void
}) {
  onReady(hook())
  return null
}

async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe<T>, { hook, onReady: (value) => (latest = value) })
  )
  return { queryClient, api: () => latest! }
}

// The app's own client, so a failing read goes through the real
// `queryCache.onError`; retries off so the failure lands without a backoff.
async function mountHookOnAppClient<T>(hook: () => T) {
  let latest: T | undefined
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  const probe = createElement(Probe<T>, {
    hook,
    onReady: (value) => (latest = value)
  })
  await act(async () => {
    createRoot(document.createElement('div')).render(
      createElement(QueryClientProvider, { client: queryClient }, probe)
    )
  })
  return { queryClient, api: () => latest! }
}

const before = {
  available: true,
  version: '1.3.0',
  snapshot: null,
  path: '/home/.actovia/analytics/actovia.duckdb'
}
const after = {
  ...before,
  snapshot: {
    builtAt: '2026-09-24T08:00:00.000Z',
    durationMs: 420,
    tables: [{ name: 'chat', rows: 12 }],
    logsIncluded: true,
    sizeBytes: 4096
  }
}

afterEach(() => {
  fetcherMock.mockReset()
  getAnalyticsStatusService.mockReset()
  report.mockClear()
  toastError.mockClear()
})

describe('analyticsKeys', () => {
  it('has one key for the status', () => {
    expect(analyticsKeys.status).toEqual(['analytics', 'status'])
  })
})

describe('getAnalyticsStatus', () => {
  it('reads /api/v1/analytics/status', async () => {
    fetcherMock.mockResolvedValue(before)

    const result = await realService.getAnalyticsStatus()

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/analytics/status')
    expect(result).toEqual(before)
  })
})

describe('useAnalyticsStatus', () => {
  it('reads the status once and caches it at analyticsKeys.status', async () => {
    getAnalyticsStatusService.mockResolvedValue(before)
    const { queryClient, api } = await mountHook(useAnalyticsStatus)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(before))
    })

    expect(getAnalyticsStatusService).toHaveBeenCalledTimes(1)
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(analyticsKeys.status)).toEqual(before)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getAnalyticsStatusService.mockRejectedValue(new Error('duckdb is down'))
    const { api } = await mountHookOnAppClient(useAnalyticsStatus)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: analyticsKeys.status
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('refresh() refetches, and its promise settles only after the refetch does', async () => {
    let finishRefetch!: (value: typeof after) => void
    getAnalyticsStatusService
      .mockResolvedValueOnce(before)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefetch = resolve
          })
      )
    const { queryClient, api } = await mountHook(useAnalyticsStatus)
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(before))
    })
    expect(getAnalyticsStatusService).toHaveBeenCalledTimes(1)

    let settled = false
    let cachedWhenSettled: unknown
    let refreshing!: Promise<unknown>
    await act(async () => {
      refreshing = api()
        .refresh()
        .then(() => {
          settled = true
          cachedWhenSettled = queryClient.getQueryData(analyticsKeys.status)
        })
      await vi.waitFor(() =>
        expect(getAnalyticsStatusService).toHaveBeenCalledTimes(2)
      )
    })
    expect(settled).toBe(false)
    expect(api().data).toEqual(before)

    await act(async () => {
      finishRefetch(after)
      await refreshing
    })

    expect(settled).toBe(true)
    expect(cachedWhenSettled).toEqual(after)
    expect(getAnalyticsStatusService).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(after))
    })
  })
})
