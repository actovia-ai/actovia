import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { inspect, promisify } from 'node:util'

import { ACTOVIA_REPO } from '@actovia/shared/constants/external-urls'
import { app, autoUpdater, BrowserWindow, net } from 'electron'
import { updateElectronApp } from 'update-electron-app'

import { logger } from './logger'
import { openExternalSafely } from './security'

const execFileAsync = promisify(execFile)

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

/**
 * `auto` — Squirrel downloads and installs updates itself (a build signed with
 * a stable identity). `manual` — this build cannot validate its own updates, so
 * the app only *tells* the user a newer version exists and sends them to the
 * download page. See `detectUpdateMode`.
 */
export type UpdateMode = 'auto' | 'manual'

export interface UpdaterPayload {
  state: UpdaterState
  availableVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  mode: UpdateMode
}

let payload: UpdaterPayload = {
  state: 'idle',
  availableVersion: null,
  downloadProgress: 0,
  errorMessage: null,
  mode: 'auto'
}

let autoUpdateEnabled = true
let modeReady: Promise<UpdateMode> = Promise.resolve('auto')
const RELEASES_LATEST_URL = `${ACTOVIA_REPO}/releases/latest`
const FEED_HOST = 'https://update.electronjs.org'
const FEED_TIMEOUT_MS = 15_000

function broadcast() {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('updater-state-changed', payload)
  })
}

function setState(state: UpdaterState, extra?: Partial<UpdaterPayload>) {
  payload = { ...payload, state, ...extra }
  broadcast()
}

/**
 * Can this build update itself through Squirrel? On macOS Squirrel refuses any
 * update that does not satisfy the *running* app's designated requirement. An
 * ad-hoc (or missing) signature has none that survives a rebuild — its
 * requirement is that build's own `cdhash` — so every update fails validation,
 * however the network behaves. Read the signature the way `codesign` reports
 * it, so that the day the build is signed with a Developer ID this flips to
 * `auto` on its own, with no code change. Other platforms, and unpackaged
 * runs (nothing to update), stay on Squirrel/`update-electron-app` as before.
 */
export async function detectUpdateMode(): Promise<UpdateMode> {
  if (process.platform !== 'darwin' || !app.isPackaged) return 'auto'
  try {
    const bundle = resolve(app.getPath('exe'), '../../..')
    // `codesign -d` reports on stderr.
    const { stderr } = await execFileAsync('/usr/bin/codesign', ['-dv', bundle])
    return /^Signature=adhoc$/m.test(stderr) ? 'manual' : 'auto'
  } catch {
    // "code object is not signed at all", or no codesign to ask.
    return 'manual'
  }
}

/**
 * The same lookup Squirrel does (update.electronjs.org, 204 = nothing newer),
 * without downloading anything. `net.fetch` rather than `fetch` so it follows
 * the system proxy like the rest of Chromium's networking does.
 */
async function checkFeed(): Promise<void> {
  setState('checking')
  const url = `${FEED_HOST}/${new URL(ACTOVIA_REPO).pathname.slice(1)}/${process.platform}-${process.arch}/${app.getVersion()}`
  try {
    logger.info('app', 'Updater: checking feed', { url })
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': `actovia/${app.getVersion()} (${process.platform}: ${process.arch})`
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    })
    if (res.status === 204) {
      logger.info('app', 'Updater: no update available', {
        version: app.getVersion()
      })
      setState('up-to-date')
      return
    }
    if (!res.ok) throw new Error(`The update server answered ${res.status}`)
    const release = (await res.json()) as { name?: string }
    logger.info('app', 'Updater: newer version found', { name: release.name })
    setState('available', { availableVersion: release.name ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('app', 'Updater: feed check failed', { error: err })
    setState('error', { errorMessage: message })
  }
}

