import { randomBytes, timingSafeEqual } from 'crypto'
import { Resolver } from 'dns/promises'
import type { NetworkInterfaceInfo } from 'os'

import { PAIRING_TTL_MS } from '@actovia/shared/constants/systems'

export { PAIRING_TTL_MS }
export const MAX_PAIRING_ATTEMPTS = 5

export interface PairingWindow {
  code: string
  expiresAt: number
}

export type VerifyResult = 'ok' | 'wrong' | 'closed'

export interface Pairing {
  open(): PairingWindow
  close(): void
  current(): PairingWindow | null
  verify(code: string): VerifyResult
}

/** 128 bits — the code only has to survive two minutes and five guesses. */
export function randomPairingCode(): string {
  return randomBytes(16).toString('base64url')
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The one moment a new device may join: opened from the desktop's screen, shown
 * as a QR code, gone after one use, two minutes, or five wrong guesses. Pure —
 * the clock and the RNG come in — so every edge of it is unit-tested.
 */
export function createPairing(deps: {
  now(): number
  randomCode(): string
}): Pairing {
  let window: PairingWindow | null = null
  let attempts = 0

  function current(): PairingWindow | null {
    if (window && deps.now() >= window.expiresAt) window = null
    return window
  }

  return {
    open() {
      window = {
        code: deps.randomCode(),
        expiresAt: deps.now() + PAIRING_TTL_MS
      }
      attempts = 0
      return window
    },
    close() {
      window = null
    },
    current,
    verify(code) {
      const open = current()
      if (!open) return 'closed'
      if (sameCode(code, open.code)) {
        window = null
        return 'ok'
      }
      attempts++
      if (attempts >= MAX_PAIRING_ATTEMPTS) {
        window = null
        return 'closed'
      }
      return 'wrong'
    }
  }
}

/** What the QR code says — see actovia-ios `PairingLink` for the reader. */
export function buildPairingLink(p: {
  hosts: string[]
  port: number
  code: string
  fingerprint: string
  name: string
}): string {
  const query = new URLSearchParams({
    h: p.hosts.join(','),
    p: String(p.port),
    c: p.code,
    f: p.fingerprint,
    n: p.name
  })
  return `actovia://pair?${query.toString()}`
}

/** Every address a phone on the LAN might reach this machine by. */
export function lanHosts(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  hostname: string
): string[] {
  const addresses = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  const local = hostname.endsWith('.local') ? hostname : `${hostname}.local`
  return [...addresses, local]
}

/** Tailscale's addresses: the 100.64.0.0/10 shared range it hands every node. */
export function isTailnetAddress(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/** This machine's names for an address, as Tailscale's own resolver (MagicDNS) gives them. */
async function magicDnsReverse(address: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: 1000, tries: 1 })
  resolver.setServers(['100.100.100.100'])
  return resolver.reverse(address)
}

/**
 * The addresses a pairing QR code lists. A phone away from home reaches this
 * machine over Tailscale by its MagicDNS name (`name.tailnet.ts.net`), never by
 * its bare 100.x address: iOS only lets an app trust a self-signed certificate
 * by its pin where App Transport Security allows it — local networks, and the
 * `ts.net` exception actovia-ios carries — and 100.64.0.0/10 is neither. So the
 * name leads the list and the bare tailnet address it stands for is left out;
 * without a name (MagicDNS off, the lookup failing) the list is `lanHosts`'.
 */
export async function pairingHosts(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  hostname: string,
  reverse: (address: string) => Promise<string[]> = magicDnsReverse
): Promise<string[]> {
  const hosts = lanHosts(interfaces, hostname)
  const named: string[] = []
  const covered = new Set<string>()
  for (const address of hosts.filter(isTailnetAddress)) {
    const names = await reverse(address).catch(() => [] as string[])
    const name = names
      .map((n) => n.replace(/\.$/, ''))
      .find((n) => n.length > 0)
    if (!name) continue
    if (!named.includes(name)) named.push(name)
    covered.add(address)
  }
  return [...named, ...hosts.filter((h) => !covered.has(h))]
}
