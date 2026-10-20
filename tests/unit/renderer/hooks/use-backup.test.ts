// @vitest-environment happy-dom
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false }
  })
}))
const getBackupStatusService = vi.fn()
const listBackupsService = vi.fn()
const createBackupNowService = vi.fn()
vi.mock('@/services/backup', () => ({
  getBackupStatus: (...args: unknown[]) => getBackupStatusService(...args),
  listBackups: (...args: unknown[]) => listBackupsService(...args),
  createBackupNow: (...args: unknown[]) => createBackupNowService(...args)
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const sileoSuccess = vi.fn()
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: {
    success: (...args: unknown[]) => sileoSuccess(...args),
    error: (...args: unknown[]) => sileoError(...args)
  }
}))

const { backupKeys, useBackupStatus, useBackupList, useCreateBackup } =
  await import('@/hooks/use-backup')
const { settingsKeys, useSettings } = await import('@/hooks/use-settings')
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

// The app's own client, so a failing read or write goes through the real
// `queryCache` / `mutationCache` `onError` (report, and toast for a write);
// retries off so a failed read lands without a backoff.
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

const status = { autoBackup: true, lastBackupAt: '2026-09-23T03:00:00.000Z' }
const backups = [
  { name: 'actovia-2026-09-23.zip', size: 2048, createdAt: status.lastBackupAt }
]

const settings = {
  id: 'global',
  autoBackup: true,
  lastBackupAt: status.lastBackupAt
}

function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData(backupKeys.status, status)
  queryClient.setQueryData(backupKeys.list, backups)
  queryClient.setQueryData(settingsKeys.all, settings)
}

afterEach(() => {
  fetcherMock.mockReset()
  getBackupStatusService.mockReset()
  listBackupsService.mockReset()
  createBackupNowService.mockReset()
  report.mockClear()
  sileoSuccess.mockClear()
  sileoError.mockClear()
})

describe('backupKeys', () => {
  it('has one key for the status and one for the list, under one root', () => {
    expect(backupKeys.status).toEqual(['backup', 'status'])
    expect(backupKeys.list).toEqual(['backup', 'list'])
  })
})

describe('useBackupStatus', () => {
  it('reads the status once and caches it at backupKeys.status', async () => {
    getBackupStatusService.mockResolvedValue(status)
    const { queryClient, api } = await mountHook(useBackupStatus)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(status))
    })

    expect(getBackupStatusService).toHaveBeenCalledTimes(1)
    expect(listBackupsService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(backupKeys.status)).toEqual(status)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getBackupStatusService.mockRejectedValue(new Error('status is down'))
    const { api } = await mountHookOnAppClient(useBackupStatus)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: backupKeys.status
    })
    expect(sileoError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})

describe('useBackupList', () => {
  it('reads the list once and caches it at backupKeys.list', async () => {
    listBackupsService.mockResolvedValue(backups)
    const { queryClient, api } = await mountHook(useBackupList)
    expect(api().isLoading).toBe(true)
    expect(api().data).toBeUndefined()

    await act(async () => {
      await vi.waitFor(() => expect(api().data).toEqual(backups))
    })

    expect(listBackupsService).toHaveBeenCalledTimes(1)
    expect(getBackupStatusService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(queryClient.getQueryData(backupKeys.list)).toEqual(backups)
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    listBackupsService.mockRejectedValue(new Error('list is down'))
    const { api } = await mountHookOnAppClient(useBackupList)

    await act(async () => {
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: backupKeys.list
    })
    expect(sileoError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })
})

describe('useCreateBackup', () => {
  it('creates a backup with no arguments, marks the backup queries and the settings stale, and toasts once', async () => {
    createBackupNowService.mockResolvedValue({ filePath: '/tmp/b.zip' })
    const { queryClient, api } = await mountHook(useCreateBackup)
    seedCaches(queryClient)

    await act(async () => {
      await api().mutateAsync()
    })

    // React Query hands a mutationFn (variables, context); the service takes
    // none, so it must be called bare.
    expect(createBackupNowService).toHaveBeenCalledTimes(1)
    expect(createBackupNowService).toHaveBeenCalledWith()
    expect(queryClient.getQueryState(backupKeys.status)?.isInvalidated).toBe(
      true
    )
    expect(queryClient.getQueryState(backupKeys.list)?.isInvalidated).toBe(true)
    // A stale cached `lastBackupAt` would be posted back by the next save.
    expect(queryClient.getQueryState(settingsKeys.all)?.isInvalidated).toBe(
      true
    )
    expect(sileoSuccess).toHaveBeenCalledTimes(1)
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'settings:dataControls.backupNow.successToast'
    })
    expect(sileoError).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('is pending while the backup runs and settles afterwards', async () => {
    let finish!: (value: { filePath: string }) => void
    createBackupNowService.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { api } = await mountHook(useCreateBackup)
    expect(api().isPending).toBe(false)

    await act(async () => {
      api().mutate()
      await vi.waitFor(() => expect(api().isPending).toBe(true))
    })

    await act(async () => {
      finish({ filePath: '/tmp/b.zip' })
      await vi.waitFor(() => expect(api().isPending).toBe(false))
    })
    expect(sileoSuccess).toHaveBeenCalledTimes(1)
  })

  it('a failed backup reaches the global handler only: one report, one toast, nothing invalidated', async () => {
    createBackupNowService.mockRejectedValue(new Error('disk full'))
    const { queryClient, api } = await mountHookOnAppClient(useCreateBackup)
    seedCaches(queryClient)

    await act(async () => {
      await api()
        .mutateAsync()
        .catch(() => {})
    })

    expect(queryClient.getQueryState(backupKeys.status)?.isInvalidated).toBe(
      false
    )
    expect(queryClient.getQueryState(backupKeys.list)?.isInvalidated).toBe(
      false
    )
    expect(queryClient.getQueryState(settingsKeys.all)?.isInvalidated).toBe(
      false
    )
    expect(sileoSuccess).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
      mutationKey: undefined
    })
    // The component has no catch of its own, so this is the only error toast:
    // a second one here would be the double-toast the hook exists to avoid.
    expect(sileoError).toHaveBeenCalledTimes(1)
    expect(sileoError).toHaveBeenCalledWith({
      title: 'settings:dataControls.backupNow.errorToast',
      description: 'disk full'
    })
  })

  it('a mounted settings reader re-reads after a backup, so it holds the new lastBackupAt', async () => {
    const before = { ...settings, lastBackupAt: '2026-09-22T03:00:00.000Z' }
    const after = { ...settings, lastBackupAt: '2026-09-23T10:15:00.000Z' }
    fetcherMock.mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    createBackupNowService.mockResolvedValue({ filePath: '/tmp/b.zip' })
    const { api } = await mountHook(() => ({
      settings: useSettings(),
      backup: useCreateBackup()
    }))

    await act(async () => {
      await vi.waitFor(() => expect(api().settings.data).toEqual(before))
    })
    expect(fetcherMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await api().backup.mutateAsync()
      await vi.waitFor(() => expect(api().settings.data).toEqual(after))
    })

    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(fetcherMock).toHaveBeenLastCalledWith('/api/v1/settings')
  })
})
