import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

import type { Context, Next } from 'hono'

import { listenerOf } from '../types'

const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/** Below this, the headers outweigh what compression saves. */
const MIN_BYTES = 1024
/** Quality 5: a chat history at 15% in ~23 ms; 11 saves 10% more in 70× the
 *  time. gzip 6 left it at 31% (measured 2026-10-01). */
const BROTLI_QUALITY = 5
const GZIP_LEVEL = 6

type Encoding = 'br' | 'gzip'

/** The best encoding the client takes: brotli, then gzip, honouring `q=0`. */
function negotiate(header: string | undefined): Encoding | null {
  if (!header) return null
  const accepted = new Map<string, number>()
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    accepted.set(name, q ? Number(q.slice(2)) || 0 : 1)
  }
  const takes = (e: string) => (accepted.get(e) ?? accepted.get('*') ?? 0) > 0
  if (takes('br')) return 'br'
  if (takes('gzip')) return 'gzip'
  return null
}

/** Text the response's type says compresses: JSON, text, JS, SVG. Not an
 *  event stream — each frame must go out the moment it is written. */
function compressible(type: string | null): boolean {
  if (!type) return false
  const t = type.toLowerCase()
  if (t.startsWith('text/event-stream')) return false
  return (
    t.startsWith('application/json') ||
    t.startsWith('text/') ||
    t.includes('javascript') ||
    t.startsWith('image/svg+xml')
  )
}

/**
 * Compresses what the LAN listener sends — the phone, at home or over
 * Tailscale, where a chat's history (2.4 MB, mostly tool results) is seconds
 * on a slow link. Brotli when the client takes it (URLSession does over
 * HTTPS, by itself), else gzip. Loopback is left alone: the renderer is on
 * the same machine, and compressing there only costs CPU. Runs first, so it
 * sees every response, an error's included.
 */
export async function compressLan(c: Context, next: Next) {
  await next()
  if (listenerOf(c) !== 'lan' || c.req.method === 'HEAD') return

  const res = c.res
  if (!res.body || res.status === 204 || res.status === 304) return
  if (res.headers.has('Content-Encoding')) return
  if (!compressible(res.headers.get('Content-Type'))) return
  const encoding = negotiate(c.req.header('Accept-Encoding'))
  if (!encoding) return

  const body = Buffer.from(await res.arrayBuffer())
  const headers = new Headers(res.headers)
  const vary = headers.get('Vary')
  if (!vary?.toLowerCase().includes('accept-encoding')) {
    headers.set('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
  }

  if (body.length < MIN_BYTES) {
    c.res = new Response(body, { status: res.status, headers })
    c.header('Vary', headers.get('Vary') ?? 'Accept-Encoding')
    return
  }

  const compressed =
    encoding === 'br'
      ? await brotli(body, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: body.length
          }
        })
      : await gzipAsync(body, { level: GZIP_LEVEL })

  headers.set('Content-Encoding', encoding)
  c.res = new Response(compressed, { status: res.status, headers })
  // Hono merges the previous response's headers when c.res is replaced.
  // Set these afterwards so a static file's original length (and Vary)
  // cannot overwrite the metadata for the compressed bytes on the wire.
  c.header('Content-Length', String(compressed.length))
  c.header('Vary', headers.get('Vary') ?? 'Accept-Encoding')
}
