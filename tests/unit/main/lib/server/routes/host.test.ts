import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const quit = vi.fn()
const relaunch = vi.fn()
vi.mock('electron', () => ({
  app: { getVersion: () => '2.1.0', quit, relaunch }
}))

const locked = { value: false }
const lock = vi.fn(() => {
  locked.value = true
})
vi.mock('@main/lib/lock/lock-manager', () => ({
  getLockManager: () => ({
    isLocked: () => locked.value,
    lock,
    getStatus: () => ({ hasPin: true, locked: locked.value })
  })
}))
vi.mock('@main/lib/auto-updater', () => ({
  updaterGetState: () => ({
    state: 'available',
    availableVersion: '2.2.0',
    downloadProgress: 0,
    errorMessage: null,
    mode: 'manual'
  })
}))
vi.mock('@main/lib/db/queries', () => ({ getSettings: async () => ({}) }))
vi.mock('@main/lib/db/mcp-queries', () => ({
  getAllMcpServers: async () => []
}))
vi.mock('@main/lib/secrets/moved', () => ({ pendingMovedSecrets: () => [] }))
vi.mock('@main/lib/secrets/status', () => ({
  getSecretsStatus: () => ({ encryption: 'on', needsReentry: ['openaiKey'] })
}))
vi.mock('@main/lib/lan/devices', () => ({
  listDevices: async () => [{ id: 'd1' }, { id: 'd2' }]
}))
vi.mock('@main/lib/lan/index', () => ({ isLanRunning: () => true }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { hostRouter, hostStatusRouter } =
  await import('@main/lib/server/routes/host')

const app = new Hono()
app.route('/api/v1/host', hostStatusRouter)
app.route('/api/v1/host', hostRouter)

beforeEach(() => {
  vi.clearAllMocks()
  locked.value = false
})

describe('host routes', () => {
  it('status says what the app is, with counts only', async () => {
    const res = await app.request('/api/v1/host/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      version: '2.1.0',
      locked: false,
      pinSet: true,
      lan: { running: true, port: 63129 },
      devices: 2,
      secrets: { encryption: 'on', needsReentry: 1 },
      update: { mode: 'manual', state: 'available', availableVersion: '2.2.0' }
    })
  })

  it('refuses the LAN listener', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/host/status'],
      ['POST', '/api/v1/host/lock'],
      ['POST', '/api/v1/host/quit']
    ]) {
      const res = await app.request(path, { method }, { listener: 'lan' })
      expect(res.status, path).toBe(403)
    }
  })

  it('locks now', async () => {
    const res = await app.request('/api/v1/host/lock', { method: 'POST' })
    expect(await res.json()).toEqual({ locked: true, pinSet: true })
    expect(lock).toHaveBeenCalledWith('manual')
  })

  it('answers before it quits or restarts', async () => {
    vi.useFakeTimers()
    try {
      const res = await app.request('/api/v1/host/restart', { method: 'POST' })
      expect(await res.json()).toEqual({ restarting: true })
      expect(quit).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(relaunch).toHaveBeenCalledOnce()
      expect(quit).toHaveBeenCalledOnce()

      await app.request('/api/v1/host/quit', { method: 'POST' })
      vi.runAllTimers()
      expect(quit).toHaveBeenCalledTimes(2)
      expect(relaunch).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
