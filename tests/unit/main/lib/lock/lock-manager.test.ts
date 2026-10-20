import { beforeEach, describe, expect, it, vi } from 'vitest'

const pinStore = {
  hasPin: vi.fn(() => true),
  setPin: vi.fn(),
  verify: vi.fn(() => false),
  clear: vi.fn()
}
const config = {
  readConfig: vi.fn(() => ({
    touchIdEnabled: false,
    idleTimeoutMs: 0,
    lockOnLaunch: false,
    lockOnSystemSleep: false
  })),
  writeConfig: vi.fn((p) => ({
    touchIdEnabled: false,
    idleTimeoutMs: 0,
    lockOnLaunch: false,
    lockOnSystemSleep: false,
    ...p
  }))
}
vi.mock('@main/lib/lock/pin-store', () => pinStore)
vi.mock('@main/lib/lock/lock-config', () => config)
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  pinStore.hasPin.mockReturnValue(true)
  pinStore.verify.mockReturnValue(false)
})

describe('LockManager', () => {
  it('starts unlocked and emits on lock', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager()
    expect(m.isLocked()).toBe(false)
    const spy = vi.fn()
    m.on('state-changed', spy)
    m.lock('manual')
    expect(m.isLocked()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not lock when no pin is set', async () => {
    pinStore.hasPin.mockReturnValue(false)
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager()
    m.lock('manual')
    expect(m.isLocked()).toBe(false)
  })

  it('unlock fails with wrong pin and succeeds with right pin', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager()
    m.lock('manual')
    expect(m.unlock('000000')).toEqual({
      ok: false,
      reason: 'wrong-pin',
      retryAfterMs: 0
    })
    pinStore.verify.mockReturnValue(true)
    expect(m.unlock('123456')).toEqual({ ok: true })
    expect(m.isLocked()).toBe(false)
  })

  it('locks out after 5 wrong attempts', async () => {
    const now = vi.fn(() => 1_000_000)
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager(now)
    m.lock('manual')
    for (let i = 0; i < 5; i++) m.unlock('000000')
    const res = m.unlock('000000')
    expect(res).toEqual({
      ok: false,
      reason: 'locked-out',
      retryAfterMs: 30000
    })
    now.mockReturnValue(1_000_000 + 30001)
    expect(m.unlock('000000')).toEqual({
      ok: false,
      reason: 'wrong-pin',
      retryAfterMs: 0
    })
  })

  it('rate-limits disable() after lockout', async () => {
    const now = vi.fn(() => 1_000_000)
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager(now)
    for (let i = 0; i < 5; i++) m.unlock('000000') // trip lockout
    // disable must refuse while locked out, even with the correct pin
    pinStore.verify.mockReturnValue(true)
    expect(m.disable('123456')).toBe(false)
    now.mockReturnValue(1_000_000 + 30001)
    expect(m.disable('123456')).toBe(true)
  })

  it('setPin enrolls only when no pin exists and refuses otherwise', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    pinStore.hasPin.mockReturnValue(false)
    const m = new LockManager()
    expect(m.setPin('123456')).toBe(true)
    // once a pin exists, setPin refuses (must use changePin)
    pinStore.hasPin.mockReturnValue(true)
    expect(m.setPin('999999')).toBe(false)
  })

  it('changePin records wrong attempts toward lockout', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    // A fixed clock: `retryAfterMs` is "locked until" minus now, so on the real
    // one a single millisecond between the last attempt and the assertion made
    // it 29999 — which a loaded full-suite run did often enough to flake.
    const m = new LockManager(() => 1_000_000)
    pinStore.verify.mockReturnValue(false)
    for (let i = 0; i < 5; i++) m.changePin('000000', '111111')
    // now locked out: a correct unlock attempt is refused
    pinStore.verify.mockReturnValue(true)
    expect(m.unlock('123456')).toEqual({
      ok: false,
      reason: 'locked-out',
      retryAfterMs: 30000
    })
  })

  it('confirmPin shares the lock screen lockout and unlocks a locked app', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    const m = new LockManager(() => 1_000_000)
    pinStore.verify.mockReturnValue(false)
    for (let i = 0; i < 4; i++)
      expect(m.confirmPin('0000')).toEqual({
        ok: false,
        reason: 'wrong-pin',
        retryAfterMs: 0
      })
    expect(m.confirmPin('0000')).toEqual({
      ok: false,
      reason: 'locked-out',
      retryAfterMs: 30000
    })
    pinStore.verify.mockReturnValue(true)
    // Locked out for the lock screen too.
    expect(m.unlock('123456')).toMatchObject({
      ok: false,
      reason: 'locked-out'
    })

    const n = new LockManager()
    n.lock('idle')
    expect(n.confirmPin('123456')).toEqual({ ok: true })
    expect(n.isLocked()).toBe(false)
  })

  it('confirmPin refuses when no PIN is set', async () => {
    const { LockManager } = await import('@main/lib/lock/lock-manager')
    pinStore.hasPin.mockReturnValue(false)
    expect(new LockManager().confirmPin('1234')).toEqual({
      ok: false,
      reason: 'no-pin',
      retryAfterMs: 0
    })
  })
})
