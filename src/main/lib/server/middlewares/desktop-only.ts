import type { Context, Next } from 'hono'

import { listenerOf } from '../types'

/**
 * Actions on the computer itself (running a binary, opening Terminal or a
 * folder, choosing where work happens): a paired phone reaches the rest of the
 * API but never these.
 */
export async function desktopOnly(c: Context, next: Next) {
  if (listenerOf(c) !== 'lan') return next()
  return c.json(
    {
      type: 'error',
      error: { code: 'FORBIDDEN', message: 'This is done on the computer.' }
    },
    403
  )
}
