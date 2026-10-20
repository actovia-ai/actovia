// src/main/lib/net/safe-fetch.ts — fetching a URL someone else chose (an
// images API's link) without letting it reach loopback, the LAN or cloud
// metadata. DNS and the HTTPS transport are both mocked: nothing here leaves
// the process.
import { EventEmitter } from 'events'
import { Readable } from 'stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

type Addr = { address: string; family: number }
const dnsLookup = vi.fn<(host: string, opts: unknown) => Promise<Addr[]>>()
vi.mock('dns/promises', () => ({ lookup: dnsLookup }))

interface Scripted {
  status: number
  headers?: Record<string, string>
  body?: Buffer | string
}
type PinnedLookup = (
  host: string,
  opts: { all?: boolean },
  cb: (err: Error | null, a: unknown, f?: number) => void
) => void
const responses = new Map<string, Scripted>()
const requests: Array<{
  url: string
  lookup: PinnedLookup
  headers?: Record<string, string>
}> = []

vi.mock('https', () => ({
  request: (
    url: URL | string,
    options: { lookup: PinnedLookup; headers?: Record<string, string> },
    cb: (res: unknown) => void
  ) => {
    const href = String(url)
    requests.push({
      url: href,
      lookup: options.lookup,
      headers: options.headers
    })
    const req = new EventEmitter() as EventEmitter & {
      end: () => void
      destroy: (e?: Error) => void
    }
    req.destroy = (e?: Error) => {
      if (e) queueMicrotask(() => req.emit('error', e))
    }
    req.end = () => {
      const r = responses.get(href)
      if (!r) {
        queueMicrotask(() => req.emit('error', new Error(`no route ${href}`)))
        return
      }
      const res = Readable.from(
        r.body === undefined ? [] : [Buffer.from(r.body)]
      ) as Readable & { statusCode: number; headers: Record<string, string> }
      res.statusCode = r.status
      res.headers = r.headers ?? {}
      queueMicrotask(() => cb(res))
    }
    return req
  }
}))

const { isPublicAddress, fetchPublicHttps } =
  await import('@main/lib/net/safe-fetch')

afterEach(() => {
  dnsLookup.mockReset()
  responses.clear()
  requests.length = 0
})

const PUBLIC_V4 = '93.184.216.34'
const resolvesTo =
  (map: Record<string, string[]>) =>
  async (host: string): Promise<Addr[]> => {
    const ips = map[host]
    if (!ips) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    return ips.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4
    }))
  }

