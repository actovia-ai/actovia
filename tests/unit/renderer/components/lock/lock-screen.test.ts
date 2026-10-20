// @vitest-environment happy-dom
import type { LockStatus } from '@actovia/shared/types/lock'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const unlockWithTouchId = vi.fn()
vi.mock('@/lib/lock-ipc', () => ({
  getRecentLockNotifications: () => Promise.resolve([]),
  onLockNotification: () => () => {},
  unlockWithPin: vi.fn(() => Promise.resolve({ ok: false })),
  unlockWithTouchId: (...args: unknown[]) => unlockWithTouchId(...args)
}))

const { LockScreen } = await import('@/components/lock/lock-screen')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function status(touchId: boolean): LockStatus {
  return {
    hasPin: true,
    locked: true,
    retryAfterMs: 0,
    touchIdAvailable: touchId,
    config: {
      touchIdEnabled: touchId,
      idleTimeoutMs: 0,
      lockOnLaunch: false,
      lockOnSystemSleep: false
    }
  }
}

async function mount(s: LockStatus, onUnlocked = vi.fn()) {
  const host = document.createElement('div')
  await act(async () =>
    createRoot(host).render(
      createElement(LockScreen, { status: s, onUnlocked })
    )
  )
  return { host, onUnlocked }
}

describe('LockScreen', () => {
  afterEach(() => unlockWithTouchId.mockClear())

  it('never prompts Touch ID on its own — only the button does', async () => {
    unlockWithTouchId.mockResolvedValue({ ok: false })
    await mount(status(true))
    expect(unlockWithTouchId).not.toHaveBeenCalled()
  })

  it('shows the button when Touch ID is available and enabled, and it unlocks on success', async () => {
    unlockWithTouchId.mockResolvedValue({ ok: true })
    const { host, onUnlocked } = await mount(status(true))

    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="lock.touch-id-button"]'
    )!
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(unlockWithTouchId).toHaveBeenCalledTimes(1)
    expect(onUnlocked).toHaveBeenCalledTimes(1)
  })

  it('has no button, and never calls Touch ID, when it is unavailable or off', async () => {
    unlockWithTouchId.mockResolvedValue({ ok: false })
    const { host } = await mount(status(false))
    expect(
      host.querySelector('[data-testid="lock.touch-id-button"]')
    ).toBeNull()
    expect(unlockWithTouchId).not.toHaveBeenCalled()
  })
})
