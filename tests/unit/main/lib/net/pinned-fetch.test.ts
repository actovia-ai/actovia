// src/main/lib/net/pinned-fetch.ts — web_fetch's built-in loader connects to
// the addresses it judged (S5 minor): one DNS answer, checked, then pinned.
// A local HTTP server stands in for the web; DNS is mocked, so the names
// below exist only here.
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'zlib'

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

type Addr = { address: string; family: number }
const dnsLookup = vi.fn<(host: string, opts: unknown) => Promise<Addr[]>>()
vi.mock('dns/promises', () => ({ lookup: dnsLookup }))

const { fetchPinned } = await import('@main/lib/net/pinned-fetch')
const { LocalApiTargetError } = await import('@main/lib/net/local-api-guard')
const { UnsafeUrlError } = await import('@main/lib/net/safe-fetch')

let server: Server
let port: number
const seen: Array<{ host?: string; url?: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ host: req.headers.host, url: req.url })
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'https://elsewhere.example/next' })
      res.end('x'.repeat(100_000))
      return
    }
    if (req.url === '/gzip') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip'
      })
      res.end(gzipSync('<html><body>compressed page</body></html>'))
      return
    }
    if (req.url === '/bomb') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip'
      })
      res.end(gzipSync('x'.repeat(50_000)))
      return
    }
    if (req.url === '/stall-gzip' || req.url === '/reset-gzip') {
      // Half a gzip body, then silence — or a reset.
      const full = gzipSync('y'.repeat(200_000))
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip'
      })
      res.write(full.subarray(0, Math.floor(full.length / 2)))
      if (req.url === '/reset-gzip') {
        setTimeout(() => req.socket.destroy(), 50)
      }
      return
    }
    if (req.url === '/deflate' || req.url === '/raw-deflate') {
      const text = '<html><body>deflated page</body></html>'
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'deflate'
      })
      res.end(req.url === '/deflate' ? deflateSync(text) : deflateRawSync(text))
      return
    }
    if (req.url === '/stacked') {
      // Applied gzip first, then br: undone br first, then gzip.
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip, br'
      })
      res.end(brotliCompressSync(gzipSync('<html>stacked page</html>')))
      return
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('x'.repeat(5000))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><main>pinned page</main></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(() => {
  seen.length = 0
  dnsLookup.mockReset()
  dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
})

describe('fetchPinned', () => {
  it('connects to the address it resolved and judged, for a name no real DNS knows', async () => {
    const res = await fetchPinned(new URL(`http://pinned.invalid:${port}/page`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('pinned page')
    // The request went to our server, named as the URL named it.
    expect(seen).toEqual([{ host: `pinned.invalid:${port}`, url: '/page' }])
    expect(dnsLookup).toHaveBeenCalledTimes(1)
  })

  it('never follows a redirect, and hands back no body for it', async () => {
    const res = await fetchPinned(
      new URL(`http://pinned.invalid:${port}/redirect`)
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://elsewhere.example/next')
    expect(res.body).toBeNull()
    expect(seen).toHaveLength(1)
  })

  it("refuses Actovia's own API ports on this machine before connecting", async () => {
    for (const p of [60223, 63129]) {
      await expect(
        fetchPinned(new URL(`http://rebound.invalid:${p}/api/v1/settings`))
      ).rejects.toBeInstanceOf(LocalApiTargetError)
    }
    await expect(
      fetchPinned(new URL('http://localhost:60223/api/v1/settings'))
    ).rejects.toBeInstanceOf(LocalApiTargetError)
    expect(seen).toHaveLength(0)
  })

  it('decodes a gzip body, as the global fetch it replaced did', async () => {
    const res = await fetchPinned(new URL(`http://pinned.invalid:${port}/gzip`))
    expect(await res.text()).toContain('compressed page')
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('caps the decoded size, not the compressed one', async () => {
    await expect(
      fetchPinned(new URL(`http://pinned.invalid:${port}/bomb`), {
        maxBytes: 10_000
      })
    ).rejects.toThrow(/too large/u)
  })

  it('a compressed body that stalls rejects at the timeout (N1)', async () => {
    const started = Date.now()
    await expect(
      fetchPinned(new URL(`http://pinned.invalid:${port}/stall-gzip`), {
        timeoutMs: 400
      })
    ).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('a compressed body that stalls rejects when the caller aborts (N1)', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    await expect(
      fetchPinned(new URL(`http://pinned.invalid:${port}/stall-gzip`), {
        signal: controller.signal,
        timeoutMs: 20_000
      })
    ).rejects.toThrow()
  })

  it('a compressed body whose connection is reset mid-way rejects (N1)', async () => {
    await expect(
      fetchPinned(new URL(`http://pinned.invalid:${port}/reset-gzip`), {
        timeoutMs: 20_000
      })
    ).rejects.toThrow()
  })

  it('decodes zlib and raw deflate alike', async () => {
    for (const path of ['/deflate', '/raw-deflate']) {
      const res = await fetchPinned(
        new URL(`http://pinned.invalid:${port}${path}`)
      )
      expect(await res.text()).toContain('deflated page')
    }
  })

  it('undoes stacked codings last-applied first', async () => {
    const res = await fetchPinned(
      new URL(`http://pinned.invalid:${port}/stacked`)
    )
    expect(await res.text()).toContain('stacked page')
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('caps the body', async () => {
    await expect(
      fetchPinned(new URL(`http://pinned.invalid:${port}/big`), {
        maxBytes: 1000
      })
    ).rejects.toThrow(/too large/u)
  })

  it('fetches only http(s)', async () => {
    await expect(
      fetchPinned(new URL('file:///etc/passwd'))
    ).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(dnsLookup).not.toHaveBeenCalled()
  })
})
