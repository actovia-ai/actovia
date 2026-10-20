// @vitest-environment happy-dom
import { HttpError } from '@actovia/shared/utils/http'
import {
  focusManager,
  type QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DevicesState } from '@/services/devices'

const getDevicesService = vi.fn()
const openPairingService = vi.fn()
const cancelPairingService = vi.fn()
const revokeDeviceService = vi.fn()
const resetDevicesService = vi.fn()
vi.mock('@/services/devices', () => ({
  getDevices: (...args: unknown[]) => getDevicesService(...args),
  openPairing: (...args: unknown[]) => openPairingService(...args),
  cancelPairing: (...args: unknown[]) => cancelPairingService(...args),
  revokeDevice: (...args: unknown[]) => revokeDeviceService(...args),
  resetDevices: (...args: unknown[]) => resetDevicesService(...args)
}))
// The copy resolves to its own key; an `errors:` key is "translated" and only
// one code exists, so a message that skipped the localization shows in the
// assertion.
vi.mock('@/lib/i18n', () => ({
  i18n: {
    exists: (key: string) => key === 'errors:code.DEVICES_UNAVAILABLE',
    t: (key: string) => (key.startsWith('errors:') ? `localized(${key})` : key)
  }
}))
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

const {
  devicesKeys,
  useDevices,
  useOpenPairing,
  useCancelPairing,
  useRevokeDevice,
  useResetDevices
} = await import('@/hooks/use-devices')
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

// Every mounted client listens to the one global focusManager, and a polling
// observer keeps its interval until it unmounts: a root left mounted would
// answer a later test's focus toggles and timers with requests of its own.
const mounted: Array<() => Promise<void>> = []

