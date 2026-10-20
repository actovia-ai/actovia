import { Hono } from 'hono'

import {
  cliPinGate,
  issueCliPass,
  recordCliPinMiss,
  resetCliPinMisses
} from '../../cli-pass'
import { getLockManager } from '../../lock/lock-manager'
import { logger } from '../../logger'
import { listenerOf, type Variables } from '../types'
import { successResponse } from '../utils'

// Mounted ahead of the lock gate in app.ts, so this reaches its handler while
// the app is locked; authGate still runs first (see app.ts), so only a
// request that already carries a paired device's token — or comes from
// loopback — gets here at all.
const lockRouter = new Hono<{ Variables: Variables }>()

// A paired device's own biometric (Face ID, verified on the phone) stands in
// for the PIN, the same way the computer's own Touch ID already does
// (`LOCK_CHANNELS.unlockTouchId` in lock/ipc.ts calls `completeUnlock()`
// directly too) — the trust is in the device having a token at all, not in
// re-proving the PIN. No PIN is read or checked here.
lockRouter.post('/unlock', (c) => {
  const manager = getLockManager()
  if (manager.isLocked()) {
    manager.completeUnlock()
    logger.info('app', 'Unlocked by a paired device', {
      deviceId: c.get('deviceId') ?? 'loopback'
    })
  }
  return successResponse(c, { locked: manager.isLocked() })
})

const PIN_REFUSALS = {
  'no-pin': { status: 409, code: 'PIN_NOT_SET' },
  'wrong-pin': { status: 401, code: 'WRONG_PIN' },
  'locked-out': { status: 429, code: 'PIN_LOCKED_OUT' }
} as const

// `actovia pair` / `actovia devices` (a shell on this machine, an SSH session
// to a homelab Mac): the app-lock PIN, typed by the person, buys a pass that
// opens the device routes for ten minutes (cli-pass.ts, presence-gate.ts).
// The model reaches loopback too, but does not know the PIN; wrong guesses
// count toward the lock screen's own lockout and a stricter one of the CLI's
// (cli-pass.ts: doubling waits, then no pass at all after ten misses until
// the PIN is typed on the lock screen). Loopback only: on the LAN a
// paired device already holds what the device routes ask for, and they are
// refused there anyway.
lockRouter.post('/cli-pass', async (c) => {
  const refuse = (
    status: 400 | 401 | 403 | 409 | 423 | 429,
    code: string,
    extra: Record<string, unknown> = {}
  ) =>
    c.json({ type: 'error', error: { code, message: code, ...extra } }, status)
  if (listenerOf(c) === 'lan') return refuse(403, 'LOOPBACK_ONLY')
  const body = (await c.req.json().catch(() => null)) as {
    pin?: unknown
  } | null
  const pin = body?.pin
  if (typeof pin !== 'string' || pin.length === 0 || pin.length > 64) {
    return refuse(400, 'VALIDATION_FAILED')
  }
  // The CLI's own, stricter limit on guesses (cli-pass.ts), checked before
  // the PIN is even looked at.
  const gate = cliPinGate()
  if (!gate.open) {
    logger.warn('app', 'CLI pass refused', {
      reason: gate.disabled ? 'disabled' : 'backoff'
    })
    return gate.disabled
      ? refuse(423, 'CLI_PIN_DISABLED')
      : refuse(429, 'PIN_LOCKED_OUT', { retryAfterMs: gate.retryAfterMs })
  }
  const result = getLockManager().confirmPin(pin)
  if (!result.ok) {
    if (result.reason !== 'no-pin') recordCliPinMiss()
    const { status, code } = PIN_REFUSALS[result.reason]
    logger.warn('app', 'CLI pass refused', { reason: result.reason })
    return refuse(status, code, { retryAfterMs: result.retryAfterMs })
  }
  resetCliPinMisses()
  logger.info('app', 'CLI pass issued')
  return successResponse(c, issueCliPass())
})

export default lockRouter
