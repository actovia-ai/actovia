// @vitest-environment happy-dom
import {
  focusManager,
  type QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const getLogsService = vi.fn()
const getLogDatesService = vi.fn()
const getLogScopesService = vi.fn()
const clearLogsService = vi.fn()
vi.mock('@/services/logs', () => ({
  getLogs: (...args: unknown[]) => getLogsService(...args),
  getLogDates: (...args: unknown[]) => getLogDatesService(...args),
  getLogScopes: (...args: unknown[]) => getLogScopesService(...args),
  clearLogs: (...args: unknown[]) => clearLogsService(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const { logsKeys, useLogs, useLogDates, useLogScopes, useClearLogs } =
  await import('@/hooks/use-logs')
const { createAppQueryClient } = await import('@/lib/query-client')

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

// Every mounted client listens to the one global focusManager, so a client
// left subscribed would answer the focus tests' toggles with fetches of its
// own: each test's client is unmounted (unsubscribed) in afterEach.
const mountedClients: QueryClient[] = []

async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe<T>, { hook, onReady: (value) => (latest = value) })
  )
  mountedClients.push(queryClient)
  return { queryClient, api: () => latest! }
}

// The app's own client, so a failing read or write goes through the real
// `queryCache` / `mutationCache` `onError` (report, and toast for a write),
// and `refetchOnWindowFocus` is off unless the hook turns it on. Retries off
// so a failed read lands without a backoff.
async function mountHookOnAppClient<T>(hook: () => T) {
  let latest: T | undefined
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  mountedClients.push(queryClient)
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const PARAMS = 'date=2026-09-23&page=1&pageSize=100'
const OTHER_PARAMS = 'date=2026-09-23&page=2&pageSize=100'
const DATE = '2026-09-23'
const logs = {
  entries: [
    {
      timestamp: '2026-09-23T03:00:00.000Z',
      severityNumber: 9,
      severityText: 'INFO',
      body: 'Hono is running',
      scope: { name: 'server' }
    }
  ],
  total: 1,
  page: 1
}
const dates = { dates: ['2026-09-23', '2026-09-22'] }
const scopes = { scopes: ['server', 'renderer/query'] }

function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData(logsKeys.entries(PARAMS), logs)
  queryClient.setQueryData(logsKeys.dates, dates)
  queryClient.setQueryData(logsKeys.scopes(DATE), scopes)
  queryClient.setQueryData(['usage'], { totalCost: 0 })
}

afterEach(() => {
  for (const client of mountedClients.splice(0)) client.unmount()
  focusManager.setFocused(undefined)
  getLogsService.mockReset()
  getLogDatesService.mockReset()
  getLogScopesService.mockReset()
  clearLogsService.mockReset()
  report.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('logsKeys', () => {
  it('nests entries, dates and scopes under one logs root', () => {
    expect(logsKeys.all).toEqual(['logs'])
    expect(logsKeys.entries(PARAMS)).toEqual(['logs', 'entries', PARAMS])
    expect(logsKeys.dates).toEqual(['logs', 'dates'])
    expect(logsKeys.scopes(DATE)).toEqual(['logs', 'scopes', DATE])
  })
})

describe('useLogs', () => {
  it('reads the entries for the params string and caches them under it', async () => {
    getLogsService.mockResolvedValue(logs)
    const { queryClient, api } = await mountHook(() => useLogs(PARAMS))
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(logs))
    })

    expect(getLogsService).toHaveBeenCalledTimes(1)
    expect(getLogsService).toHaveBeenCalledWith(PARAMS)
    expect(getLogDatesService).not.toHaveBeenCalled()
    expect(getLogScopesService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(logsKeys.entries(PARAMS))).toEqual(logs)
  })

  it('a changed params string is a new key; the old lines stay, marked as placeholder, until it lands', async () => {
    const second = deferred<typeof logs>()
    getLogsService.mockResolvedValueOnce(logs)
    getLogsService.mockReturnValueOnce(second.promise)
    const { api, queryClient } = await mountHook(() => {
      const [params, setParams] = useState(PARAMS)
      return { ...useLogs(params), setParams }
    })
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(logs))
    })

    await act(async () => {
      api().setParams(OTHER_PARAMS)
    })

    expect(getLogsService).toHaveBeenLastCalledWith(OTHER_PARAMS)
    // A new filter keeps the old lines on screen instead of flashing the
    // empty state; the page dims them while `isPlaceholderData`.
    expect(api().data).toEqual(logs)
    expect(api().isPlaceholderData).toBe(true)

    const page2 = { ...logs, page: 2 }
    await act(async () => {
      second.resolve(page2)
      await vi.waitFor(() => expect(api().data).toEqual(page2))
    })
    expect(api().isPlaceholderData).toBe(false)
    expect(queryClient.getQueryData(logsKeys.entries(PARAMS))).toEqual(logs)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getLogsService.mockRejectedValue(new Error('logs are down'))
    const { api } = await mountHookOnAppClient(() => useLogs(PARAMS))

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: logsKeys.entries(PARAMS)
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('reads again when the window regains focus, so a log written meanwhile shows up', async () => {
    getLogsService.mockResolvedValueOnce(logs)
    const { api } = await mountHookOnAppClient(() => useLogs(PARAMS))
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(logs))
    })
    expect(getLogsService).toHaveBeenCalledTimes(1)

    const fresher = { ...logs, total: 2 }
    getLogsService.mockResolvedValue(fresher)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().data).toEqual(fresher))
    })

    expect(getLogsService).toHaveBeenCalledTimes(2)
    expect(getLogsService).toHaveBeenLastCalledWith(PARAMS)
  })
})