// The app's own client, so a failing write goes through the real
// `mutationCache.onError` and a failing read through `queryCache.onError`, and
// the app-wide defaults are the ones under test. Retries off so a failure
// lands without a backoff.
async function mountHook<T>(hook: () => T) {
  let latest: T | undefined
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
          onReady: (value) => (latest = value)
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
  return { queryClient, api: () => latest!, unmount }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// React Query tells its observers through a `setTimeout(0)`, which fake timers
// turn into 1 ms when it is set during a tick (a poll's): the change reaches
// what the hook returned one millisecond after the poll.
async function settle() {
  await advance(1)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const pairingInfo = {
  expiresAt: 1_800_000_000_000,
  link: 'actovia://pair?h=192.168.1.5&p=63129&c=123456&f=abc&n=Mac'
}
const iphone = {
  id: 'dev-1',
  name: 'iPhone',
  createdAt: '2026-09-20T10:00:00.000Z',
  lastSeenAt: null
}

// The route's JSON: a fresh, equal object on every call — what a poll
// actually hands React Query.
const stateOf = (over: Partial<DevicesState> = {}): DevicesState =>
  JSON.parse(
    JSON.stringify({ devices: [], pairing: null, lanRunning: true, ...over })
  ) as DevicesState
const open = () => stateOf({ pairing: pairingInfo })
const closed = () => stateOf()

afterEach(async () => {
  vi.useRealTimers()
  for (const unmount of mounted.splice(0)) await unmount()
  focusManager.setFocused(undefined)
  getDevicesService.mockReset()
  openPairingService.mockReset()
  cancelPairingService.mockReset()
  revokeDeviceService.mockReset()
  resetDevicesService.mockReset()
  report.mockClear()
  sileoSuccess.mockClear()
  sileoError.mockClear()
})

describe('devicesKeys', () => {
  it('has one root key', () => {
    expect(devicesKeys.all).toEqual(['devices'])
  })
})

describe('useDevices', () => {
  it('reads the devices once through the service with no arguments, caches them at devicesKeys.all, and returns only data', async () => {
    const first = deferred<DevicesState>()
    getDevicesService.mockReturnValue(first.promise)
    const { queryClient, api } = await mountHook(useDevices)
    expect(api().data).toBeUndefined()

    const state = stateOf({ devices: [iphone] })
    await act(async () => {
      first.resolve(state)
      await vi.waitFor(() => expect(api().data).toEqual(state))
    })

    // React Query hands a queryFn its context; the service takes nothing.
    expect(getDevicesService).toHaveBeenCalledTimes(1)
    expect(getDevicesService).toHaveBeenCalledWith()
    expect(queryClient.getQueryData(devicesKeys.all)).toEqual(state)
    expect(Object.keys(api())).toEqual(['data'])
  })

  it('a failed read is reported and never toasted, and leaves the data undefined', async () => {
    getDevicesService.mockRejectedValue(new Error('devices are down'))
    const { api } = await mountHook(useDevices)

    await act(async () => {
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    })

    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: devicesKeys.all
    })
    expect(sileoError).not.toHaveBeenCalled()
    expect(api().data).toBeUndefined()
  })

  describe('polling', () => {
    it('makes no further request, however long it waits, while no pairing window is open', async () => {
      vi.useFakeTimers()
      getDevicesService.mockImplementation(() => Promise.resolve(closed()))
      await mountHook(useDevices)
      await advance(0)
      expect(getDevicesService).toHaveBeenCalledTimes(1)

      await advance(60_000)

      expect(getDevicesService).toHaveBeenCalledTimes(1)
    })

    it('re-reads every 1500 ms while a pairing window is open, and stops after a response with none', async () => {
      vi.useFakeTimers()
      getDevicesService
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(open())
        .mockResolvedValue(closed())
      await mountHook(useDevices)
      await advance(0)
      expect(getDevicesService).toHaveBeenCalledTimes(1)

      await advance(1499)
      expect(getDevicesService).toHaveBeenCalledTimes(1)
      await advance(1)
      expect(getDevicesService).toHaveBeenCalledTimes(2)

      // Still open: the next tick comes a full interval later.
      await advance(1499)
      expect(getDevicesService).toHaveBeenCalledTimes(2)
      await advance(1)
      expect(getDevicesService).toHaveBeenCalledTimes(3)

      // That response had no pairing window: the polling is over.
      await advance(60_000)
      expect(getDevicesService).toHaveBeenCalledTimes(3)
    })

    it('starts polling once a read shows a pairing window (the read after opening one), and stops when it shows none', async () => {
      vi.useFakeTimers()
      getDevicesService
        .mockResolvedValueOnce(closed())
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(open())
        .mockResolvedValue(closed())
      const { queryClient } = await mountHook(useDevices)
      await advance(0)
      await advance(60_000)
      expect(getDevicesService).toHaveBeenCalledTimes(1)

      // What the mutations' settle does: mark the list stale and re-read.
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: devicesKeys.all })
      })
      expect(getDevicesService).toHaveBeenCalledTimes(2)

      await advance(1500)
      expect(getDevicesService).toHaveBeenCalledTimes(3)
      await advance(1500)
      expect(getDevicesService).toHaveBeenCalledTimes(4)
      await advance(60_000)
      expect(getDevicesService).toHaveBeenCalledTimes(4)
    })

    it('keeps polling while the window is blurred or hidden: the QR code is scanned from a phone, not from this window', async () => {
      vi.useFakeTimers()
      getDevicesService.mockImplementation(() => Promise.resolve(open()))
      await mountHook(useDevices)
      await advance(0)
      expect(getDevicesService).toHaveBeenCalledTimes(1)

      await act(async () => {
        focusManager.setFocused(false)
      })
      expect(focusManager.isFocused()).toBe(false)

      await advance(1500)
      expect(getDevicesService).toHaveBeenCalledTimes(2)
      await advance(1500)
      expect(getDevicesService).toHaveBeenCalledTimes(3)
    })

    it('stops polling when the page unmounts', async () => {
      vi.useFakeTimers()
      getDevicesService.mockImplementation(() => Promise.resolve(open()))
      const { unmount } = await mountHook(useDevices)
      await advance(0)
      await advance(1500)
      expect(getDevicesService).toHaveBeenCalledTimes(2)

      await unmount()
      await advance(60_000)

      expect(getDevicesService).toHaveBeenCalledTimes(2)
    })
  })

  describe('on window focus', () => {
    it("reads again when the window regains focus, so a phone's last-seen time shows up, although the app turns that off", async () => {
      const seen = { ...iphone, lastSeenAt: '2026-09-24T08:00:00.000Z' }
      getDevicesService
        .mockResolvedValueOnce(stateOf({ devices: [iphone] }))
        .mockResolvedValueOnce(stateOf({ devices: [seen] }))
      const { queryClient, api } = await mountHook(useDevices)
      await act(async () => {
        await vi.waitFor(() => expect(api().data?.devices).toEqual([iphone]))
      })
      expect(
        queryClient.getDefaultOptions().queries?.refetchOnWindowFocus
      ).toBe(false)

      await act(async () => {
        focusManager.setFocused(false)
      })
      expect(getDevicesService).toHaveBeenCalledTimes(1)

      await act(async () => {
        focusManager.setFocused(true)
        await vi.waitFor(() => expect(api().data?.devices).toEqual([seen]))
      })

      expect(getDevicesService).toHaveBeenCalledTimes(2)
      expect(report).not.toHaveBeenCalled()
    })
  })

  describe('as a useEffect dependency (the "device paired" toast)', () => {
    it('keeps the same data object when a poll returns an equal payload, and hands out a new one when it changed', async () => {
      vi.useFakeTimers()
      const firstPoll = open()
      const equalPoll = open()
      const changedPoll = stateOf({ devices: [iphone] })
      // Fresh objects with equal content, so identity is React Query's doing.
      expect(equalPoll).not.toBe(firstPoll)
      expect(equalPoll).toEqual(firstPoll)
      getDevicesService
        .mockResolvedValueOnce(firstPoll)
        .mockResolvedValueOnce(equalPoll)
        .mockResolvedValue(changedPoll)
      const { queryClient, api } = await mountHook(useDevices)
      await settle()
      const first = api().data
      expect(first).toEqual(firstPoll)

      await advance(1500)
      await settle()
      expect(getDevicesService).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryState(devicesKeys.all)?.dataUpdateCount).toBe(
        2
      )
      expect(queryClient.getQueryData(devicesKeys.all)).toBe(first)
      expect(api().data).toBe(first)

      await advance(1500)
      await settle()
      expect(getDevicesService).toHaveBeenCalledTimes(3)
      expect(queryClient.getQueryState(devicesKeys.all)?.dataUpdateCount).toBe(
        3
      )
      expect(api().data).not.toBe(first)
      expect(api().data).toEqual(changedPoll)
    })

    it('runs an effect keyed on data once per change, not once per poll', async () => {
      vi.useFakeTimers()
      const effect = vi.fn()
      getDevicesService
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(open())
        .mockResolvedValue(stateOf({ devices: [iphone] }))
      await mountHook(() => {
        const result = useDevices()
        useEffect(() => {
          effect(result.data)
        }, [result.data])
        return result
      })
      await settle()
      // Once for the mount (no data yet), once for the first response.
      expect(effect).toHaveBeenCalledTimes(2)
      expect(effect).toHaveBeenLastCalledWith(open())

      await advance(1500)
      await advance(1500)
      await settle()
      expect(getDevicesService).toHaveBeenCalledTimes(3)
      expect(effect).toHaveBeenCalledTimes(2)

      await advance(1500)
      await settle()
      expect(getDevicesService).toHaveBeenCalledTimes(4)
      expect(effect).toHaveBeenCalledTimes(3)
      expect(effect).toHaveBeenLastCalledWith(stateOf({ devices: [iphone] }))
    })
  })
})

