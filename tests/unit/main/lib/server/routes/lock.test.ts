import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const locked = { value: false }
const isLocked = vi.fn(() => locked.value)
const completeUnlock = vi.fn(() => {
  locked.value = false
})
const confirmPin = vi.fn()
vi.mock('@main/lib/lock/lock-manager', () => ({
  getLockManager: () => ({ isLocked, completeUnlock, confirmPin })
}))

const info = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { default: lockRouter } = await import('@main/lib/server/routes/lock')
const { isCliPass, clearCliPasses } = await import('@main/lib/cli-pass')

function makeApp(deviceId?: string) {
  const app = new Hono<{ Variables: { deviceId?: string } }>()
  app.use('/api/v1/lock/*', async (c, next) => {
    if (deviceId) c.set('deviceId', deviceId)
    await next()
  })
  app.route('/api/v1/lock', lockRouter)
  return app
}

const post = (app: Hono) =>
  app.request('/api/v1/lock/unlock', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  locked.value = false
})

describe('POST /api/v1/lock/unlock', () => {
  it('unlocks when locked, logging the device that did it', async () => {
    locked.value = true
    const res = await post(makeApp('dev-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ locked: false })
    expect(completeUnlock).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith('app', 'Unlocked by a paired device', {
      deviceId: 'dev-1'
    })
  })

  it('logs "loopback" when authGate set no deviceId', async () => {
    locked.value = true
    await post(makeApp())

    expect(info).toHaveBeenCalledWith('app', 'Unlocked by a paired device', {
      deviceId: 'loopback'
    })
  })

  it('is a no-op, and logs nothing, when already unlocked', async () => {
    locked.value = false
    const res = await post(makeApp('dev-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ locked: false })
    expect(completeUnlock).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/lock/cli-pass', () => {
  const ask = (body: unknown, listener: 'loopback' | 'lan' = 'loopback') =>
    makeApp().request(
      '/api/v1/lock/cli-pass',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      { listener }
    )

  beforeEach(() => clearCliPasses())

  it('trades the right PIN for a pass that opens the device routes', async () => {
    confirmPin.mockReturnValue({ ok: true })
    const res = await ask({ pin: '123456' })
    expect(res.status).toBe(200)
    const { token, expiresAt } = await res.json()
    expect(confirmPin).toHaveBeenCalledWith('123456')
    expect(isCliPass(token, '/api/v1/devices/pairing')).toBe(true)
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  it.each([
    ['wrong-pin', 401, 'WRONG_PIN'],
    ['locked-out', 429, 'PIN_LOCKED_OUT'],
    ['no-pin', 409, 'PIN_NOT_SET']
  ] as const)(
    'refuses %s with %i %s and issues nothing',
    async (reason, status, code) => {
      confirmPin.mockReturnValue({ ok: false, reason, retryAfterMs: 30000 })
      const res = await ask({ pin: '0000' })
      expect(res.status).toBe(status)
      const body = await res.json()
      expect(body.error.code).toBe(code)
      expect(body.error.retryAfterMs).toBe(30000)
      expect(body.token).toBeUndefined()
    }
  )

  it('checks nothing without a PIN string', async () => {
    for (const body of [
      {},
      { pin: 1234 },
      { pin: '' },
      { pin: 'x'.repeat(65) }
    ]) {
      expect((await ask(body)).status).toBe(400)
    }
    expect(confirmPin).not.toHaveBeenCalled()
  })

  it('stops issuing passes after ten wrong PINs, with no PIN checked meanwhile', async () => {
    confirmPin.mockReturnValue({
      ok: false,
      reason: 'wrong-pin',
      retryAfterMs: 0
    })
    const { recordCliPinMiss } = await import('@main/lib/cli-pass')
    for (let i = 0; i < 9; i++) recordCliPinMiss(0)
    expect((await ask({ pin: '0000' })).status).toBe(401) // the 10th miss
    confirmPin.mockClear()
    confirmPin.mockReturnValue({ ok: true })
    const res = await ask({ pin: '123456' })
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('CLI_PIN_DISABLED')
    expect(confirmPin).not.toHaveBeenCalled()
  })

  it('waits out the backoff without looking at the PIN', async () => {
    const { recordCliPinMiss } = await import('@main/lib/cli-pass')
    for (let i = 0; i < 5; i++) recordCliPinMiss()
    const res = await ask({ pin: '123456' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.retryAfterMs).toBeGreaterThan(0)
    expect(confirmPin).not.toHaveBeenCalled()
  })

  it('a right PIN clears the misses', async () => {
    const { recordCliPinMiss, cliPinGate } = await import('@main/lib/cli-pass')
    for (let i = 0; i < 3; i++) recordCliPinMiss()
    confirmPin.mockReturnValue({ ok: true })
    expect((await ask({ pin: '123456' })).status).toBe(200)
    expect(cliPinGate()).toEqual({ open: true })
  })

  it('is loopback only', async () => {
    const res = await ask({ pin: '123456' }, 'lan')
    expect(res.status).toBe(403)
    expect(confirmPin).not.toHaveBeenCalled()
  })
})
