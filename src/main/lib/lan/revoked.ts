import { timingSafeEqual } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'

import { getRevokedDevicesPath } from '../paths'
import { hashToken } from './token-hash'

/**
 * Devices revoked here that do not know it yet. A device learns it only from a
 * 401 on its next request, and the LAN listener runs only while something is
 * paired — so revoking the last device used to take the listener down, and the
 * phone found nothing there and went on believing it was paired. Each record
 * keeps the listener up (`lan/index.ts`) until the device comes back and is
 * answered, or `KEEP_MS` passes. Only token hashes are kept, never a token.
 */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

interface Revoked {
  hash: string
  revokedAt: number
  /** The device's name when it was revoked, for Settings → Devices and `actovia devices`. */
  name?: string
}

let cache: Revoked[] | null = null

function load(now: number): Revoked[] {
  if (!cache) {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(getRevokedDevicesPath(), 'utf8')
      )
      cache = Array.isArray(parsed)
        ? parsed.filter(
            (r): r is Revoked =>
              typeof r?.hash === 'string' && typeof r?.revokedAt === 'number'
          )
        : []
    } catch {
      // Missing or damaged: nothing pending. The worst case is the old
      // behaviour — a revoked phone that has to be unpaired by hand.
      cache = []
    }
  }
  const live = cache.filter((r) => now - r.revokedAt <= KEEP_MS)
  if (live.length !== cache.length) save(live)
  return live
}

function save(records: Revoked[]): void {
  cache = records
  try {
    writeFileSync(getRevokedDevicesPath(), JSON.stringify(records))
  } catch {
    // Kept in memory for this run; only a restart forgets it.
  }
}

export function rememberRevoked(
  entries: Array<string | { hash: string; name: string }>,
  now = Date.now()
): void {
  if (entries.length === 0) return
  const records = entries.map((e) =>
    typeof e === 'string'
      ? { hash: e, revokedAt: now }
      : { hash: e.hash, revokedAt: now, name: e.name }
  )
  const hashes = records.map((r) => r.hash)
  const kept = load(now).filter((r) => !hashes.includes(r.hash))
  save([...kept, ...records])
}

/**
 * The devices revoked here that have not come back to learn it — what
 * Settings → Devices and `actovia devices` list as "not told yet". No hash
 * leaves this module.
 */
export function pendingRevocations(
  now = Date.now()
): Array<{ name: string | null; revokedAt: number }> {
  return load(now).map((r) => ({
    name: r.name ?? null,
    revokedAt: r.revokedAt
  }))
}

export function hasPendingRevocations(now = Date.now()): boolean {
  return load(now).length > 0
}

/**
 * Whether `token` is a revoked device's; true once — the device is being told
 * now, so the record goes. Compared in constant time, like `authenticate`.
 */
export function takeRevoked(token: string, now = Date.now()): boolean {
  if (!token) return false
  const presented = Buffer.from(hashToken(token), 'hex')
  const records = load(now)
  let match: Revoked | null = null
  for (const record of records) {
    if (timingSafeEqual(presented, Buffer.from(record.hash, 'hex'))) {
      match = record
    }
  }
  if (!match) return false
  save(records.filter((r) => r !== match))
  return true
}

/** After a reset: the certificate is new, so no revoked device can be reached to be told. */
export function clearRevoked(): void {
  save([])
}
