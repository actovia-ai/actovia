// @vitest-environment happy-dom
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SecretsStatus } from '@/services/settings'

const getSecretsStatusService = vi.fn()
vi.mock('@/services/settings', () => ({
  getSecretsStatus: (...args: unknown[]) => getSecretsStatusService(...args),
  updateSettings: vi.fn()
}))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: vi.fn(),
    error: (...a: unknown[]) => toastError(...a)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})
vi.mock('@/lib/i18n', () => ({
  i18n: { exists: () => false, t: (key: string) => key }
}))

const { secretsStatusKeys, useSecretsStatus } =
  await import('@/hooks/use-secrets-status')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const unmounts: Array<() => void> = []

async function mount() {
  let latest: ReturnType<typeof useSecretsStatus> | undefined
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  const root = createRoot(document.createElement('div'))
  function Probe() {
    latest = useSecretsStatus()
    return null
  }
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe)
      )
    )
  })
  unmounts.push(() => act(() => root.unmount()))
  return { queryClient, api: () => latest! }
}

const status = (over: Partial<SecretsStatus> = {}): SecretsStatus => ({
  encryption: 'on',
  needsReentry: [],
  ...over
})

afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  focusManager.setFocused(undefined)
  getSecretsStatusService.mockReset()
  report.mockClear()
  toastError.mockClear()
})

describe('useSecretsStatus', () => {
  it('reads the status through the service with no arguments, under its own root key', async () => {
    getSecretsStatusService.mockResolvedValue(
      status({ needsReentry: ['providers.openaiApiKey'] })
    )
    const { queryClient, api } = await mount()
    await act(async () => {
      await vi.waitFor(() =>
        expect(api().data?.needsReentry).toEqual(['providers.openaiApiKey'])
      )
    })
    expect(getSecretsStatusService).toHaveBeenCalledWith()
    // Never under ['settings']: the settings cache is written, not refetched.
    expect(secretsStatusKeys.all).toEqual(['secrets-status'])
    expect(queryClient.getQueryData(secretsStatusKeys.all)).toEqual(
      status({ needsReentry: ['providers.openaiApiKey'] })
    )
  })

  it('reads again when the window regains focus (a key re-entered elsewhere drops off)', async () => {
    getSecretsStatusService.mockResolvedValue(
      status({ encryption: 'unavailable' })
    )
    const { api } = await mount()
    await act(async () => {
      await vi.waitFor(() => expect(api().data?.encryption).toBe('unavailable'))
    })
    getSecretsStatusService.mockResolvedValue(status())
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().data?.encryption).toBe('on'))
    })
    expect(getSecretsStatusService).toHaveBeenCalledTimes(2)
  })

  it('a failed read is reported, never toasted', async () => {
    getSecretsStatusService.mockRejectedValue(new Error('down'))
    const { api } = await mount()
    await act(async () => {
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})
