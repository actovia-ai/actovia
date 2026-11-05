import type { WebAccessConfig } from '@actovia/shared/types/web-terminal'
import { serve, type ServerType } from '@hono/node-server'
import { app } from 'electron'

import { updateDeviceCredential } from '../db/device-queries'
import { onDeviceRevoked } from '../lan/device-events'
import {
  authenticate,
  findDevice,
  invalidateDeviceCache,
  leaveDevice,
  registerWebDevice
} from '../lan/devices'
import { getLockManager } from '../lock/lock-manager'
import { logger } from '../logger'
import type { Bindings } from '../server/types'
import { createWebApp } from './app'
import { webRendererAsset } from './assets'
import {
  readWebAccessConfig,
  WEB_SERVER_PORT,
  writeWebAccessConfig
} from './config'
import { createWebTerminals } from './terminals'

declare const MAIN_WINDOW_VITE_NAME: string | undefined

export const webTerminals = createWebTerminals({
  authenticate: (token) => authenticate(token, 'web'),
  find: async (id) => {
    const device = await findDevice(id)
    return device?.kind === 'web' ? device : null
  },
  register: registerWebDevice,
  update: async (id, credential) => {
    await updateDeviceCredential(id, credential)
    invalidateDeviceCache()
  },
  remove: leaveDevice,
  unlockHost: () => getLockManager().completeUnlock()
})

onDeviceRevoked((id) => webTerminals.invalidate(id))

let server: ServerType | null = null
let runningOrigin = ''
let apiFetch:
  | ((request: Request, bindings: Bindings) => Response | Promise<Response>)
  | undefined
let sweep: ReturnType<typeof setInterval> | undefined
let removeLockListener: (() => void) | undefined
let transition: Promise<void> = Promise.resolve()

export function stopWebAccess() {
  webTerminals.invalidate()
  clearInterval(sweep)
  sweep = undefined
  removeLockListener?.()
  removeLockListener = undefined
  const closing = server
  server = null
  runningOrigin = ''
  closing?.close()
  if (closing && 'closeAllConnections' in closing) closing.closeAllConnections()
}

export function initWebAccess(fetch: NonNullable<typeof apiFetch>) {
  apiFetch = fetch
}

async function reconcile() {
  const config = readWebAccessConfig()
  if (runningOrigin && (runningOrigin !== config.origin || !config.enabled))
    stopWebAccess()
  if (!config.enabled || server || !apiFetch) return
  const fetch = apiFetch
  const rendererName =
    typeof MAIN_WINDOW_VITE_NAME === 'string'
      ? MAIN_WINDOW_VITE_NAME
      : 'main_window'
  const web = createWebApp({
    config: readWebAccessConfig,
    terminals: webTerminals,
    hostLocked: () => getLockManager().isLocked(),
    api: fetch,
    asset: (path) =>
      webRendererAsset(app.getAppPath(), app.isPackaged, rendererName, path)
  })
  await new Promise<void>((resolve, reject) => {
    const starting = serve(
      { fetch: web.fetch, hostname: '127.0.0.1', port: WEB_SERVER_PORT },
      () => {
        server = starting
        runningOrigin = config.origin
        resolve()
      }
    )
    starting.once('error', reject)
  })
  const manager = getLockManager()
  const locked = () => {
    if (manager.isLocked()) webTerminals.invalidate()
  }
  manager.on('state-changed', locked)
  removeLockListener = () => manager.removeListener('state-changed', locked)
  sweep = setInterval(() => webTerminals.sessions.sweep(), 5000)
  sweep.unref()
  logger.info('server', 'Web terminal listener up', {
    port: WEB_SERVER_PORT,
    origin: config.origin
  })
}

export function syncWebAccess(): Promise<void> {
  const run = transition.then(reconcile, reconcile)
  transition = run.catch(() => {})
  return run
}

let configuring: Promise<unknown> = Promise.resolve()
export function configureWebAccess(
  value: WebAccessConfig
): Promise<WebAccessConfig> {
  const run = configuring.then(async () => {
    const previous = readWebAccessConfig()
    const next = writeWebAccessConfig(value)
    try {
      await syncWebAccess()
    } catch (error) {
      writeWebAccessConfig(previous)
      await syncWebAccess()
      throw error
    }
    return next
  })
  configuring = run.catch(() => {})
  return run
}

export function webAccessState() {
  const window = webTerminals.pairing.current()
  return {
    ...readWebAccessConfig(),
    running: !!server,
    port: WEB_SERVER_PORT,
    pairing: window ? { code: window.code, expiresAt: window.expiresAt } : null
  }
}