describe('isPublicAddress', () => {
  it.each([
    // IPv4
    ['0.0.0.0', false],
    ['10.1.2.3', false],
    ['100.64.0.1', false],
    ['100.127.255.254', false],
    ['127.0.0.1', false],
    ['127.8.9.10', false],
    ['169.254.169.254', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['192.0.0.8', false],
    ['192.0.2.1', false],
    ['192.168.1.1', false],
    ['198.51.100.7', false],
    ['203.0.113.9', false],
    ['224.0.0.251', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    [PUBLIC_V4, true],
    ['172.32.0.1', true],
    ['100.128.0.1', true],
    // A TUN proxy's fake-ip range: every name resolves into it there.
    ['198.18.0.1', true],
    // IPv6
    ['::', false],
    ['::1', false],
    ['fe80::1', false],
    ['fe80::1%en0', false],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:169.254.169.254', false],
    ['::ffff:10.0.0.1', false],
    ['64:ff9b::7f00:1', false],
    ['::127.0.0.1', false],
    ['2002:7f00:1::', false],
    ['2606:4700:4700::1111', true],
    // Teredo: not local, and what poisoned resolvers answer for real hosts.
    ['2001::1', true],
    ['2a00:1450:4001:80b::200e', true],
    ['::ffff:8.8.8.8', true],
    ['64:ff9b::808:808', true],
    // Not an address at all.
    ['localhost', false],
    ['', false],
    ['1.2.3', false]
  ])('%s → %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })
})

describe('fetchPublicHttps', () => {
  it('downloads a public https URL, pinned to the address it vetted', async () => {
    dnsLookup.mockImplementation(resolvesTo({ 'img.example': [PUBLIC_V4] }))
    responses.set('https://img.example/1.png', {
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: 'PNGDATA'
    })

    const out = await fetchPublicHttps('https://img.example/1.png', {
      maxBytes: 1024
    })

    expect(out.bytes.toString()).toBe('PNGDATA')
    expect(out.contentType).toBe('image/png')
    expect(dnsLookup).toHaveBeenCalledWith('img.example', { all: true })
    // The connection resolves the host through the pin, not DNS again.
    const { lookup } = requests[0]
    const all = await new Promise((r) =>
      lookup('img.example', { all: true }, (_e, a) => r(a))
    )
    expect(all).toEqual([{ address: PUBLIC_V4, family: 4 }])
    const one = await new Promise((r) =>
      lookup('img.example', {}, (_e, a, f) => r([a, f]))
    )
    expect(one).toEqual([PUBLIC_V4, 4])
    expect(dnsLookup).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['plain http', 'http://img.example/1.png'],
    ['a data URL', 'data:image/png;base64,AAAA'],
    ['a file URL', 'file:///etc/passwd'],
    ['not a URL', 'nope']
  ])('refuses %s', async (_label, url) => {
    await expect(fetchPublicHttps(url, { maxBytes: 10 })).rejects.toThrow(
      /refused/i
    )
    expect(requests).toHaveLength(0)
  })

  it.each([
    'https://localhost/x.png',
    'https://LOCALHOST./x.png',
    'https://api.localhost/x.png',
    'https://127.0.0.1:60223/api/v1/settings',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x.png',
    'https://[::1]/x.png',
    'https://[::ffff:127.0.0.1]/x.png',
    'https://[fd00::1]/x.png',
    'https://0x7f000001/x.png'
  ])('refuses the local host in %s without resolving it', async (url) => {
    await expect(fetchPublicHttps(url, { maxBytes: 10 })).rejects.toThrow(
      /refused/i
    )
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  it('sends the headers it is given with the request', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    responses.set('https://en.wikipedia.org/api/rest_v1/page/summary/X', {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    await fetchPublicHttps(
      'https://en.wikipedia.org/api/rest_v1/page/summary/X',
      {
        maxBytes: 1024,
        headers: { 'User-Agent': 'Actovia/1 test', Accept: 'application/json' }
      }
    )
    expect(requests.at(-1)?.headers).toEqual({
      'User-Agent': 'Actovia/1 test',
      Accept: 'application/json'
    })
  })

  it('refuses a hostname that resolves to a private address', async () => {
    dnsLookup.mockImplementation(resolvesTo({ 'evil.example': ['10.0.0.7'] }))
    await expect(
      fetchPublicHttps('https://evil.example/x.png', { maxBytes: 10 })
    ).rejects.toThrow(/refused/i)
    expect(requests).toHaveLength(0)
  })

  it('refuses a hostname when any one of its addresses is private', async () => {
    dnsLookup.mockImplementation(
      resolvesTo({ 'mixed.example': [PUBLIC_V4, '::1'] })
    )
    await expect(
      fetchPublicHttps('https://mixed.example/x.png', { maxBytes: 10 })
    ).rejects.toThrow(/refused/i)
    expect(requests).toHaveLength(0)
  })

  it('follows a redirect to a public host, re-checking it', async () => {
    dnsLookup.mockImplementation(
      resolvesTo({ 'a.example': [PUBLIC_V4], 'cdn.example': ['1.1.1.1'] })
    )
    responses.set('https://a.example/1.png', {
      status: 302,
      headers: { location: 'https://cdn.example/1.png' }
    })
    responses.set('https://cdn.example/1.png', { status: 200, body: 'OK' })

    const out = await fetchPublicHttps('https://a.example/1.png', {
      maxBytes: 10
    })
    expect(out.bytes.toString()).toBe('OK')
    expect(dnsLookup).toHaveBeenCalledWith('cdn.example', { all: true })
  })

  it.each([
    ['a private host', 'https://inside.example/x.png'],
    ['a private literal', 'https://192.168.0.1/x.png'],
    ['the metadata address', 'https://169.254.169.254/'],
    ['plain http', 'http://a.example/x.png']
  ])('refuses a redirect to %s', async (_label, location) => {
    dnsLookup.mockImplementation(
      resolvesTo({ 'a.example': [PUBLIC_V4], 'inside.example': ['10.9.8.7'] })
    )
    responses.set('https://a.example/1.png', {
      status: 301,
      headers: { location }
    })
    await expect(
      fetchPublicHttps('https://a.example/1.png', { maxBytes: 10 })
    ).rejects.toThrow(/refused/i)
    expect(requests).toHaveLength(1)
  })

  it('gives up after too many redirects', async () => {
    dnsLookup.mockImplementation(resolvesTo({ 'a.example': [PUBLIC_V4] }))
    for (let i = 0; i < 10; i++) {
      responses.set(`https://a.example/${i}`, {
        status: 307,
        headers: { location: `/${i + 1}` }
      })
    }
    await expect(
      fetchPublicHttps('https://a.example/0', { maxBytes: 10 })
    ).rejects.toThrow(/too many redirects/i)
    expect(requests.length).toBeLessThanOrEqual(4)
  })

  it('fails on an HTTP error status', async () => {
    dnsLookup.mockImplementation(resolvesTo({ 'a.example': [PUBLIC_V4] }))
    responses.set('https://a.example/x', { status: 403, body: 'no' })
    await expect(
      fetchPublicHttps('https://a.example/x', { maxBytes: 10 })
    ).rejects.toThrow(/HTTP 403/)
  })

  it('keeps the size cap', async () => {
    dnsLookup.mockImplementation(resolvesTo({ 'a.example': [PUBLIC_V4] }))
    responses.set('https://a.example/big', {
      status: 200,
      body: 'x'.repeat(11)
    })
    await expect(
      fetchPublicHttps('https://a.example/big', { maxBytes: 10 })
    ).rejects.toThrow(/too large/i)
  })
})

describe('canonicalizeIp — the IPv4-in-IPv6 forms (S5 minor)', () => {
  it('unwraps ::/96 and ::ffff:0:0/96 to the IPv4 address', async () => {
    const { canonicalizeIp, isLoopbackOrUnspecified, isPublicAddress } =
      await import('@main/lib/net/safe-fetch')
    expect(canonicalizeIp('::127.0.0.1')).toEqual({
      family: 4,
      bytes: [127, 0, 0, 1]
    })
    expect(canonicalizeIp('::ffff:0:10.0.0.1')).toEqual({
      family: 4,
      bytes: [10, 0, 0, 1]
    })
    expect(isLoopbackOrUnspecified('::7f00:1')).toBe(true)
    expect(isPublicAddress('::ffff:0:8.8.8.8')).toBe(false)
    // `::` and `::1` stay IPv6's own unspecified and loopback.
    expect(canonicalizeIp('::1')?.family).toBe(6)
    expect(canonicalizeIp('::')?.family).toBe(6)
    expect(isLoopbackOrUnspecified('::1')).toBe(true)
    expect(isLoopbackOrUnspecified('::')).toBe(true)
  })
})
