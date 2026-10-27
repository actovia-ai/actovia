import { serve } from '@hono/node-server'

import { logger } from '../logger'
import type { Bindings } from '../server/types'
import {
  CertificateUnreadableError,
  loadOrCreateCertificate
} from './certificate'
import { hasDevices } from './devices'
import { createLanListener, type LanListener } from './listener'
import {
  createPairing,
  PAIRING_TTL_MS,
  type PairingWindow,
  randomPairingCode
} from './pairing'
import { hasPendingRevocations } from './revoked'

/**
 * LAN access, wired together: one pairing window and one HTTPS listener for the
 * process. The listener is wanted while a window is open, a device is paired,
 * or a revoked device has yet to be told (`revoked.ts`); everything that
 * changes one of those calls `syncLan()`.
 */
export const pairing = createPairing({
  now: Date.now,
  randomCode: randomPairingCode
})

let listener: LanListener | null = null

export function initLan(
  fetch: (request: Request, env: Bindings) => Response | Promise<Response>
): void {
  listener = createLanListener({
    fetch,
    wanted: async () =>
      pairing.current() !== null ||
      (await hasDevices()) ||
      hasPendingRevocations(),
    certificate: loadOrCreateCertificate,
    serve
  })
}

// Said once per run of failures: an unreadable key fails every sync the same
// way until the user resets, and the Devices page already says so.
let unreadableLogged = false

/** Never rejects: callers are request handlers and boot code. */
export async function syncLan(): Promise<void> {
  await listener
    ?.sync()
    .then(() => {
      unreadableLogged = false
    })
    .catch((error) => {
      if (error instanceof CertificateUnreadableError) {
        if (!unreadableLogged) {
          logger.warn(
            'lan',
            'LAN listener not started: the certificate key does not decrypt on this Mac; Settings → Devices offers a reset',
            { error }
          )
        }
        unreadableLogged = true
        return
      }
      logger.error('lan', 'Failed to sync the LAN listener', {
        error
      })
    })
}

/** A window nobody uses must also take the listener back down when it lapses. */
export function openPairingWindow(): PairingWindow {
  const window = pairing.open()
  setTimeout(() => void syncLan(), PAIRING_TTL_MS + 100).unref()
  return window
}

export const stopLan = (): void => listener?.stop()
export const isLanRunning = (): boolean => listener?.isRunning() ?? false
