import {
  buildPairingLink,
  createPairing,
  isTailnetAddress,
  lanHosts,
  MAX_PAIRING_ATTEMPTS,
  pairingHosts,
  PAIRING_TTL_MS,
  randomPairingCode
} from '@main/lib/lan/pairing'
import { describe, expect, it } from 'vitest'

function setup() {
  let now = 1_000_000
  let n = 0
  const pairing = createPairing({
    now: () => now,
    randomCode: () => `code-${++n}`
  })
  return { pairing, advance: (ms: number) => (now += ms) }
}

describe('pairing window', () => {
  it('is closed until opened', () => {
    const { pairing } = setup()
    expect(pairing.current()).toBeNull()
    expect(pairing.verify('anything')).toBe('closed')
  })

  it('accepts its code once, then is closed', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    expect(pairing.verify(code)).toBe('ok')
    expect(pairing.verify(code)).toBe('closed')
    expect(pairing.current()).toBeNull()
  })

  it('expires after two minutes', () => {
    const { pairing, advance } = setup()
    const { code, expiresAt } = pairing.open()
    expect(expiresAt).toBe(1_000_000 + PAIRING_TTL_MS)
    advance(PAIRING_TTL_MS - 1)
    expect(pairing.current()).not.toBeNull()
    advance(1)
    expect(pairing.current()).toBeNull()
    expect(pairing.verify(code)).toBe('closed')
  })

  it('closes after too many wrong codes — the right one no longer works', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    for (let i = 1; i <= MAX_PAIRING_ATTEMPTS; i++) {
      expect(pairing.verify('nope')).toBe(
        i < MAX_PAIRING_ATTEMPTS ? 'wrong' : 'closed'
      )
    }
    expect(pairing.verify(code)).toBe('closed')
  })

  it('replaces the previous window — and its attempt count — when opened again', () => {
    const { pairing } = setup()
    const first = pairing.open()
    for (let i = 1; i < MAX_PAIRING_ATTEMPTS; i++) pairing.verify('nope')
    const second = pairing.open()

    expect(second.code).not.toBe(first.code)
    expect(pairing.verify(first.code)).toBe('wrong')
    expect(pairing.verify(second.code)).toBe('ok')
  })

  it('can be cancelled', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    pairing.close()
    expect(pairing.verify(code)).toBe('closed')
  })
})

describe('randomPairingCode', () => {
  it('is 128 bits of URL-safe text, different every time', () => {
    const a = randomPairingCode()
    const b = randomPairingCode()
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(a).not.toBe(b)
  })
})

describe('buildPairingLink', () => {
  it('round-trips through URL parsing', () => {
    const link = buildPairingLink({
      hosts: ['192.168.1.10', 'mac.local'],
      port: 63129,
      code: 'abc-DEF_123',
      fingerprint: 'VldKaXWVm4PX',
      name: "Yancey's Mac & Co"
    })
    const url = new URL(link)
    expect(url.protocol).toBe('actovia:')
    expect(url.host).toBe('pair')
    expect(url.searchParams.get('h')).toBe('192.168.1.10,mac.local')
    expect(url.searchParams.get('p')).toBe('63129')
    expect(url.searchParams.get('c')).toBe('abc-DEF_123')
    expect(url.searchParams.get('f')).toBe('VldKaXWVm4PX')
    expect(url.searchParams.get('n')).toBe("Yancey's Mac & Co")
  })
})

describe('lanHosts', () => {
  it('lists external IPv4 addresses, then the .local name', () => {
    const hosts = lanHosts(
      {
        lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        en0: [
          { family: 'IPv6', address: 'fe80::1', internal: false },
          { family: 'IPv4', address: '192.168.1.10', internal: false }
        ],
        utun3: [{ family: 'IPv4', address: '100.64.0.7', internal: false }]
      } as never,
      'Yanceys-Mac.local'
    )
    expect(hosts).toEqual(['192.168.1.10', '100.64.0.7', 'Yanceys-Mac.local'])
  })

  it('appends .local to a bare hostname', () => {
    expect(lanHosts({}, 'studio')).toEqual(['studio.local'])
  })
})

describe('isTailnetAddress', () => {
  it('is the 100.64.0.0/10 range Tailscale hands out, and nothing next to it', () => {
    expect(isTailnetAddress('100.64.0.1')).toBe(true)
    expect(isTailnetAddress('100.124.60.124')).toBe(true)
    expect(isTailnetAddress('100.127.255.254')).toBe(true)
    expect(isTailnetAddress('100.63.255.255')).toBe(false)
    expect(isTailnetAddress('100.128.0.1')).toBe(false)
    expect(isTailnetAddress('192.168.1.10')).toBe(false)
    expect(isTailnetAddress('10.100.64.1')).toBe(false)
  })
})

describe('pairingHosts', () => {
  const interfaces = {
    en0: [{ family: 'IPv4', address: '192.168.1.10', internal: false }],
    utun4: [{ family: 'IPv4', address: '100.124.60.124', internal: false }]
  } as never

  it('leads with the tailnet name and drops the bare tailnet address a phone cannot use', async () => {
    const hosts = await pairingHosts(
      interfaces,
      'Yanceys-Mac.local',
      async (ip) =>
        ip === '100.124.60.124' ? ['yanceys-mac.tail1234.ts.net.'] : []
    )
    expect(hosts).toEqual([
      'yanceys-mac.tail1234.ts.net',
      '192.168.1.10',
      'Yanceys-Mac.local'
    ])
  })

  it('without a name for the tailnet address (MagicDNS off, lookup failed), lists the LAN as before', async () => {
    const failing = await pairingHosts(
      interfaces,
      'Yanceys-Mac.local',
      async () => {
        throw new Error('ETIMEOUT')
      }
    )
    expect(failing).toEqual([
      '192.168.1.10',
      '100.124.60.124',
      'Yanceys-Mac.local'
    ])
    const empty = await pairingHosts(
      interfaces,
      'Yanceys-Mac.local',
      async () => []
    )
    expect(empty).toEqual([
      '192.168.1.10',
      '100.124.60.124',
      'Yanceys-Mac.local'
    ])
  })

  it('does not ask anyone when there is no tailnet address', async () => {
    let asked = 0
    const hosts = await pairingHosts(
      {
        en0: [{ family: 'IPv4', address: '192.168.1.10', internal: false }]
      } as never,
      'studio',
      async () => {
        asked += 1
        return []
      }
    )
    expect(asked).toBe(0)
    expect(hosts).toEqual(['192.168.1.10', 'studio.local'])
  })
})
