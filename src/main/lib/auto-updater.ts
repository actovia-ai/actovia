import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { inspect, promisify } from 'node:util'

import { ACTOVIA_REPO } from '@actovia/shared/constants/external-urls'
import { app, autoUpdater, BrowserWindow } from 'electron'
import { autoUpdater as macUpdater } from 'electron-updater'
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
/** update-electron-app's own cadence, kept for macOS. */
const CHECK_INTERVAL_MS = 10 * 60 * 1000
const isMac = () => process.platform === 'darwin' && app.isPackaged

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

// Every step is logged: a packaged app has no console, and without this an
// update that fails (or claims "up to date") leaves nothing to look at.
const macUpdaterLogger = {
  info: (message?: unknown) =>
    logger.info('app', 'electron-updater', { message: String(message) }),
  warn: (message?: unknown) =>
    logger.warn('app', 'electron-updater', { message: String(message) }),
  error: (message?: unknown) =>
    logger.error('app', 'electron-updater', { message: String(message) }),
  debug: (message: string) =>
    logger.debug('app', 'electron-updater', { message })
}

/**
 * macOS: electron-updater against the GitHub release's `latest-mac.yml`
 * (ISSUE-290). It downloads only the blocks of the zip that changed since the
 * zip it downloaded last (`.blockmap`, made by forge.config.ts's postMake), so
 * the first update after an install by hand is a whole download and the ones
 * after it are not; then it hands the zip to Squirrel.Mac, which installs it
 * on quit. In `manual` mode (ad-hoc build) it only checks: nothing is
 * downloaded, and the panel's button opens the release page.
 */
function startMacUpdater(mode: UpdateMode): void {
  const [owner, repo] = new URL(ACTOVIA_REPO).pathname.slice(1).split('/')
  // ACTOVIA_UPDATE_FEED: a directory served over http holding latest-mac.yml,
  // the zip and its blockmap, for trying an update end to end before a
  // release. Squirrel.Mac still installs only a build that satisfies this
  // one's designated requirement (the team's signature), whatever the feed.
  const feed = process.env.ACTOVIA_UPDATE_FEED
  macUpdater.setFeedURL(
    feed
      ? { provider: 'generic', url: feed }
      : { provider: 'github', owner, repo }
  )
  macUpdater.logger = macUpdaterLogger
  macUpdater.autoDownload = mode === 'auto' && autoUpdateEnabled
  macUpdater.autoInstallOnAppQuit = mode === 'auto'

  macUpdater.on('checking-for-update', () => setState('checking'))
  macUpdater.on('update-not-available', () => setState('up-to-date'))
  macUpdater.on('update-available', (info) => {
    logger.info('app', 'Updater: update available', { version: info.version })
    setState(macUpdater.autoDownload ? 'downloading' : 'available', {
      availableVersion: info.version,
      downloadProgress: 0
    })
  })
  macUpdater.on('download-progress', (progress) => {
    setState('downloading', { downloadProgress: Math.round(progress.percent) })
  })
  macUpdater.on('update-downloaded', (info) => {
    logger.info('app', 'Updater: update downloaded', { version: info.version })
    setState('ready', { availableVersion: info.version, downloadProgress: 100 })
  })
  macUpdater.on('error', (err) => {
    logger.error('app', 'Updater: error', { error: err })
    setState('error', { errorMessage: err.message ?? 'Unknown error' })
  })

  const check = () => {
    macUpdater.checkForUpdates().catch(() => {
      // Reported through the 'error' event above.
    })
  }
  check()
  if (mode === 'auto') {
    setInterval(() => {
      if (autoUpdateEnabled) check()
    }, CHECK_INTERVAL_MS).unref()
  }
}

function startSquirrel(): void {
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
 * Update flow, by platform:
 *
 * - macOS: electron-updater (`startMacUpdater`), in one of two modes. `auto`, a
 *   build signed with the Developer ID: downloads by itself, with progress, and
 *   installs on quit or on "Restart & Install". `manual`, an ad-hoc build:
 *   Squirrel.Mac can never validate an update for it, so it only checks, and
 *   `updaterDownload()` opens the release page.
 * - Windows: Electron's `autoUpdater` (Squirrel.Windows) against
 *   update.electronjs.org, wired by `update-electron-app`. Squirrel downloads by
 *   itself and reports no progress, so an update goes straight to
 *   `downloading` (indeterminate) and then `ready`.
 *
 * The exported state machine keeps the shape the renderer's update panel
 * speaks, plus `mode`.
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
    if (isMac()) {
      if (mode === 'manual') {
        logger.info(
          'app',
          'Updater: this build has no stable code signature, so Squirrel cannot validate updates; checking only, the release page installs'
        )
      }
      startMacUpdater(mode)
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
  if (isMac()) {
    macUpdater.autoDownload = mode === 'auto'
    await macUpdater.checkForUpdates().catch(() => {
      // Reported through the 'error' event.
    })
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
 * In `manual` mode there is nothing to download in-app, so this opens the
 * release page. On macOS in `auto` mode it downloads an update a check found
 * while automatic downloads were off; Squirrel.Windows always downloads on
 * its own.
 */
export function updaterDownload(): void {
  if (payload.mode === 'manual') {
    openExternalSafely(RELEASES_LATEST_URL)
    return
  }
  if (isMac()) {
    macUpdater.downloadUpdate().catch(() => {
      // Reported through the 'error' event.
    })
  }
}

export function updaterInstall(): void {
  if (isMac()) macUpdater.quitAndInstall()
  else autoUpdater.quitAndInstall()
}

/**
 * macOS: stops (or resumes) the periodic checks and their downloads. Windows:
 * Squirrel can't be told to stop downloading, so this only gates manual
 * checks; the periodic check `updateElectronApp` started at launch keeps
 * running until the next launch, when the persisted setting is re-read.
 */
export function updaterSetAutoDownload(enable: boolean): void {
  autoUpdateEnabled = enable
  if (isMac()) macUpdater.autoDownload = enable && payload.mode === 'auto'
}
