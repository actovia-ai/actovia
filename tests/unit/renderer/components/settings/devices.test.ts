// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { HttpError } from '@actovia/shared/utils/http'
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DevicesState } from '@/services/devices'

// `t` must keep its identity across renders, as i18next's does: the paired
// toast is an effect over `[data, t]`.
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join(',')})` : key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
  Trans: ({ children }: { children?: unknown }) => children ?? null
}))
vi.mock('@/lib/i18n', () => ({
  i18n: {
    exists: (key: string) => key === 'errors:code.DEVICES_UNAVAILABLE',
    t: (key: string) => (key.startsWith('errors:') ? `localized(${key})` : key)
  }
}))
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

const { Devices } = await import('@/components/settings/settings-form/devices')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<() => Promise<void>> = []

async function mount() {
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Devices)
      )
    )
  })
  mounted.push(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
  return { host, queryClient }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Real timers: the change reaches the tree a macrotask after the request
// settled (React Query notifies through a `setTimeout(0)`).
async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  })
}

const byTestId = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
const dialogButton = (label: string) =>
  [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="alertdialog"] button'
    )
  ].find((button) => button.textContent === label) ?? null

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
const stateOf = (over: Partial<DevicesState> = {}): DevicesState =>
  JSON.parse(
    JSON.stringify({ devices: [], pairing: null, lanRunning: true, ...over })
  ) as DevicesState

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

describe('Devices: what its buttons write', () => {
  it('"Pair a device" opens a pairing window with no arguments, then shows it, with no toast', async () => {
    getDevicesService
      .mockResolvedValueOnce(stateOf())
      .mockResolvedValue(stateOf({ pairing: pairingInfo }))
    openPairingService.mockResolvedValue(pairingInfo)
    await mount()
    await flush()
    expect(byTestId(TEST_IDS.devices.qrCode)).toBeNull()

    await click(byTestId(TEST_IDS.devices.pairButton))
    await flush()

    expect(openPairingService).toHaveBeenCalledTimes(1)
    expect(openPairingService).toHaveBeenCalledWith()
    expect(getDevicesService).toHaveBeenCalledTimes(2)
    expect(byTestId(TEST_IDS.devices.qrCode)).not.toBeNull()
    expect(byTestId(TEST_IDS.devices.pairButton)).toBeNull()
    expect(sileoSuccess).not.toHaveBeenCalled()
    expect(sileoError).not.toHaveBeenCalled()
  })

  it('"Cancel" closes the window with no arguments and shows the invitation again', async () => {
    getDevicesService
      .mockResolvedValueOnce(stateOf({ pairing: pairingInfo }))
      .mockResolvedValue(stateOf())
    cancelPairingService.mockResolvedValue()
    await mount()
    await flush()

    await click(byTestId(TEST_IDS.devices.cancelPairingButton))
    await flush()

    expect(cancelPairingService).toHaveBeenCalledTimes(1)
    expect(cancelPairingService).toHaveBeenCalledWith()
    expect(byTestId(TEST_IDS.devices.pairButton)).not.toBeNull()
    expect(byTestId(TEST_IDS.devices.qrCode)).toBeNull()
  })

  it('revoking asks first, then revokes exactly that device, closes the confirmation and re-reads the list', async () => {
    getDevicesService
      .mockResolvedValueOnce(stateOf({ devices: [iphone] }))
      .mockResolvedValue(stateOf())
    revokeDeviceService.mockResolvedValue()
    await mount()
    await flush()
    expect(byTestId(TEST_IDS.devices.deviceRow)).not.toBeNull()

    await click(byTestId(TEST_IDS.devices.revokeButton))
    await flush()
    expect(revokeDeviceService).not.toHaveBeenCalled()
    await click(dialogButton('devices.revokeDialog.confirm'))
    await flush()

    expect(revokeDeviceService).toHaveBeenCalledTimes(1)
    expect(revokeDeviceService).toHaveBeenCalledWith('dev-1')
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
    expect(getDevicesService).toHaveBeenCalledTimes(2)
    expect(byTestId(TEST_IDS.devices.deviceRow)).toBeNull()
    expect(sileoSuccess).not.toHaveBeenCalled()
    expect(sileoError).not.toHaveBeenCalled()
  })

  it('"Reset all" asks first, then resets with no arguments and re-reads the list', async () => {
    getDevicesService
      .mockResolvedValueOnce(stateOf({ devices: [iphone] }))
      .mockResolvedValue(stateOf())
    resetDevicesService.mockResolvedValue()
    await mount()
    await flush()

    await click(byTestId(TEST_IDS.devices.resetButton))
    await flush()
    expect(resetDevicesService).not.toHaveBeenCalled()
    await click(dialogButton('devices.reset.confirm'))
    await flush()

    expect(resetDevicesService).toHaveBeenCalledTimes(1)
    expect(resetDevicesService).toHaveBeenCalledWith()
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
    expect(getDevicesService).toHaveBeenCalledTimes(2)
    expect(byTestId(TEST_IDS.devices.deviceRow)).toBeNull()
  })

  it('a failed write is one toast with the localized message and one report, from the global handler alone, and the page re-reads anyway', async () => {
    getDevicesService.mockResolvedValue(stateOf())
    openPairingService.mockRejectedValue(
      new HttpError(
        503,
        'DEVICES_UNAVAILABLE',
        'HTTP error! status: 503',
        undefined,
        false
      )
    )
    await mount()
    await flush()

    await click(byTestId(TEST_IDS.devices.pairButton))
    await flush()

    expect(sileoError).toHaveBeenCalledTimes(1)
    expect(sileoError).toHaveBeenCalledWith({
      title: 'settings:devices.toast.failedTitle',
      description: 'localized(errors:code.DEVICES_UNAVAILABLE)'
    })
    expect(report).toHaveBeenCalledTimes(1)
    expect(getDevicesService).toHaveBeenCalledTimes(2)
    expect(byTestId(TEST_IDS.devices.pairButton)).not.toBeNull()
  })
})

describe('Devices: the "device paired" toast', () => {
  it('says so once when a device appears while a window was open, and not for the polls that changed nothing', async () => {
    vi.useFakeTimers()
    getDevicesService
      .mockResolvedValueOnce(stateOf({ pairing: pairingInfo }))
      .mockResolvedValueOnce(stateOf({ pairing: pairingInfo }))
      .mockResolvedValueOnce(stateOf({ pairing: pairingInfo }))
      .mockResolvedValue(stateOf({ devices: [iphone] }))
    await mount()
    await advance(1)
    expect(getDevicesService).toHaveBeenCalledTimes(1)

    await advance(1500)
    await advance(1500)
    await advance(1)
    expect(getDevicesService).toHaveBeenCalledTimes(3)
    expect(sileoSuccess).not.toHaveBeenCalled()

    await advance(1500)
    await advance(1)
    expect(getDevicesService).toHaveBeenCalledTimes(4)
    expect(sileoSuccess).toHaveBeenCalledTimes(1)
    // The name is in the description: sileo capitalises a title's words.
    expect(sileoSuccess).toHaveBeenCalledWith({
      title: 'devices.toast.pairedTitle',
      description: 'iPhone'
    })
    expect(byTestId(TEST_IDS.devices.deviceRow)).not.toBeNull()

    // The window is closed now, so nothing polls and nothing toasts again.
    await advance(60_000)
    expect(getDevicesService).toHaveBeenCalledTimes(4)
    expect(sileoSuccess).toHaveBeenCalledTimes(1)
  })

  it('stays quiet about a device that appears while no window was open', async () => {
    getDevicesService
      .mockResolvedValueOnce(stateOf())
      .mockResolvedValue(stateOf({ devices: [iphone] }))
    const { queryClient } = await mount()
    await flush()

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
    })
    await flush()

    expect(getDevicesService).toHaveBeenCalledTimes(2)
    expect(byTestId(TEST_IDS.devices.deviceRow)).not.toBeNull()
    expect(sileoSuccess).not.toHaveBeenCalled()
  })
})
