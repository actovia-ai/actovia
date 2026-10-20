import { existsSync, rmSync } from 'fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { getRevokedDevicesPath } = await import('@main/lib/paths')
const { hashToken } = await import('@main/lib/lan/devices')

async function fresh() {
  vi.resetModules()
  return import('@main/lib/lan/revoked')
}

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => rmSync(getRevokedDevicesPath(), { force: true }))
afterEach(() => rmSync(getRevokedDevicesPath(), { force: true }))

// A device revoked on the computer learns it only from a 401 on its next
// request, and the LAN listener stops when no device is paired: without a
// record of the revocation the phone would find nothing listening and go on
// believing it is paired.
describe('revoked devices', () => {
  it('knows nothing is pending when nothing was revoked', async () => {
    const revoked = await fresh()
    expect(revoked.hasPendingRevocations()).toBe(false)
    expect(revoked.takeRevoked('anything')).toBe(false)
  })

  it('answers a revoked token once, then forgets it', async () => {
    const revoked = await fresh()
    revoked.rememberRevoked([hashToken('tok')])
    expect(revoked.hasPendingRevocations()).toBe(true)

    expect(revoked.takeRevoked('other')).toBe(false)
    expect(revoked.takeRevoked('tok')).toBe(true)
    expect(revoked.takeRevoked('tok')).toBe(false)
    expect(revoked.hasPendingRevocations()).toBe(false)
  })

  it('survives a restart', async () => {
    ;(await fresh()).rememberRevoked([hashToken('tok')])
    expect(existsSync(getRevokedDevicesPath())).toBe(true)
    const revoked = await fresh()
    expect(revoked.hasPendingRevocations()).toBe(true)
    expect(revoked.takeRevoked('tok')).toBe(true)
  })

  it('gives up on a device that never came back', async () => {
    const revoked = await fresh()
    const now = Date.now()
    revoked.rememberRevoked([hashToken('tok')], now)
    expect(revoked.hasPendingRevocations(now + revoked.KEEP_MS - DAY)).toBe(
      true
    )
    expect(revoked.hasPendingRevocations(now + revoked.KEEP_MS + 1)).toBe(false)
    expect(revoked.takeRevoked('tok', now + revoked.KEEP_MS + 1)).toBe(false)
  })

  it('lists what is pending by name and time, never a hash, until the device is told', async () => {
    const revoked = await fresh()
    revoked.rememberRevoked([{ hash: hashToken('tok'), name: 'iPhone' }], 1_000)
    revoked.rememberRevoked([hashToken('old')], 2_000)
    expect(revoked.pendingRevocations(3_000)).toEqual([
      { name: 'iPhone', revokedAt: 1_000 },
      { name: null, revokedAt: 2_000 }
    ])
    expect(revoked.takeRevoked('tok', 3_000)).toBe(true)
    expect(revoked.pendingRevocations(3_000)).toEqual([
      { name: null, revokedAt: 2_000 }
    ])
  })

  it('forgets everything on a reset', async () => {
    const revoked = await fresh()
    revoked.rememberRevoked([hashToken('a'), hashToken('b')])
    revoked.clearRevoked()
    expect(revoked.hasPendingRevocations()).toBe(false)
  })

  it('reads a damaged file as nothing pending', async () => {
    const { writeFileSync } = await import('fs')
    writeFileSync(getRevokedDevicesPath(), '{not json')
    const revoked = await fresh()
    expect(revoked.hasPendingRevocations()).toBe(false)
  })
})
