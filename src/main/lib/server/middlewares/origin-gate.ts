import { isIP } from 'net'

import type { Context, Next } from 'hono'

import { logger } from '../../logger'
import { type Bindings, listenerOf } from '../types'

/**
 * The server has no authentication and listens on every interface (actovia-ios
 * reaches it over the LAN), and its API hands out the saved provider keys and
 * can run the `terminal` tool. A browser is the one client that will talk to it
 * on someone else's behalf: any page the user has open can `fetch()`
 * `http://localhost:60223`. These two checks turn that away without touching a
 * legitimate client — they do not make the LAN exposure itself safe (that needs
 * a pairing token; see docs/security-hardening.md).
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A request may carry no `Origin` — or, in a dev build, the Vite renderer's.
 * Nothing else.
 *
 * No `Origin` is every legitimate client but one: actovia-ios, actovia-cli, curl,
 * the API tests, and the packaged renderer itself — measured, not assumed: a
 * `file://` page in Electron sends none, on GET, JSON POST and PUT alike, and
 * is not preflighted. The one client that does send it is the dev renderer,
 * so a dev build accepts exactly that origin (`devOrigin`), not loopback in
 * general: another dev server on this machine — or an XSS on one — is no more
 * entitled to the API than a website is.
 *
 * So `null` is refused (it is what a sandboxed iframe on a hostile page
 * presents), and so is any other scheme: a browser extension, and the artifact
 * sandbox's own `actovia-artifact://`.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  devOrigin?: string
): boolean {
  if (!origin) return true
  if (devOrigin === undefined) return false
  try {
    return origin === new URL(devOrigin).origin
  } catch {
    return false
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return (
    address === '::1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.')
  )
}

/**
 * DNS rebinding: a page on `evil.example:60223` re-points its own name at
 * 127.0.0.1, and its now same-origin requests arrive with no `Origin` header
 * to check. What gives it away is the pairing — a connection from this machine
 * that addresses the server by a public name. Only loopback peers are held to
 * it, so actovia-ios may use whatever name the user gave it (an IP, `mac.local`,
 * a tailnet name); loopback clients get `localhost`, an IP literal or `.local`.
 */
export function isAllowedHost(
  host: string | undefined,
  remoteAddress: string | undefined
): boolean {
  if (!host || !isLoopbackAddress(remoteAddress)) return true
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    return true
  }
  return isIP(hostname.replace(/^\[|\]$/g, '')) !== 0
}

export function createOriginGate(opts: { devOrigin?: string }) {
  return async function originGate(c: Context, next: Next) {
    const origin = c.req.header('origin')
    const host = c.req.header('host')
    // `c.env` is @hono/node-server's bindings; absent under `app.request()`.
    const remoteAddress = (c.env as Bindings | undefined)?.incoming?.socket
      ?.remoteAddress
    // Rebinding is a browser on this machine; a LAN client is addressed by
    // whatever name its user gave it, and is held to a token instead.
    const hostOk = listenerOf(c) === 'lan' || isAllowedHost(host, remoteAddress)

    if (!isAllowedOrigin(origin, opts.devOrigin) || !hostOk) {
      logger.warn('server', 'Rejected a request from a foreign origin', {
        origin,
        host,
        path: c.req.path
      })
      return c.json(
        {
          type: 'error',
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: 'This origin may not call the Actovia API.'
          }
        },
        403
      )
    }
    return next()
  }
}