describe('useLogDates', () => {
  it('reads the dates once and caches them at logsKeys.dates', async () => {
    getLogDatesService.mockResolvedValue(dates)
    const { queryClient, api } = await mountHook(useLogDates)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(dates))
    })

    expect(getLogDatesService).toHaveBeenCalledTimes(1)
    expect(getLogDatesService).toHaveBeenCalledWith()
    expect(getLogsService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(logsKeys.dates)).toEqual(dates)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getLogDatesService.mockRejectedValue(new Error('dates are down'))
    const { api } = await mountHookOnAppClient(useLogDates)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: logsKeys.dates
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('reads again when the window regains focus', async () => {
    getLogDatesService.mockResolvedValueOnce(dates)
    const { api } = await mountHookOnAppClient(useLogDates)
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(dates))
    })

    const fresher = { dates: ['2026-09-24', ...dates.dates] }
    getLogDatesService.mockResolvedValue(fresher)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().data).toEqual(fresher))
    })

    expect(getLogDatesService).toHaveBeenCalledTimes(2)
  })
})

describe('useLogScopes', () => {
  it('reads the scopes of the date and caches them under it', async () => {
    getLogScopesService.mockResolvedValue(scopes)
    const { queryClient, api } = await mountHook(() => useLogScopes(DATE))
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(scopes))
    })

    expect(getLogScopesService).toHaveBeenCalledTimes(1)
    expect(getLogScopesService).toHaveBeenCalledWith(DATE)
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(logsKeys.scopes(DATE))).toEqual(scopes)
  })

  it('reads a changed date under its own key', async () => {
    getLogScopesService.mockResolvedValueOnce(scopes)
    getLogScopesService.mockResolvedValueOnce({ scopes: ['server'] })
    const { api, queryClient } = await mountHook(() => {
      const [date, setDate] = useState(DATE)
      return { ...useLogScopes(date), setDate }
    })
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(scopes))
    })

    await act(async () => {
      api().setDate('2026-09-22')
    })
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual({ scopes: ['server'] }))
    })

    expect(getLogScopesService).toHaveBeenCalledTimes(2)
    expect(getLogScopesService).toHaveBeenLastCalledWith('2026-09-22')
    expect(queryClient.getQueryData(logsKeys.scopes(DATE))).toEqual(scopes)
  })

  it('reads nothing while there is no date', async () => {
    const { api } = await mountHook(() => useLogScopes(''))
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
    })

    expect(getLogScopesService).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getLogScopesService.mockRejectedValue(new Error('scopes are down'))
    const { api } = await mountHookOnAppClient(() => useLogScopes(DATE))

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: logsKeys.scopes(DATE)
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  it('reads again when the window regains focus', async () => {
    getLogScopesService.mockResolvedValueOnce(scopes)
    const { api } = await mountHookOnAppClient(() => useLogScopes(DATE))
    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(scopes))
    })

    const fresher = { scopes: [...scopes.scopes, 'lan'] }
    getLogScopesService.mockResolvedValue(fresher)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().data).toEqual(fresher))
    })

    expect(getLogScopesService).toHaveBeenCalledTimes(2)
    expect(getLogScopesService).toHaveBeenLastCalledWith(DATE)
  })
})

describe('useClearLogs', () => {
  it('clears with no arguments, marks the whole logs family stale, and toasts once', async () => {
    clearLogsService.mockResolvedValue(undefined)
    const { queryClient, api } = await mountHook(useClearLogs)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync()
    })

    // React Query hands a mutationFn (variables, context); the service takes
    // none, so it must be called bare.
    expect(clearLogsService).toHaveBeenCalledTimes(1)
    expect(clearLogsService).toHaveBeenCalledWith()
    // The date and scope pickers list files and scopes that a clear removes.
    expect(
      queryClient.getQueryState(logsKeys.entries(PARAMS))?.isInvalidated
    ).toBe(true)
    expect(queryClient.getQueryState(logsKeys.dates)?.isInvalidated).toBe(true)
    expect(
      queryClient.getQueryState(logsKeys.scopes(DATE))?.isInvalidated
    ).toBe(true)
    expect(queryClient.getQueryState(['usage'])?.isInvalidated).toBe(false)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:logger.toast.cleared'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('is pending while the clear runs and settles afterwards', async () => {
    const clearing = deferred<undefined>()
    clearLogsService.mockReturnValue(clearing.promise)
    const { api } = await mountHook(useClearLogs)
    expect(api().isPending).toBe(false)

    await act(async () => {
      api().mutate()
      await vi.waitFor(() => expect(api().isPending).toBe(true))
    })

    await act(async () => {
      clearing.resolve(undefined)
      await vi.waitFor(() => expect(api().isPending).toBe(false))
    })
    expect(toastSuccess).toHaveBeenCalledTimes(1)
  })

  it('a failed clear reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    clearLogsService.mockRejectedValue(new Error('permission denied'))
    const { queryClient, api } = await mountHookOnAppClient(useClearLogs)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync()
        .catch(() => {})
    })

    expect(
      queryClient.getQueryState(logsKeys.entries(PARAMS))?.isInvalidated
    ).toBe(false)
    expect(queryClient.getQueryState(logsKeys.dates)?.isInvalidated).toBe(false)
    expect(
      queryClient.getQueryState(logsKeys.scopes(DATE))?.isInvalidated
    ).toBe(false)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
      mutationKey: undefined
    })
    // The component has no catch of its own, so this is the only error toast:
    // a second one here would be the double-toast the hook exists to avoid.
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith({
      title: 'settings:logger.toast.clearFailed',
      description: 'permission denied'
    })
  })
})
