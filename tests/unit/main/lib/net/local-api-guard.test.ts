// src/main/lib/net/local-api-guard.ts — web_fetch (and anything else that
// fetches a model-chosen URL) must never reach Actovia's own API. DNS and the
// machine's network interfaces are both mocked: nothing here inspects the
// real machine.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Addr = { address: string; family: number }
const dnsLookup = vi.fn<(host: string, opts: unknown) => Promise<Addr[]>>()
vi.mock('dns/promises', () => ({ lookup: dnsLookup }))

type NetIf = { address: string; family: string; internal: boolean }
const networkInterfaces = vi.fn<() => Record<string, NetIf[]>>(() => ({}))
vi.mock('os', () => ({ networkInterfaces }))

const { LocalApiTargetError, assertNotActoviaApi } =
  await import('@main/lib/net/local-api-guard')

afterEach(() => {
  dnsLookup.mockReset()
  networkInterfaces.mockReset()
  networkInterfaces.mockReturnValue({})
})

const SERVER_PORT = 60223
const LAN_SERVER_PORT = 63129

async function refused(url: string): Promise<boolean> {
  try {
    await assertNotActoviaApi(new URL(url))
    return false
  } catch (e) {
    expect(e).toBeInstanceOf(LocalApiTargetError)
    expect((e as Error).message).toBe('Actovia cannot fetch its own API.')
    return true
  }
}

describe('assertNotActoviaApi — literal spellings, no DNS lookup', () => {
  const spellings = [
    'localhost',
    '127.0.0.1',
    '127.8.9.10',
    // octal
    '0177.0.0.1',
    '017700000001',
    // hex
    '0x7f.0.0.1',
    '0x7f000001',
    // decimal (single integer)
    '2130706433',
    // short form
    '127.1',
    // IPv6 loopback
    '[::1]',
    // IPv4-mapped IPv6
    '[::ffff:127.0.0.1]',
    // IPv4-compatible (::/96) and IPv4-translated (::ffff:0:0/96), S5 minor
    '[::127.0.0.1]',
    '[::ffff:0:127.0.0.1]',
    // *.localhost
    'foo.localhost',
    'bar.baz.localhost'
  ]

  it.each(
    spellings.flatMap((h) => [
      [h, SERVER_PORT] as const,
      [h, LAN_SERVER_PORT] as const
    ])
  )('refuses %s on port %i', async (host, port) => {
    expect(await refused(`http://${host}:${port}/x`)).toBe(true)
    expect(dnsLookup).not.toHaveBeenCalled()
  })

  it('does not crash on a URL with no explicit port (defaults to 80/443, neither guarded)', async () => {
    expect(await refused('http://localhost/x')).toBe(false)
    expect(await refused('https://127.0.0.1/x')).toBe(false)
  })
})

describe('assertNotActoviaApi — a hostname that DNS-resolves locally', () => {
  it('refuses a name resolving to 127.0.0.1 on the API port', async () => {
    dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await refused(`http://evil.example:${SERVER_PORT}/x`)).toBe(true)
    expect(dnsLookup).toHaveBeenCalledWith('evil.example', { all: true })
  })

  it('refuses a name resolving to 127.0.0.1 on the LAN port', async () => {
    dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    expect(await refused(`http://evil.example:${LAN_SERVER_PORT}/x`)).toBe(true)
  })

  it('refuses a name when any one of its addresses is local', async () => {
    dnsLookup.mockResolvedValue([
      { address: '203.0.113.9', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ])
    expect(await refused(`http://mixed.example:${SERVER_PORT}/x`)).toBe(true)
  })

  it('allows a name resolving only to public addresses', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await refused(`http://public.example:${SERVER_PORT}/x`)).toBe(false)
  })

  it('allows a name DNS cannot resolve (the real fetch fails on its own)', async () => {
    dnsLookup.mockRejectedValue(
      Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    )
    expect(await refused(`http://nope.example:${SERVER_PORT}/x`)).toBe(false)
  })
})

describe('assertNotActoviaApi — this machine’s own interfaces', () => {
  it('refuses a LAN interface IP on the LAN port', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }]
    })
    expect(await refused(`http://192.168.1.50:${LAN_SERVER_PORT}/x`)).toBe(true)
  })

  it('refuses a LAN interface IP on the API port too', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }]
    })
    expect(await refused(`http://192.168.1.50:${SERVER_PORT}/x`)).toBe(true)
  })

  it('allows a LAN IP that is not one of this machine’s own', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }]
    })
    expect(await refused(`http://192.168.1.99:${LAN_SERVER_PORT}/x`)).toBe(
      false
    )
  })

  it('matches across notation (IPv4-mapped IPv6 vs plain IPv4)', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }]
    })
    expect(await refused(`http://[::ffff:192.168.1.50]:${SERVER_PORT}/x`)).toBe(
      true
    )
  })
})

describe('assertNotActoviaApi — other local/LAN services stay reachable', () => {
  it('allows another port on localhost', async () => {
    expect(await refused('http://localhost:3000/x')).toBe(false)
    expect(await refused('http://localhost:8080/x')).toBe(false)
  })

  it('allows another port on 127.0.0.1', async () => {
    expect(await refused('http://127.0.0.1:3000/x')).toBe(false)
  })

  it('allows a LAN IP on a non-Actovia port', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }]
    })
    expect(await refused('http://192.168.1.50:8080/x')).toBe(false)
  })

  it('allows a public host that happens to use one of the guarded ports', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await refused(`http://example.com:${SERVER_PORT}/x`)).toBe(false)
  })
})
