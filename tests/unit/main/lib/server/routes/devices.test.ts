// ISSUE-135: a LAN certificate this Mac cannot decrypt is reported to the
// Devices page, pairing is refused with a code that says why, and Reset all
// is the way back.
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let status: 'ok' | 'unreadable' = 'ok'
const openPairingWindow = vi.fn(() => ({
  code: 'c',
  expiresAt: Date.now() + 60_000
}))
const resetCertificate = vi.fn(async () => {
  status = 'ok'
  return { certPem: '', keyPem: '', fingerprint: 'new' }
})
vi.mock('@main/lib/lan', () => ({
  pairing: { current: () => null, close: vi.fn() },
  isLanRunning: () => false,
  openPairingWindow: () => openPairingWindow(),
  syncLan: vi.fn(async () => {})
}))
vi.mock('@main/lib/lan/certificate', () => ({
  certificateStatus: () => status,
  loadOrCreateCertificate: vi.fn(async () => ({ fingerprint: 'fp' })),
  resetCertificate: () => resetCertificate()
}))
vi.mock('@main/lib/lan/devices', () => ({
  listDevices: vi.fn(async () => []),
  revokeAllDevices: vi.fn(async () => {}),
  revokeDevice: vi.fn(async () => {})
}))
vi.mock('@main/lib/lan/revoked', () => ({ pendingRevocations: () => [] }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { default: devicesRouter } =
  await import('@main/lib/server/routes/devices')

const app = new Hono()
app.route('/api/v1/devices', devicesRouter)

beforeEach(() => {
  vi.clearAllMocks()
  status = 'ok'
})

describe('/api/v1/devices and an unreadable certificate', () => {
  it('GET says whether the certificate can be read', async () => {
    expect(
      (await (await app.request('/api/v1/devices')).json()).certificate
    ).toBe('ok')
    status = 'unreadable'
    expect(
      (await (await app.request('/api/v1/devices')).json()).certificate
    ).toBe('unreadable')
  })

  it('refuses to open a pairing window while it cannot be read', async () => {
    status = 'unreadable'
    const res = await app.request('/api/v1/devices/pairing', { method: 'POST' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('LAN_CERTIFICATE_UNREADABLE')
    expect(openPairingWindow).not.toHaveBeenCalled()
  })

  it('Reset all makes a new certificate and pairing works again', async () => {
    status = 'unreadable'
    await app.request('/api/v1/devices/reset', { method: 'POST' })

    expect(resetCertificate).toHaveBeenCalled()
    const res = await app.request('/api/v1/devices/pairing', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
