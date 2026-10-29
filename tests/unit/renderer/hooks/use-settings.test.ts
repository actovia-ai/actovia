// @vitest-environment happy-dom
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
const updateSettingsService = vi.fn()
vi.mock('@/services/settings', () => ({
  updateSettings: (...args: unknown[]) => updateSettingsService(...args)
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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false }
  })
}))

const { useSettings, settingsKeys } = await import('@/hooks/use-settings')
const { HttpError } = await import('@actovia/shared/utils/http')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const initial = {
  language: 'en',
  updatedAt: '2026-01-01T00:00:00Z'
} as unknown as Settings

function Probe({
  onReady
}: {
  onReady: (api: ReturnType<typeof useSettings>) => void
}) {
  onReady(useSettings())
  return null
}

async function mountSettled() {
  let latest: ReturnType<typeof useSettings> | undefined
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe, { onReady: (api) => (latest = api) })
  )
  await act(async () => {
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(settingsKeys.all)).toEqual(initial)
    )
  })
  return { queryClient, api: () => latest! }
}

async function flushTasks() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

describe('useSettings', () => {
  beforeEach(() => {
    fetcherMock.mockResolvedValue(initial)
  })

  afterEach(() => {
    fetcherMock.mockReset()
    updateSettingsService.mockReset()
    toastSuccess.mockClear()
    toastError.mockClear()
  })

  it('after a successful save, the cache holds the merged payload with no revalidating GET', async () => {
    updateSettingsService.mockResolvedValue(null)
    const { queryClient, api } = await mountSettled()
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/settings')

    const payload = { language: 'ja' } as unknown as Settings
    await act(async () => {
      await api().updateSettings(payload)
    })
    await flushTasks()

    expect(updateSettingsService).toHaveBeenCalledWith(payload)
    expect(queryClient.getQueryData<Settings>(settingsKeys.all)).toEqual({
      language: 'ja',
      updatedAt: '2026-01-01T00:00:00Z'
    })
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(settingsKeys.all)?.fetchStatus).toBe(
      'idle'
    )
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith({
      title: 'settings:toast.autoSaved'
    })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a failed save toasts an error and leaves the cache untouched', async () => {
    updateSettingsService.mockRejectedValue(
      new HttpError(500, 'internal', 'network down')
    )
    const { queryClient, api } = await mountSettled()
    const before = queryClient.getQueryData<Settings>(settingsKeys.all)

    await act(async () => {
      await api().updateSettings({ language: 'ja' } as unknown as Settings)
    })

    expect(queryClient.getQueryData(settingsKeys.all)).toBe(before)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith({
      title: 'settings:toast.saveFailed',
      description: 'network down'
    })
  })

  it('a GET already in flight when the save lands cannot overwrite the saved cache', async () => {
    updateSettingsService.mockResolvedValue(null)
    const { queryClient, api } = await mountSettled()

    let resolveStale!: (value: Settings) => void
    fetcherMock.mockReturnValueOnce(
      new Promise<Settings>((resolve) => {
        resolveStale = resolve
      })
    )
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: settingsKeys.all })
      await Promise.resolve()
    })
    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryState(settingsKeys.all)?.fetchStatus).toBe(
      'fetching'
    )

    await act(async () => {
      await api().updateSettings({ language: 'ja' } as unknown as Settings)
    })
    resolveStale(initial)
    await flushTasks()

    expect(queryClient.getQueryData<Settings>(settingsKeys.all)).toEqual({
      language: 'ja',
      updatedAt: '2026-01-01T00:00:00Z'
    })
    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryState(settingsKeys.all)?.fetchStatus).toBe(
      'idle'
    )
    expect(toastSuccess).toHaveBeenCalledTimes(1)
  })

  it('says whether the save landed, and marks the secrets status stale after one', async () => {
    updateSettingsService.mockResolvedValueOnce(null)
    const { queryClient, api } = await mountSettled()
    queryClient.setQueryData(['secrets-status'], {
      encryption: 'on',
      needsReentry: ['providers.openaiApiKey']
    })

    let saved: boolean | undefined
    await act(async () => {
      saved = await api().updateSettings({
        language: 'ja'
      } as unknown as Settings)
    })
    expect(saved).toBe(true)
    expect(queryClient.getQueryState(['secrets-status'])?.isInvalidated).toBe(
      true
    )

    updateSettingsService.mockRejectedValueOnce(new HttpError(500, 'x', 'down'))
    await act(async () => {
      saved = await api().updateSettings({
        language: 'de'
      } as unknown as Settings)
    })
    expect(saved).toBe(false)
  })
})
