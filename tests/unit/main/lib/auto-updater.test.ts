import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const squirrel = new EventEmitter() as EventEmitter & {
  checkForUpdates: () => void
}
squirrel.checkForUpdates = vi.fn()

const send = vi.fn()
const electronApp = {
  isPackaged: true,
  getVersion: () => '1.15.0',
  getPath: () => '/Applications/Actovia.app/Contents/MacOS/Actovia'
}
vi.mock('electron', () => ({
  app: electronApp,
  autoUpdater: squirrel,
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] }
}))

const macUpdater = vi.hoisted(() => ({ emitter: null as unknown }))
vi.mock('electron-updater', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const updater = Object.assign(new Emitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null as unknown,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  })
  macUpdater.emitter = updater
  return { autoUpdater: updater }
})
type MacUpdaterMock = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

const updateElectronApp = vi.fn()
vi.mock('update-electron-app', () => ({
  updateElectronApp: (opts: unknown) => updateElectronApp(opts)
}))

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger }))

const openExternalSafely = vi.fn()
vi.mock('@main/lib/security', () => ({
  openExternalSafely: (url: string) => openExternalSafely(url)
}))

const codesign = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  const execFile = Object.assign(() => {}, {
    [promisify.custom]: (...args: unknown[]) => codesign.run(...args)
  })
  return { execFile, default: { execFile } }
})

const ADHOC = `Executable=/Applications/Actovia.app/Contents/MacOS/Actovia
Identifier=com.github.Electron
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=300 flags=0x2(adhoc) hashes=3+3 location=embedded
Signature=adhoc
TeamIdentifier=not set
`
const DEVELOPER_ID = `Executable=/Applications/Actovia.app/Contents/MacOS/Actovia
Identifier=app.yancey.actovia
CodeDirectory v=20500 size=900 flags=0x10000(runtime) hashes=20+7 location=embedded
Authority=Developer ID Application: Someone (ABCDE12345)
TeamIdentifier=ABCDE12345
`

const realPlatform = process.platform
function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

async function load() {
  vi.resetModules()
  return await import('@main/lib/auto-updater')
}

/** Let the mode detection and whatever it kicks off settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The electron-updater mock, as the module under test sees it. */
async function mac(): Promise<MacUpdaterMock> {
  await import('electron-updater')
  return macUpdater.emitter as MacUpdaterMock
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useRealTimers()
  squirrel.removeAllListeners()
  const updater = await mac()
  updater.removeAllListeners()
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  electronApp.isPackaged = true
  setPlatform('darwin')
  codesign.run.mockResolvedValue({ stdout: '', stderr: DEVELOPER_ID })
})

afterEach(() => setPlatform(realPlatform))

describe('detectUpdateMode', () => {
  it('an ad-hoc signature cannot be updated through Squirrel', async () => {
    codesign.run.mockResolvedValue({ stdout: '', stderr: ADHOC })
    const { detectUpdateMode } = await load()
    expect(await detectUpdateMode()).toBe('manual')
    expect(codesign.run).toHaveBeenCalledWith('/usr/bin/codesign', [
      '-dv',
      '/Applications/Actovia.app'
    ])
  })

  it('a Developer ID signature can', async () => {
    const { detectUpdateMode } = await load()
    expect(await detectUpdateMode()).toBe('auto')
  })

  it('no signature at all cannot', async () => {
    codesign.run.mockRejectedValue(
      new Error('code object is not signed at all')
    )
    const { detectUpdateMode } = await load()
    expect(await detectUpdateMode()).toBe('manual')
  })

  it('does not ask codesign off macOS, or from an unpackaged run', async () => {
    const { detectUpdateMode } = await load()
    setPlatform('win32')
    expect(await detectUpdateMode()).toBe('auto')
    setPlatform('darwin')
    electronApp.isPackaged = false
    expect(await detectUpdateMode()).toBe('auto')
    expect(codesign.run).not.toHaveBeenCalled()
  })
})

