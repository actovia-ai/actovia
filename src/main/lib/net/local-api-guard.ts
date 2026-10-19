import { networkInterfaces } from 'os'

import { LAN_SERVER_PORT, SERVER_PORT } from '@exodus/shared/constants/systems'

import {
  canonicalizeIp,
  isLocalhostName,
  isLoopbackOrUnspecified,
  resolveAddresses
} from './safe-fetch'

/**
 * `web_fetch` (and anything else that fetches a model-chosen URL from this
 * process, such as deep research's own page fetch, if it grows one) must
 * never be able to reach Actovia's own API — a page the model asks to fetch
 * could otherwise read back settings, masked keys, or anything else the
 * loopback or LAN listener serves.
 *
 * The rule is narrower than `safe-fetch.ts`'s "must be public" (used for
 * images): only a URL whose host resolves to loopback, an unspecified
 * address, or one of this machine's own network interfaces — AND whose port
 * is one of the two Actovia listens on (`SERVER_PORT`, `LAN_SERVER_PORT`) —
 * is refused. Everything else on `localhost`, a LAN IP or a private address
 * (another local dev server, an intranet host) stays reachable — that is a
 * supported `web_fetch` use case, not the threat this guards against.
 *
 * `assertNotExodusApi` pre-resolves a host; the connection itself is pinned
 * by `net/pinned-fetch.ts` (`web_fetch`'s built-in loader), which resolves
 * once, judges those addresses with `assertAddressesNotExodusApi` and
 * connects to exactly them — so a DNS answer that rebinds between check and
 * connect is never used. Every redirect hop is re-checked by the caller.
 */

export class LocalApiTargetError extends Error {
  constructor() {
    super('Actovia cannot fetch its own API.')
    this.name = 'LocalApiTargetError'
  }
}

const GUARDED_PORTS = new Set<number>([SERVER_PORT, LAN_SERVER_PORT])

function defaultPortFor(protocol: string): number {
  return protocol === 'https:' ? 443 : 80
}

function sameAddress(a: string, b: string): boolean {
  const ca = canonicalizeIp(a)
  const cb = canonicalizeIp(b)
  if (!ca || !cb || ca.family !== cb.family) return false
  return ca.bytes.every((byte, i) => byte === cb.bytes[i])
}

/** Every address configured on one of this machine's network interfaces. */
function ownInterfaceAddresses(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const info of addrs ?? []) out.push(info.address)
  }
  return out
}

function isThisMachine(ip: string): boolean {
  if (isLoopbackOrUnspecified(ip)) return true
  return ownInterfaceAddresses().some((own) => sameAddress(own, ip))
}

/** Whether `url`'s port is one of the two Actovia's API listens on. */
export function isGuardedPort(url: URL): boolean {
  const port = url.port ? Number(url.port) : defaultPortFor(url.protocol)
  return GUARDED_PORTS.has(port)
}

/**
 * The same rule against addresses already resolved — for a caller that pins
 * its connection to them (`net/pinned-fetch.ts`), so the addresses judged are
 * the ones connected to. Throws `LocalApiTargetError`.
 */
export function assertAddressesNotExodusApi(
  url: URL,
  addresses: readonly string[]
): void {
  if (!isGuardedPort(url)) return
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isLocalhostName(host)) throw new LocalApiTargetError()
  if (addresses.some((a) => isThisMachine(a))) throw new LocalApiTargetError()
}

/**
 * Refuses `url` when its host resolves to this machine (loopback, an
 * unspecified address, or one of its own interfaces) AND its port is
 * `SERVER_PORT` or `LAN_SERVER_PORT`, by throwing `LocalApiTargetError`.
 * Resolves (does nothing) otherwise, including when `url`'s host cannot be
 * resolved at all — there is no address to reach Actovia's API at either
 * way, and the real fetch this guards will fail on its own for the same
 * reason.
 */
export async function assertNotExodusApi(url: URL): Promise<void> {
  const port = url.port ? Number(url.port) : defaultPortFor(url.protocol)
  if (!GUARDED_PORTS.has(port)) return

  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isLocalhostName(host)) throw new LocalApiTargetError()

  let addresses: string[]
  try {
    addresses = (await resolveAddresses(host)).map((a) => a.address)
  } catch {
    return
  }
  if (addresses.some((a) => isThisMachine(a))) throw new LocalApiTargetError()
}
