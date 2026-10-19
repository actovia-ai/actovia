import type { Context, Next } from 'hono'

import { syncLan } from '../../lan'
import { authenticate } from '../../lan/devices'
import { takeRevoked } from '../../lan/revoked'
import { listenerOf } from '../types'

const PAIR_PATH = '/api/v1/pair'
const DEVICES_PREFIX = '/api/v1/devices'

function deny(c: Context, status: 401 | 403, code: string, message: string) {
  return c.json({ type: 'error', error: { code, message } }, status)
}

/**
 * The LAN listener's door. Loopback has none: a local process can read
 * ~/.exodus directly, and browsers are turned away by the origin gate. A LAN
 * request needs the token of a paired device — except the one request that
 * obtains a token, which the pairing window guards instead.
 *
 * Runs ahead of the lock gate, so an unauthenticated request learns nothing,
 * not even that the app is locked.
 */
export async function authGate(c: Context, next: Next) {
  if (listenerOf(c) === 'loopback') return next()
  if (c.req.method === 'POST' && c.req.path === PAIR_PATH) return next()

  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const deviceId = await authenticate(token)
  if (!deviceId) {
    // A device revoked here: this 401 is how it learns, and unpairs. Its
    // record kept the listener up for this; without it the listener may go.
    if (takeRevoked(token)) void syncLan()
    return deny(
      c,
      401,
      'UNAUTHORIZED',
      'Pair this device from Actovia on your computer.'
    )
  }
  // Pairing and revoking happen at the computer, never from another device.
  if (c.req.path.startsWith(DEVICES_PREFIX)) {
    return deny(c, 403, 'FORBIDDEN', 'Devices are managed on the computer.')
  }
  c.set('deviceId', deviceId)
  return next()
}
