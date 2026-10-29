import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import { app } from 'electron'
import { Hono, type Context } from 'hono'

import { updaterGetState, updaterInstall } from '../../auto-updater'
import { getAllMcpServers } from '../../db/mcp-queries'
import { getSettings } from '../../db/queries'
import { listDevices } from '../../lan/devices'
import { isLanRunning } from '../../lan/index'
import { getLockManager } from '../../lock/lock-manager'
import { logger } from '../../logger'
import { getActoviaHome } from '../../paths'
import { pendingMovedSecrets } from '../../secrets/moved'
import { getSecretsStatus } from '../../secrets/status'
import { listenerOf, type Variables } from '../types'
import { successResponse } from '../utils'

/**
 * The machine Actovia runs on, for `actovia status` / `actovia lock` /
 * `actovia app quit|restart` in a shell on it (often over SSH, on a homelab
 * Mac nobody looks at). Loopback only: the phone has its own ways in.
 */

const loopbackOnly = (c: Context) =>
  c.json(
    {
      type: 'error',
      error: { code: 'LOOPBACK_ONLY', message: 'LOOPBACK_ONLY' }
    },
    403
  )

const startedAt = new Date()

/**
 * `GET /api/v1/host/status`, mounted ahead of the lock gate in app.ts: a
 * locked app still says what it is and that it is locked, so the CLI can ask
 * for the PIN instead of guessing. Counts only — no device names, no names of
 * the secrets to re-enter.
 */
export const hostStatusRouter = new Hono<{ Variables: Variables }>()

hostStatusRouter.get('/status', async (c) => {
  if (listenerOf(c) === 'lan') return loopbackOnly(c)
  const lock = getLockManager()
  const settings = await getSettings()
  const secrets = getSecretsStatus(
    pendingMovedSecrets(settings, await getAllMcpServers())
  )
  const update = updaterGetState()
  return successResponse(c, {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    startedAt: startedAt.toISOString(),
    dataDir: getActoviaHome(),
    locked: lock.isLocked(),
    pinSet: lock.getStatus(false).hasPin,
    lan: { running: isLanRunning(), port: LAN_SERVER_PORT },
    devices: (await listDevices()).length,
    secrets: {
      encryption: secrets.encryption,
      needsReentry: secrets.needsReentry.length
    },
    update: {
      mode: update.mode,
      state: update.state,
      availableVersion: update.availableVersion
    }
  })
})

/**
 * Acts on the app: behind the lock gate and the presence gate (a CLI pass,
 * bought with the PIN, opens it — cli-pass.ts), since the model's `terminal`
 * reaches loopback too.
 */
export const hostRouter = new Hono<{ Variables: Variables }>()

hostRouter.use('*', async (c, next) => {
  if (listenerOf(c) === 'lan') return loopbackOnly(c)
  return next()
})

hostRouter.post('/lock', (c) => {
  const lock = getLockManager()
  lock.lock('manual')
  return successResponse(c, {
    locked: lock.isLocked(),
    pinSet: lock.getStatus(false).hasPin
  })
})

// The answer goes out first; the app quits a moment later.
const AFTER_RESPONSE_MS = 200

hostRouter.post('/quit', (c) => {
  logger.info('app', 'Quit requested from the CLI')
  setTimeout(() => app.quit(), AFTER_RESPONSE_MS)
  return successResponse(c, { quitting: true })
})

hostRouter.post('/restart', (c) => {
  logger.info('app', 'Restart requested from the CLI')
  setTimeout(() => {
    app.relaunch()
    app.quit()
  }, AFTER_RESPONSE_MS)
  return successResponse(c, { restarting: true })
})

/**
 * Installs the update the app's own updater has downloaded, and restarts on
 * it — what Settings → About's Restart & Install does, for a Mac nobody looks
 * at. `actovia app update` calls it instead of downloading a second copy and
 * racing Squirrel, which installs that copy when the app quits.
 */
hostRouter.post('/install-update', (c) => {
  const update = updaterGetState()
  if (update.state !== 'ready') {
    return c.json(
      {
        type: 'error',
        error: { code: 'UPDATE_NOT_READY', message: 'UPDATE_NOT_READY' }
      },
      409
    )
  }
  logger.info('app', 'Update install requested from the CLI', {
    version: update.availableVersion
  })
  setTimeout(() => updaterInstall(), AFTER_RESPONSE_MS)
  return successResponse(c, { installing: update.availableVersion })
})
