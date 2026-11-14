import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { compressLan } from '@main/lib/server/middlewares/compress'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { describe, expect, it } from 'vitest'

// A chat's history is mostly tool results: 2.4 MB for 31 messages, which the
// phone pulls over Tailscale. Brotli at quality 5 took it to 15% in 23 ms,
// gzip to 31% (2026-10-01).
const big = {
  messages: Array.from({ length: 200 }, (_, i) => ({
    id: `m${i}`,
    text: `Search result ${i}: the luncheon in the East Room, a seating chart…`
  }))
}

const app = new Hono<{ Bindings: { listener?: 'lan' | 'loopback' } }>()
app.use('*', compressLan)
app.get('/json', (c) => c.json(big))
app.get('/small', (c) => c.json({ ok: true }))
const sandboxPage = '<!doctype html><p>塞尔达 artifact</p>'.repeat(100)
app.get(
  '/sandbox',
  () =>
    new Response(sandboxPage, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(sandboxPage)),
        Vary: 'Origin',
        'Cache-Control': 'no-cache'
      }
    })
)
app.get('/png', (c) =>
  c.body(new Uint8Array(4096), 200, { 'Content-Type': 'image/png' })
)
app.get('/sse', (c) =>
  streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify(big) })
  })
)
app.get('/encoded', (c) =>
  c.body(JSON.stringify(big), 200, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'identity-custom'
  })
)
app.get('/error', () => {
  throw new Error('boom')
})
app.onError((_err, c) => c.json({ error: 'x'.repeat(4000) }, 500))

const lan = { listener: 'lan' as const }
const get = (path: string, accept?: string, env: object = lan) =>
  app.request(
    path,
    accept ? { headers: { 'Accept-Encoding': accept } } : {},
    env
  )

describe('compressLan', () => {
  it.each(['br', 'gzip'])(
    'replaces an explicit static-file length when compressing with %s',
    async (encoding) => {
      const res = await get('/sandbox', encoding)
      const body = Buffer.from(await res.arrayBuffer())
      expect(res.headers.get('content-encoding')).toBe(encoding)
      expect(Number(res.headers.get('content-length'))).toBe(body.length)
      const decoded =
        encoding === 'br' ? brotliDecompressSync(body) : gunzipSync(body)
      expect(decoded.toString()).toBe(sandboxPage)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('vary')).toBe('Origin, Accept-Encoding')
    }
  )
  it('sends brotli to a client that takes it, and says the response varies', async () => {
    const res = await get('/json', 'gzip, deflate, br')
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
    const body = Buffer.from(await res.arrayBuffer())
    expect(JSON.parse(brotliDecompressSync(body).toString())).toEqual(big)
    expect(Number(res.headers.get('content-length'))).toBe(body.length)
  })

  it('falls back to gzip, and honours q=0', async () => {
    for (const accept of ['gzip', 'br;q=0, gzip']) {
      const res = await get('/json', accept)
      expect(res.headers.get('content-encoding')).toBe('gzip')
      const body = Buffer.from(await res.arrayBuffer())
      expect(JSON.parse(gunzipSync(body).toString())).toEqual(big)
    }
  })

  it('leaves the response alone when the client accepts neither', async () => {
    for (const accept of [undefined, 'identity', 'deflate']) {
      const res = await get('/json', accept)
      expect(res.headers.get('content-encoding')).toBeNull()
      expect(await res.json()).toEqual(big)
    }
  })

  // The renderer is on loopback: compressing there only costs CPU.
  it('never compresses on loopback', async () => {
    const res = await get('/json', 'br', { listener: 'loopback' })
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  // Every frame of a streaming reply must go out the moment it is written.
  it('never compresses a stream of events', async () => {
    const res = await get('/sse', 'br')
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toContain('luncheon')
  })

  it('skips a small body, an image, and a body already encoded', async () => {
    expect((await get('/small', 'br')).headers.get('content-encoding')).toBe(
      null
    )
    expect((await get('/png', 'br')).headers.get('content-encoding')).toBe(null)
    expect((await get('/encoded', 'br')).headers.get('content-encoding')).toBe(
      'identity-custom'
    )
  })

  it('compresses an error response too', async () => {
    const res = await get('/error', 'br')
    expect(res.status).toBe(500)
    expect(res.headers.get('content-encoding')).toBe('br')
  })
})
