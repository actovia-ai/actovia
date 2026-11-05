import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/lan/devices', () => ({
  authenticate: vi.fn(async (token: string) =>
    token === 'good' ? 'dev-1' : null
  )
}))

const takeRevoked = vi.fn((token: string) => token === 'revoked')
vi.mock('@main/lib/lan/revoked', () => ({ takeRevoked }))
const syncLan = vi.fn(async () => {})
vi.mock('@main/lib/lan', () => ({ syncLan }))

const { authGate } = await import('@main/lib/server/middlewares/auth-gate')

const app = new Hono<{ Variables: { deviceId?: string } }>()
app.use('/api/*', authGate)
app.get('/api/v1/history', (c) => c.text(c.get('deviceId') ?? 'no-device'))
app.post('/api/v1/pair', (c) => c.text('pairing'))
app.get('/api/v1/pair', (c) => c.text('not the pairing request'))
app.get('/api/v1/devices', (c) => c.text('devices'))
app.delete('/api/v1/devices/abc', (c) => c.text('revoked'))

const lan = { listener: 'lan' }
const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` }
})

describe('authGate', () => {
  it('requires the trusted Web entry principal, never a caller-supplied header', async () => {
    expect(
      (
        await app.request(
          '/api/v1/history',
          {
            headers: {
              'x-actovia-device-id': 'a',
              authorization: 'Bearer good'
            }
          },
          { listener: 'web' }
        )
      ).status
    ).toBe(401)
    const valid = await app.request(
      '/api/v1/history',
      {},
      { listener: 'web', webDeviceId: 'web-a' }
    )
    expect(await valid.text()).toBe('web-a')
    expect(
      (
        await app.request(
          '/api/v1/devices',
          {},
          { listener: 'web', webDeviceId: 'web-a' }
        )
      ).status
    ).toBe(403)
  })

  it('lets loopback through untouched, token or none', async () => {
    const res = await app.request('/api/v1/history')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('no-device')
    expect((await app.request('/api/v1/devices')).status).toBe(200)
  })

  it.each([
    ['no header', {}],
    ['not a bearer', { headers: { authorization: 'Basic Zm9v' } }],
    ['an empty bearer', { headers: { authorization: 'Bearer ' } }],
    ['an unknown or revoked token', bearer('nope')]
  ])('answers 401 on the lan listener with %s', async (_label, init) => {
    const res = await app.request('/api/v1/history', init, lan)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  // Revoked on the computer: this 401 is how the phone learns it and unpairs.
  // The record is used up, and the listener checks whether it is still wanted.
  it('tells a revoked device once, and lets the listener go', async () => {
    const res = await app.request('/api/v1/history', bearer('revoked'), lan)
    expect(res.status).toBe(401)
    expect(takeRevoked).toHaveBeenCalledWith('revoked')
    expect(syncLan).toHaveBeenCalled()
  })

  it('does not touch the listener for an unknown token', async () => {
    syncLan.mockClear()
    await app.request('/api/v1/history', bearer('nope'), lan)
    expect(syncLan).not.toHaveBeenCalled()
  })

  it('serves a paired device and records who it is', async () => {
    const res = await app.request('/api/v1/history', bearer('good'), lan)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('dev-1')
  })

  it('lets the pairing request in without a token — and only that request', async () => {
    const post = await app.request('/api/v1/pair', { method: 'POST' }, lan)
    expect(post.status).toBe(200)
    expect((await app.request('/api/v1/pair', {}, lan)).status).toBe(401)
  })

  it('keeps device management off the lan, token or not', async () => {
    const list = await app.request('/api/v1/devices', bearer('good'), lan)
    const revoke = await app.request(
      '/api/v1/devices/abc',
      { method: 'DELETE', ...bearer('good') },
      lan
    )
    expect(list.status).toBe(403)
    expect(revoke.status).toBe(403)
  })
})
