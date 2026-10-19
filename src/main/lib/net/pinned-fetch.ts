import type { IncomingMessage } from 'http'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { pipeline, Transform, type Readable } from 'stream'
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
  createInflateRaw
} from 'zlib'

import { assertAddressesNotExodusApi } from './local-api-guard'
import { resolveAddresses, UnsafeUrlError } from './safe-fetch'

/**
 * One GET of a model-chosen `http(s):` URL for `web_fetch`'s built-in loader,
 * with the connection pinned to the addresses that were judged (S5 minor):
 * the host is resolved once, `assertAddressesNotExodusApi` checks those
 * addresses, and the socket connects to exactly them through a custom
 * `lookup` — so a DNS answer that changes between the check and the connect
 * (rebinding to 127.0.0.1:60223) is never used.
 *
 * Unlike `fetchPublicHttps`, a private or loopback address is allowed (a local
 * dev server, an intranet page is a supported `web_fetch` use) — only
 * Exodus's own two ports on this machine are refused.
 *
 * Never follows a redirect: a 3xx comes back as it is, with its body
 * discarded unread, for the caller to check the next hop. The body is capped
 * at `maxBytes`. Returns a WHATWG `Response`.
 */
export interface PinnedFetchOptions {
  signal?: AbortSignal
  /** The body is refused past this many bytes. Default 20 MB. */
  maxBytes?: number
  /** Covers the connect and the body. Default 30 s. */
  timeoutMs?: number
}

const NULL_BODY = new Set([204, 205, 304])

function toHeaders(res: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, v)
      } catch {
        // A header value the WHATWG Headers class rejects is dropped.
      }
    }
  }
  return headers
}

/**
 * `Content-Encoding: deflate` is meant to be zlib-wrapped, but raw deflate is
 * still sent in the wild; the global `fetch` this replaced (undici) tells them
 * apart by the first byte, and so does this.
 */
function createInflateAuto(): Transform {
  let inner: Transform | null = null
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!inner) {
        // eslint-disable-next-line no-bitwise
        inner =
          (chunk[0]! & 0x0f) === 0x08 ? createInflate() : createInflateRaw()
        inner.on('data', (out: Buffer) => this.push(out))
        inner.once('error', (error) => this.destroy(error))
      }
      inner.write(chunk, () => callback())
    },
    flush(callback) {
      if (!inner) return callback()
      inner.once('end', () => callback())
      inner.end()
    },
    destroy(error, callback) {
      inner?.destroy()
      callback(error)
    }
  })
}

function decoderFor(coding: string): Transform | null | undefined {
  if (coding === 'identity' || coding === '') return null
  if (coding === 'gzip' || coding === 'x-gzip') return createGunzip()
  if (coding === 'deflate') return createInflateAuto()
  if (coding === 'br') return createBrotliDecompress()
  return undefined
}

/**
 * The body as the page sent it, decoded: the global `fetch` this replaced
 * asked for and undid gzip / deflate / br itself, `http.request` does not.
 * Stacked codings (`gzip, br`) are undone last-applied first. A body with any
 * coding this does not know is passed through as it is.
 *
 * Joined with `pipeline`, never `.pipe()`: `.pipe()` does not forward an
 * error, so a compressed body whose connection is reset, times out or is
 * aborted mid-way left the decoder open and the read below waiting forever
 * (N1). `pipeline` destroys every stage with the error, and the read rejects.
 */
function decoded(res: IncomingMessage): Readable {
  const codings = String(res.headers['content-encoding'] ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0)
  const decoders: Transform[] = []
  for (const coding of codings.toReversed()) {
    const decoder = decoderFor(coding)
    if (decoder === undefined) {
      for (const d of decoders) d.destroy()
      return res
    }
    if (decoder) decoders.push(decoder)
  }
  if (decoders.length === 0) return res
  return pipeline([res, ...decoders], () => {
    // The error, if any, reaches the reader through the last stage.
  }) as unknown as Readable
}

async function readCapped(
  body: Readable,
  maxBytes: number,
  abort: () => void
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      // Destroyed without an error, so no 'error' event outlives this throw.
      abort()
      throw new Error('response too large')
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

export async function fetchPinned(
  url: URL,
  {
    signal,
    maxBytes = 20 * 1024 * 1024,
    timeoutMs = 30_000
  }: PinnedFetchOptions = {}
): Promise<Response> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`${url.protocol} is not http(s)`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const addrs = await resolveAddresses(host)
  assertAddressesNotExodusApi(
    url,
    addrs.map((a) => a.address)
  )

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest

  const { res, abort } = await new Promise<{
    res: IncomingMessage
    abort: () => void
  }>((resolvePromise, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal: combined,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Actovia web_fetch)',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        // Pinned: the socket connects to an address judged above, never to
        // a fresh DNS answer.
        lookup: (_host, options, cb) => {
          if ((options as { all?: boolean }).all) {
            ;(cb as (e: null, a: typeof addrs) => void)(null, addrs)
          } else {
            cb(null, addrs[0]!.address, addrs[0]!.family)
          }
        }
      },
      (response) =>
        resolvePromise({ res: response, abort: () => req.destroy() })
    )
    req.on('error', reject)
    req.end()
  })

  const status = res.statusCode ?? 0
  const headers = toHeaders(res)
  if ((status >= 300 && status < 400) || NULL_BODY.has(status)) {
    // A redirect's body is never read: discarded as it arrives.
    res.resume()
    return new Response(null, { status: status || 502, headers })
  }
  const body = decoded(res)
  let bytes: Buffer
  try {
    // Capped after decoding: a small compressed body cannot expand past it.
    bytes = await readCapped(body, maxBytes, () => {
      body.destroy()
      abort()
    })
  } catch (error) {
    if (body !== res) body.destroy()
    throw error
  }
  // Decoded: the length and coding no longer describe these bytes.
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(bytes.length > 0 ? new Uint8Array(bytes) : null, {
    status: status >= 200 && status <= 599 ? status : 502,
    headers
  })
}
