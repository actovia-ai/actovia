import { randomBytes, timingSafeEqual } from 'crypto'

import {
  deleteAllDevices,
  deleteDevice,
  insertDevice,
  listDeviceRows,
  touchDevice
} from '../db/device-queries'
import type { PairedDevice } from '../db/schema'
import { deviceRevoked } from './device-events'
import { clearRevoked, rememberRevoked } from './revoked'
import { hashToken } from './token-hash'

export { hashToken }

const SEEN_WRITE_INTERVAL_MS = 60_000

/** 256 bits: unguessable, so a plain SHA-256 is all its storage needs. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

// The gate runs on every LAN request; the table is a handful of rows that only
// change through the functions below, each of which drops this cache — which
// is what makes a revocation take effect on the very next request.
let cache: PairedDevice[] | null = null
let cacheVersion = 0
const lastSeenWrite = new Map<string, number>()

async function rows(): Promise<PairedDevice[]> {
  // A read started before a revocation must not repopulate the cache with
  // the deleted device after the revocation has completed.
  while (cache === null) {
    const version = cacheVersion
    const devices = await listDeviceRows()
    if (version === cacheVersion) cache = devices
  }
  return cache
}

export async function listDevices(): Promise<PairedDevice[]> {
  return rows()
}

/** One paired device, by id (the one a LAN request authenticated as). */
export async function findDevice(id: string): Promise<PairedDevice | null> {
  return (await rows()).find((d) => d.id === id) ?? null
}

export async function hasDevices(): Promise<boolean> {
  return (await rows()).some((device) => device.kind !== 'web')
}

/** The only time the token exists on this side: it is returned, never stored. */
export async function registerDevice(
  name: string
): Promise<{ deviceId: string; token: string }> {
  const token = mintToken()
  const device = await insertDevice({ name, tokenHash: hashToken(token) })
  invalidateDeviceCache()
  return { deviceId: device.id, token }
}

/** The id of the device this token belongs to, or null. */
export async function authenticate(
  token: string,
  kind: 'ios' | 'web' = 'ios'
): Promise<string | null> {
  if (!token) return null
  const presented = Buffer.from(hashToken(token), 'hex')
  let match: PairedDevice | null = null
  // Every row, each compared in constant time: nothing about which device
  // matched — or how nearly — is in the timing.
  for (const device of await rows()) {
    if ((device.kind ?? 'ios') !== kind) continue
    if (timingSafeEqual(presented, Buffer.from(device.tokenHash, 'hex'))) {
      match = device
    }
  }
  if (!match) return null

  const now = Date.now()
  // The list shares this cache: reflect this connection immediately even
  // while persistence is throttled, independently for each device.
  match.lastSeenAt = new Date(now)
  if (now - (lastSeenWrite.get(match.id) ?? 0) >= SEEN_WRITE_INTERVAL_MS) {
    lastSeenWrite.set(match.id, now)
    // Bookkeeping: a failed write must not fail the request it describes.
    touchDevice(match.id, new Date(now)).catch(() => {})
  }
  return match.id
}

/**
 * Revoked from the computer: the device does not know yet, so a record of it
 * waits for its next request (`revoked.ts`, answered by `authGate`).
 */
export async function revokeDevice(id: string): Promise<void> {
  const device = (await rows()).find((d) => d.id === id)
  await leaveDevice(id)
  if (device && device.kind !== 'web')
    rememberRevoked([{ hash: device.tokenHash, name: device.name }])
}

/**
 * Every device, at once: Settings → Devices → Reset all, which also replaces
 * the certificate. No phone can finish a TLS handshake to be told after that,
 * so no record is kept, and the ones waiting are dropped.
 */
export async function revokeAllDevices(): Promise<void> {
  await deleteAllDevices()
  invalidateDeviceCache()
  lastSeenWrite.clear()
  clearRevoked()
  deviceRevoked()
}

/** The device unpaired itself (`DELETE /api/v1/pair`): nothing to tell it. */
export async function leaveDevice(id: string): Promise<void> {
  await deleteDevice(id)
  invalidateDeviceCache()
  lastSeenWrite.delete(id)
  deviceRevoked(id)
}

/** New browser profile = new device row; resuming it never registers again. */
export async function registerWebDevice(
  name: string,
  webCredential: NonNullable<PairedDevice['webCredential']>
) {
  const token = mintToken()
  const device = await insertDevice({
    name,
    tokenHash: hashToken(token),
    kind: 'web',
    webCredential
  })
  invalidateDeviceCache()
  return { deviceId: device.id, token }
}

export function invalidateDeviceCache() {
  cacheVersion++
  cache = null
}
