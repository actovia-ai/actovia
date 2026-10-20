import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const current = vi.fn()
const verify = vi.fn()
const syncLan = vi.fn(async () => {})
vi.mock('@main/lib/lan', () => ({
  pairing: { current: () => current(), verify: (code: string) => verify(code) },
  syncLan: () => syncLan()
}))

const registerDevice = vi.fn(async () => ({
  deviceId: 'dev-1',
  token: 'TOKEN'
}))
const leaveDevice = vi.fn(async () => {})
const findDevice = vi.fn(async (id: string) =>
  id === 'dev-1' ? { id: 'dev-1', name: 'iPhone' } : null
)
vi.mock('@main/lib/lan/devices', () => ({
  registerDevice: (name: string) => registerDevice(name),
  leaveDevice: (id: string) => leaveDevice(id),
  findDevice: (id: string) => findDevice(id)
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { default: pairRouter } = await import('@main/lib/server/routes/pair')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const app = new Hono<{ Variables: { deviceId?: string } }>()
// What authGate does on the lan listener: the token's device, by id.
app.use('/api/*', async (c, next) => {
  const device = c.req.header('x-test-device')
  if (device) c.set('deviceId', device)
  await next()
})
app.route('/api/v1/pair', pairRouter)
app.onError(errorHandler)

const post = (body: unknown) =>
  app.request('/api/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(() => {
  vi.clearAllMocks()
  current.mockReturnValue({ code: 'right', expiresAt: Date.now() + 60_000 })
  verify.mockImplementation((code: string) =>
    code === 'right' ? 'ok' : 'wrong'
  )
})

describe('POST /api/v1/pair', () => {
  it('does not exist outside a pairing window', async () => {
    current.mockReturnValue(null)
    const res = await post({ code: 'right', deviceName: 'iPhone' })

    expect(res.status).toBe(404)
    expect(verify).not.toHaveBeenCalled()
    expect(registerDevice).not.toHaveBeenCalled()
  })

  it('refuses a wrong code and registers nothing', async () => {
    const res = await post({ code: 'guess', deviceName: 'iPhone' })

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('PAIRING_CODE_INVALID')
    expect(registerDevice).not.toHaveBeenCalled()
  })

  it('answers 404 once the guesses have closed the window', async () => {
    verify.mockReturnValue('closed')
    expect((await post({ code: 'guess', deviceName: 'iPhone' })).status).toBe(
      404
    )
  })

  it('pairs with the right code: registers the device, returns its token once, resyncs the listener', async () => {
    const res = await post({ code: 'right', deviceName: '  Yancey’s iPhone  ' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deviceId: 'dev-1', token: 'TOKEN' })
    expect(registerDevice).toHaveBeenCalledWith('Yancey’s iPhone')
    expect(syncLan).toHaveBeenCalled()
  })

  it.each([
    ['no device name', { code: 'right' }],
    ['a blank device name', { code: 'right', deviceName: '   ' }],
    ['no code', { deviceName: 'iPhone' }],
    ['an oversized name', { code: 'right', deviceName: 'x'.repeat(65) }]
  ])('rejects %s without spending the code', async (_label, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    expect(verify).not.toHaveBeenCalled()
    expect(registerDevice).not.toHaveBeenCalled()
  })
})

// The phone unpairing itself tells the computer first, so the device leaves
// Settings → Devices too instead of lingering there.
describe('DELETE /api/v1/pair', () => {
  it('removes the device that asks, and lets the listener re-check', async () => {
    const res = await app.request('/api/v1/pair', {
      method: 'DELETE',
      headers: { 'x-test-device': 'dev-7' }
    })
    expect(res.status).toBe(200)
    expect(leaveDevice).toHaveBeenCalledWith('dev-7')
    expect(syncLan).toHaveBeenCalled()
  })

  it('does not exist without a paired device (loopback)', async () => {
    const res = await app.request('/api/v1/pair', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(leaveDevice).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/pair', () => {
  it('answers a paired device who it is here', async () => {
    const res = await app.request('/api/v1/pair', {
      headers: { 'x-test-device': 'dev-1' }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deviceId: 'dev-1', name: 'iPhone' })
  })

  it('does not exist on loopback (no device) or for a device gone since', async () => {
    expect((await app.request('/api/v1/pair')).status).toBe(404)
    expect(
      (
        await app.request('/api/v1/pair', {
          headers: { 'x-test-device': 'gone' }
        })
      ).status
    ).toBe(404)
  })
})