function startSquirrel(): void {
  // Every step is logged: a packaged app has no console, and without this an
  // update that fails (or claims "up to date") leaves nothing to look at.
  autoUpdater.on('checking-for-update', () => {
    logger.info('app', 'Updater: checking for update', {
      version: app.getVersion()
    })
    setState('checking')
  })
  autoUpdater.on('update-available', () => {
    logger.info('app', 'Updater: update available, downloading')
    setState('downloading', { downloadProgress: 0 })
  })
  autoUpdater.on('update-not-available', () => {
    logger.info('app', 'Updater: no update available', {
      version: app.getVersion()
    })
    setState('up-to-date')
  })
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    logger.info('app', 'Updater: update downloaded', { releaseName })
    setState('ready', {
      availableVersion: releaseName || null,
      downloadProgress: 100
    })
  })
  autoUpdater.on('error', (err) => {
    logger.error('app', 'Updater: error', { error: err })
    setState('error', { errorMessage: err.message ?? 'Unknown error' })
  })

  try {
    // Our own update panel replaces the library's native "restart now?" dialog.
    // Its own log lines (the feed URL it checks, its 10-minute re-checks) go to
    // our log instead of a stdout nobody sees.
    const log = (...args: unknown[]) =>
      logger.info('app', 'update-electron-app', {
        message: args
          .map((a) => (typeof a === 'string' ? a : inspect(a)))
          .join(' ')
      })
    updateElectronApp({
      notifyUser: false,
      logger: { log, info: log, warn: log, error: log }
    })
  } catch (err) {
    logger.warn('app', 'Auto-update not available', {
      error: err
    })
  }
}

/**
 * Update flow, by build:
 *
 * - Signed with a real identity (`auto`): Electron's `autoUpdater` (Squirrel)
 *   against update.electronjs.org for Forge + GitHub Releases, wired by
 *   `update-electron-app` — the mechanism electron-forge's own docs recommend
 *   (https://www.electronforge.io/advanced/auto-update). Squirrel always
 *   downloads by itself and reports no progress, so `available` is skipped: an
 *   update goes straight to `downloading` (indeterminate) and then `ready`.
 *   (`electron-updater` needs `latest.yml` that only electron-builder makes.)
 * - macOS build with no stable signature (`manual`, today's releases): Squirrel
 *   can never validate an update, and its 10-minute re-check would download the
 *   whole zip and fail every time — so it is not started. One feed lookup at
 *   launch, and one per manual check, tell the user a newer version exists;
 *   `updaterDownload()` opens the release page.
 *
 * The exported state machine keeps the shape the renderer's update panel
 * speaks (universal-client's electron-updater one), plus `mode`.
 */
export function setupAutoUpdater(autoUpdate = true): void {
  autoUpdateEnabled = autoUpdate
  if (!autoUpdate) return

  modeReady = detectUpdateMode().then((mode) => {
    payload = { ...payload, mode }
    broadcast()
    return mode
  })
  void modeReady.then((mode) => {
    if (mode === 'manual') {
      logger.info(
        'app',
        'Updater: this build has no stable code signature, so Squirrel cannot validate updates; using the release page instead'
      )
      void checkFeed()
    } else {
      startSquirrel()
    }
  })
}

export function updaterGetState(): UpdaterPayload {
  return payload
}

export async function updaterCheck(): Promise<void> {
  if (!app.isPackaged) {
    setState('error', {
      errorMessage: 'Updates are only available in packaged builds'
    })
    return
  }
  if (!autoUpdateEnabled) {
    setState('error', {
      errorMessage: 'Automatic updates are turned off in settings'
    })
    return
  }
  const mode = await modeReady
  logger.info('app', 'Updater: manual check', {
    version: app.getVersion(),
    mode
  })
  if (mode === 'manual') {
    await checkFeed()
    return
  }
  setState('checking')
  try {
    autoUpdater.checkForUpdates()
  } catch (err) {
    setState('error', {
      errorMessage: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Squirrel downloads on its own as soon as an update is found; in `manual`
 * mode there is nothing to download in-app, so this opens the release page.
 */
export function updaterDownload(): void {
  if (payload.mode === 'manual') openExternalSafely(RELEASES_LATEST_URL)
}

export function updaterInstall(): void {
  autoUpdater.quitAndInstall()
}

/**
 * Squirrel can't be told to stop downloading, so this only gates manual
 * checks; the periodic check `updateElectronApp` started at launch keeps
 * running until the next launch, when the persisted setting is re-read.
 */
export function updaterSetAutoDownload(enable: boolean): void {
  autoUpdateEnabled = enable
}
