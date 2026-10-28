import { networkInterfaces } from 'os'

import {
  canonicalizeIp,
  isLocalhostName,
  isLoopbackOrUnspecified,
  resolveAddresses
} from './safe-fetch'

/**
 * A rule narrower than `fetchPublicHttps`'s "must be public": refuse a URL
 * only when its host is this machine (loopback, an unspecified address, or
 * one of its own network interfaces) AND its port is one of `ports` — the
 * ports of a local service that trusts loopback and must not be read through
 * a fetch someone else chose. Everything else on `localhost`, a LAN address
 * or a private one stays reachable.
 *
 * `assertUrl` pre-resolves a host; `assertAddresses` judges addresses already
 * resolved, for `fetchPinned`'s `checkAddresses`, so the addresses judged are
 * the ones connected to.
 */
export interface LocalPortGuardOptions {
  ports: Iterable<number>
  /** What to throw. Default `LocalPortRefusedError`. */
  error?: () => Error
}

export interface LocalPortGuard {
  /** Whether `url`'s port (or its protocol's default) is guarded. */
  isGuardedPort(url: URL): boolean
  assertAddresses(url: URL, addresses: readonly string[]): void
  /** Resolves `url`'s host; does nothing when it cannot be resolved. */
  assertUrl(url: URL): Promise<void>
}

export class LocalPortRefusedError extends Error {
  constructor() {
    super('Refused: a guarded port on this machine')
    this.name = 'LocalPortRefusedError'
  }
}

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

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function createLocalPortGuard({
  ports,
  error = () => new LocalPortRefusedError()
}: LocalPortGuardOptions): LocalPortGuard {
  const guarded = new Set(ports)
  const isGuardedPort = (url: URL) =>
    guarded.has(url.port ? Number(url.port) : defaultPortFor(url.protocol))

  return {
    isGuardedPort,
    assertAddresses(url, addresses) {
      if (!isGuardedPort(url)) return
      if (isLocalhostName(hostOf(url))) throw error()
      if (addresses.some((a) => isThisMachine(a))) throw error()
    },
    async assertUrl(url) {
      if (!isGuardedPort(url)) return
      const host = hostOf(url)
      if (isLocalhostName(host)) throw error()
      let addresses: string[]
      try {
        addresses = (await resolveAddresses(host)).map((a) => a.address)
      } catch {
        // No address to reach the service at; the real fetch fails on its own.
        return
      }
      if (addresses.some((a) => isThisMachine(a))) throw error()
    }
  }
}