describe('macOS, a signed build (electron-updater, auto)', () => {
  it('reads the GitHub release feed, downloads by itself and installs on quit', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'actovia-ai',
      repo: 'actovia'
    })
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updateElectronApp).not.toHaveBeenCalled()
    expect(updaterGetState().mode).toBe('auto')
  })

  it('ACTOVIA_UPDATE_FEED points it at a local feed instead', async () => {
    vi.stubEnv('ACTOVIA_UPDATE_FEED', 'http://127.0.0.1:8123/')
    const updater = await mac()
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(true)
    await settle()
    vi.unstubAllEnvs()

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:8123/'
    })
  })

  it('walks checking → downloading with real progress → ready', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    updater.emit('checking-for-update')
    expect(updaterGetState().state).toBe('checking')
    updater.emit('update-available', { version: '2.6.0' })
    expect(updaterGetState()).toMatchObject({
      state: 'downloading',
      availableVersion: '2.6.0',
      downloadProgress: 0
    })
    updater.emit('download-progress', { percent: 41.6 })
    expect(updaterGetState().downloadProgress).toBe(42)
    updater.emit('update-downloaded', { version: '2.6.0' })
    expect(updaterGetState()).toMatchObject({
      state: 'ready',
      availableVersion: '2.6.0',
      downloadProgress: 100
    })
  })

  it('surfaces an error in the panel and logs the Error itself', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    const error = new Error(
      'Cannot find latest-mac.yml in the latest release artifacts'
    )
    updater.emit('error', error)

    expect(updaterGetState()).toMatchObject({
      state: 'error',
      errorMessage: error.message
    })
    expect(logger.error).toHaveBeenCalledWith('app', 'Updater: error', {
      error
    })
  })

  it('re-checks every ten minutes, and not while updates are switched off', async () => {
    vi.useFakeTimers()
    const updater = await mac()
    const { setupAutoUpdater, updaterSetAutoDownload } = await load()
    setupAutoUpdater(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)

    updaterSetAutoDownload(false)
    expect(updater.autoDownload).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('"Restart & Install" goes through electron-updater', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterInstall } = await load()
    setupAutoUpdater(true)
    await settle()

    updaterInstall()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('"download" fetches an update a check found while downloads were off', async () => {
    const updater = await mac()
    const {
      setupAutoUpdater,
      updaterDownload,
      updaterSetAutoDownload,
      updaterGetState
    } = await load()
    setupAutoUpdater(true)
    await settle()
    updaterSetAutoDownload(false)

    updater.emit('update-available', { version: '2.6.0' })
    expect(updaterGetState().state).toBe('available')

    updaterDownload()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(openExternalSafely).not.toHaveBeenCalled()
  })
})

describe('macOS, an ad-hoc build (electron-updater, manual)', () => {
  beforeEach(() => {
    codesign.run.mockResolvedValue({ stdout: '', stderr: ADHOC })
  })

  it('checks once at launch and downloads nothing', async () => {
    vi.useFakeTimers()
    const updater = await mac()
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updateElectronApp).not.toHaveBeenCalled()
    expect(updaterGetState().mode).toBe('manual')
  })

  it('a newer release becomes "available", and "download" opens the release page', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterGetState, updaterDownload } = await load()
    setupAutoUpdater(true)
    await settle()

    updater.emit('update-available', { version: '2.6.0' })
    expect(updaterGetState()).toMatchObject({
      state: 'available',
      availableVersion: '2.6.0',
      mode: 'manual'
    })

    updaterDownload()
    expect(openExternalSafely).toHaveBeenCalledWith(
      'https://github.com/actovia-ai/actovia/releases/latest'
    )
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('a manual check asks electron-updater again, still without downloading', async () => {
    const updater = await mac()
    const { setupAutoUpdater, updaterCheck } = await load()
    setupAutoUpdater(true)
    await settle()

    await updaterCheck()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.autoDownload).toBe(false)
  })

  it('does nothing at launch when automatic updates are turned off', async () => {
    const updater = await mac()
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(false)
    await settle()

    expect(codesign.run).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updateElectronApp).not.toHaveBeenCalled()
  })
})

describe('Windows (Squirrel through update-electron-app)', () => {
  beforeEach(() => setPlatform('win32'))

  it('starts update-electron-app, never electron-updater', async () => {
    const updater = await mac()
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updateElectronApp).toHaveBeenCalledTimes(1)
    expect(updater.setFeedURL).not.toHaveBeenCalled()
    expect(codesign.run).not.toHaveBeenCalled()
  })

  it('walks checking → downloading → ready', async () => {
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    squirrel.emit('checking-for-update')
    expect(updaterGetState().state).toBe('checking')
    squirrel.emit('update-available')
    expect(updaterGetState().state).toBe('downloading')
    squirrel.emit('update-downloaded', {}, '', 'v2.6.0')
    expect(updaterGetState()).toMatchObject({
      state: 'ready',
      availableVersion: 'v2.6.0'
    })
  })

  it('records a failed update with its full message', async () => {
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    const error = new Error('Update.exe not found')
    squirrel.emit('error', error)
    expect(updaterGetState()).toMatchObject({
      state: 'error',
      errorMessage: error.message
    })
    expect(logger.error).toHaveBeenCalledWith('app', 'Updater: error', {
      error
    })
  })

  it("routes update-electron-app's own log lines into our log", async () => {
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(true)
    await settle()

    const { logger: libLogger } = updateElectronApp.mock.calls[0][0] as {
      logger: { log: (...args: unknown[]) => void }
    }
    libLogger.log(
      'feedURL',
      'https://update.electronjs.org/o/r/win32-x64/2.5.0'
    )
    expect(logger.info).toHaveBeenCalledWith('app', 'update-electron-app', {
      message: 'feedURL https://update.electronjs.org/o/r/win32-x64/2.5.0'
    })
  })

  it('a manual check asks Squirrel, and "download" is a no-op', async () => {
    const { setupAutoUpdater, updaterCheck, updaterDownload } = await load()
    setupAutoUpdater(true)
    await settle()

    await updaterCheck()
    expect(squirrel.checkForUpdates).toHaveBeenCalledTimes(1)
    updaterDownload()
    expect(openExternalSafely).not.toHaveBeenCalled()
  })
})