type Write = { mutateAsync: (variables: never) => Promise<unknown> }

const writes = [
  {
    name: 'useOpenPairing',
    hook: useOpenPairing as () => Write,
    service: openPairingService,
    variables: undefined as never,
    args: [] as unknown[],
    resolved: pairingInfo
  },
  {
    name: 'useCancelPairing',
    hook: useCancelPairing as () => Write,
    service: cancelPairingService,
    variables: undefined as never,
    args: [] as unknown[],
    resolved: undefined
  },
  {
    name: 'useRevokeDevice',
    hook: useRevokeDevice as () => Write,
    service: revokeDeviceService,
    variables: 'dev-1' as never,
    args: ['dev-1'] as unknown[],
    resolved: undefined
  },
  {
    name: 'useResetDevices',
    hook: useResetDevices as () => Write,
    service: resetDevicesService,
    variables: undefined as never,
    args: [] as unknown[],
    resolved: undefined
  }
]

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated

function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData(devicesKeys.all, closed())
  queryClient.setQueryData(['usage'], { totalCost: 0 })
}

const unavailable = () =>
  new HttpError(
    503,
    'DEVICES_UNAVAILABLE',
    'HTTP error! status: 503',
    undefined,
    false
  )

describe.each(writes)(
  '$name',
  ({ hook, service, variables, args, resolved }) => {
    it('calls its service with exactly its own arguments, nothing React Query adds', async () => {
      service.mockResolvedValue(resolved)
      const { api } = await mountHook(hook)

      await act(async () => {
        await api().mutateAsync(variables)
      })

      expect(service).toHaveBeenCalledTimes(1)
      expect(service).toHaveBeenCalledWith(...args)
      expect(service.mock.calls[0]).toHaveLength(args.length)
    })

    it('marks the devices list stale and touches nothing else, and toasts nothing on success', async () => {
      service.mockResolvedValue(resolved)
      const { queryClient, api } = await mountHook(hook)
      seedCaches(queryClient)

      await act(async () => {
        await api().mutateAsync(variables)
      })

      expect(isInvalidated(queryClient, devicesKeys.all)).toBe(true)
      expect(isInvalidated(queryClient, ['usage'])).toBe(false)
      expect(sileoSuccess).not.toHaveBeenCalled()
      expect(sileoError).not.toHaveBeenCalled()
      expect(report).not.toHaveBeenCalled()
    })

    it('a failure is one toast with the localized message and one report, and still marks the list stale (the server may have changed before it failed)', async () => {
      service.mockRejectedValue(unavailable())
      const { queryClient, api } = await mountHook(hook)
      seedCaches(queryClient)

      let rejection: unknown
      await act(async () => {
        await api()
          .mutateAsync(variables)
          .catch((error: unknown) => (rejection = error))
      })

      expect(rejection).toBeInstanceOf(HttpError)
      expect(report).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
        mutationKey: undefined
      })
      expect(sileoError).toHaveBeenCalledTimes(1)
      expect(sileoError).toHaveBeenCalledWith({
        title: 'settings:devices.toast.failedTitle',
        description: 'localized(errors:code.DEVICES_UNAVAILABLE)'
      })
      expect(sileoSuccess).not.toHaveBeenCalled()
      expect(isInvalidated(queryClient, devicesKeys.all)).toBe(true)
      expect(isInvalidated(queryClient, ['usage'])).toBe(false)
    })

    it('a failure that is not an HttpError shows its own message', async () => {
      service.mockRejectedValue(new Error('socket hang up'))
      const { api } = await mountHook(hook)

      await act(async () => {
        await api()
          .mutateAsync(variables)
          .catch(() => {})
      })

      expect(sileoError).toHaveBeenCalledTimes(1)
      expect(sileoError).toHaveBeenCalledWith({
        title: 'settings:devices.toast.failedTitle',
        description: 'socket hang up'
      })
    })

    it.each([
      ['succeeds', () => service.mockResolvedValue(resolved)],
      ['fails', () => service.mockRejectedValue(unavailable())]
    ])(
      'settles only once the mounted list has re-read when it %s, so the page never shows the state from before the write',
      async (_outcome, arrange) => {
        const refreshed = deferred<DevicesState>()
        getDevicesService
          .mockResolvedValueOnce(closed())
          .mockReturnValueOnce(refreshed.promise)
        arrange()
        const { api } = await mountHook(() => ({
          list: useDevices(),
          write: hook()
        }))
        await act(async () => {
          await vi.waitFor(() => expect(api().list.data).toEqual(closed()))
        })

        let settled = false
        await act(async () => {
          void api()
            .write.mutateAsync(variables)
            .catch(() => {})
            .then(() => {
              settled = true
            })
          await vi.waitFor(() =>
            expect(getDevicesService).toHaveBeenCalledTimes(2)
          )
        })
        expect(settled).toBe(false)

        const after = stateOf({ devices: [iphone] })
        await act(async () => {
          refreshed.resolve(after)
          await vi.waitFor(() => expect(settled).toBe(true))
        })
        expect(api().list.data).toEqual(after)
      }
    )
  }
)
