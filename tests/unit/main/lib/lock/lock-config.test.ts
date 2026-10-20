import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpFile: string
vi.mock('@main/lib/paths', () => ({ getLockConfigPath: () => tmpFile }))
vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() }
}))

beforeEach(() => {
  tmpFile = `/tmp/actovia-lockcfg-${Math.random().toString(36).slice(2)}.json`
})
afterEach(async () => {
  const { rmSync, existsSync } = await import('fs')
  if (existsSync(tmpFile)) rmSync(tmpFile)
})

describe('lock-config', () => {
  it('returns defaults when no file exists', async () => {
    const cfg = await import('@main/lib/lock/lock-config')
    expect(cfg.readConfig()).toEqual({
      touchIdEnabled: false,
      idleTimeoutMs: 0,
      lockOnLaunch: false,
      lockOnSystemSleep: false
    })
  })

  it('merges partial writes over existing config', async () => {
    const cfg = await import('@main/lib/lock/lock-config')
    cfg.writeConfig({ idleTimeoutMs: 300000 })
    cfg.writeConfig({ lockOnLaunch: true })
    expect(cfg.readConfig()).toEqual({
      touchIdEnabled: false,
      idleTimeoutMs: 300000,
      lockOnLaunch: true,
      lockOnSystemSleep: false
    })
  })
})
