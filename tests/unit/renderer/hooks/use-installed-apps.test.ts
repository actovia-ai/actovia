// @vitest-environment happy-dom
import type { InstalledApp } from '@actovia/shared/types/computer-use'
import {
  focusManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

const getInstalledAppsService = vi.fn()
vi.mock('@/services/computer-use', () => ({
  getInstalledApps: (...args: unknown[]) => getInstalledAppsService(...args)
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

const { installedAppsKeys, useInstalledApps } =
  await import('@/hooks/use-installed-apps')
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

async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
  let rerender!: () => void
  const { queryClient } = await renderWithQueryClient(
    createElement(Probe<T>, {
      hook,
      onReady: (value, next) => {
        latest = value
        rerender = next
      }
    })
  )
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

// Every mounted client listens to the one global focusManager: a root left
// mounted would answer a later test's focus toggles with requests of its own.
const mounted: Array<() => Promise<void>> = []

// Mounts on a client the test owns, so a second mount can share its cache and
// the first can be unmounted (the picker's page closing and opening again).
async function mountOn<T>(queryClient: QueryClient, hook: () => T) {
  let latest: T | undefined
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe<T>, {
          hook,
          onReady: (value) => {
            latest = value
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
  return { api: () => latest!, unmount }
}

// The app's own client, so a failing read goes through the real
// `queryCache.onError` and the query's own `retry` is what decides how often
// it is asked: no test-client `retry: false` here.
async function mountHookOnAppClient<T>(hook: () => T) {
  const queryClient = createAppQueryClient()
  return { queryClient, ...(await mountOn(queryClient, hook)) }
}

// Plain client, so `refetchOnWindowFocus` is React Query's default (true)
// unless the hook says otherwise.
const plainClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const apps: InstalledApp[] = [
  {
    name: 'Safari',
    bundleId: 'com.apple.Safari',
    path: '/Applications/Safari.app',
    icon: 'data:image/png;base64,AAAA'
  },
  {
    name: 'Notes',
    bundleId: 'com.apple.Notes',
    path: '/System/Applications/Notes.app'
  }
]

afterEach(async () => {
  vi.useRealTimers()
  for (const unmount of mounted.splice(0)) await unmount()
  focusManager.setFocused(undefined)
  getInstalledAppsService.mockReset()
  report.mockClear()
  toastError.mockClear()
})

describe('installedAppsKeys', () => {
  it('has one root key', () => {
    expect(installedAppsKeys.all).toEqual(['installed-apps'])
  })
})

describe('useInstalledApps', () => {
  it('reads the apps once through the service and caches them at installedAppsKeys.all', async () => {
    getInstalledAppsService.mockResolvedValue({ apps })
    const { queryClient, api } = await mountHook(() => useInstalledApps(true))
    expect(api().apps).toEqual([])

    await act(async () => {
      await vi.waitFor(() => expect(api().apps).toEqual(apps))
    })

    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(installedAppsKeys.all)).toEqual({ apps })
    expect(Object.keys(api())).toEqual(['apps', 'isLoading'])
  })

  it('makes no request, and is not loading, while disabled', async () => {
    vi.useFakeTimers()
    const { api } = await mountHook(() => useInstalledApps(false))

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await advance(60_000)

    expect(getInstalledAppsService).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(api().apps).toEqual([])
  })

  it('starts reading once it is enabled', async () => {
    getInstalledAppsService.mockResolvedValue({ apps })
    let enabled = false
    const { api, rerender } = await mountHook(() => useInstalledApps(enabled))
    expect(getInstalledAppsService).not.toHaveBeenCalled()

    enabled = true
    await rerender()
    await act(async () => {
      await vi.waitFor(() => expect(api().apps).toEqual(apps))
    })

    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
  })

  it('is loading while the scan runs and settles when it returns', async () => {
    let finish!: (value: { apps: InstalledApp[] }) => void
    getInstalledAppsService.mockReturnValue(
      new Promise<{ apps: InstalledApp[] }>((resolve) => {
        finish = resolve
      })
    )
    const { api } = await mountHook(() => useInstalledApps(true))

    expect(api().isLoading).toBe(true)
    expect(api().apps).toEqual([])

    await act(async () => {
      finish({ apps })
      await vi.waitFor(() => expect(api().isLoading).toBe(false))
    })

    expect(api().apps).toEqual(apps)
  })

  it('does not read again for a mount within 60 s, and does from 60 s on', async () => {
    vi.useFakeTimers()
    getInstalledAppsService.mockResolvedValue({ apps })
    const queryClient = plainClient()
    const first = await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)
    expect(first.api().apps).toEqual(apps)
    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
    await first.unmount()

    await advance(59_999)
    const second = await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)
    expect(second.api().apps).toEqual(apps)
    expect(second.api().isLoading).toBe(false)
    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
    await second.unmount()

    await advance(1)
    const third = await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)
    expect(third.api().apps).toEqual(apps)
    expect(getInstalledAppsService).toHaveBeenCalledTimes(2)
  })

  it('shows the apps it already has while a stale read is repeated', async () => {
    vi.useFakeTimers()
    let finish!: (value: { apps: InstalledApp[] }) => void
    getInstalledAppsService.mockResolvedValueOnce({ apps }).mockReturnValueOnce(
      new Promise<{ apps: InstalledApp[] }>((resolve) => {
        finish = resolve
      })
    )
    const queryClient = plainClient()
    const first = await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)
    await first.unmount()
    await advance(60_000)

    const second = await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)

    expect(getInstalledAppsService).toHaveBeenCalledTimes(2)
    expect(second.api().apps).toEqual(apps)
    expect(second.api().isLoading).toBe(false)

    finish({ apps: [apps[1]] })
    await advance(0)
    expect(second.api().apps).toEqual([apps[1]])
  })

  it('does not re-read when the window regains focus, even after the apps are stale', async () => {
    vi.useFakeTimers()
    getInstalledAppsService.mockResolvedValue({ apps })
    const queryClient = plainClient()
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      undefined
    )
    await mountOn(queryClient, () => useInstalledApps(true))
    await advance(0)
    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
    await advance(120_000)

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await advance(0)

    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
  })

  it('a failed read is reported once and never toasted, is not repeated, and leaves apps empty', async () => {
    vi.useFakeTimers()
    getInstalledAppsService.mockRejectedValue(new Error('helper is missing'))
    const { queryClient, api } = await mountHookOnAppClient(() =>
      useInstalledApps(true)
    )

    await advance(0)

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: installedAppsKeys.all
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(api().isLoading).toBe(false)
    expect(api().apps).toEqual([])
    expect(queryClient.getQueryData(installedAppsKeys.all)).toBeUndefined()

    // list-apps scans the app directories and renders every icon: a permanent
    // failure (missing helper, no permission) must not be scanned four times.
    await advance(30_000)
    expect(getInstalledAppsService).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(1)
  })
})
