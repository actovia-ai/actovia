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
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: { error: (...args: unknown[]) => sileoError(...args) }
}))

const { usageKeys, useUsage } = await import('@/hooks/use-usage')
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

const summary = {
  totalCost: 1.5,
  totalTokens: 1200,
  totalRequests: 7,
  daily: [{ date: '2026-09-23', cost: 1.5, tokens: 1200 }],
  models: []
}

describe('usageKeys', () => {
  it('has one root key', () => {
    expect(usageKeys.all).toEqual(['usage'])
  })
})

describe('useUsage', () => {
  afterEach(() => {
    fetcherMock.mockReset()
    report.mockClear()
    sileoError.mockClear()
  })

  it('reads the usage route once and caches it at usageKeys.all', async () => {
    fetcherMock.mockResolvedValue(summary)
    const { queryClient, api } = await mountHook(useUsage)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(summary))
    })

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/usage')
    expect(queryClient.getQueryData(usageKeys.all)).toEqual(summary)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    fetcherMock.mockRejectedValue(new Error('usage is down'))
    const { api } = await mountHookOnAppClient(useUsage)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: usageKeys.all
    })
    expect(sileoError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})
