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
  getPath: () => '/Applications/Exodus.app/Contents/MacOS/Exodus'
}
const netFetch = vi.fn()
vi.mock('electron', () => ({
  app: electronApp,
  autoUpdater: squirrel,
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
  net: { fetch: (...args: unknown[]) => netFetch(...args) }
}))

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

const ADHOC = `Executable=/Applications/Exodus.app/Contents/MacOS/Exodus
Identifier=com.github.Electron
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=300 flags=0x2(adhoc) hashes=3+3 location=embedded
Signature=adhoc
TeamIdentifier=not set
`
const DEVELOPER_ID = `Executable=/Applications/Exodus.app/Contents/MacOS/Exodus
Identifier=app.yancey.exodus
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

function feedResponse(status: number, body?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  squirrel.removeAllListeners()
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
      '/Applications/Exodus.app'
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

describe('auto mode (a signed build)', () => {
  it('records a failed update with its full message, and surfaces it in the panel state', async () => {
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    const message =
      'Code signature at URL file:///Users/x/Library/Caches/app.yancey.exodus.ShipIt/update.1/Exodus.app did not pass validation'
    squirrel.emit('error', new Error(message))

    expect(updaterGetState()).toMatchObject({
      state: 'error',
      errorMessage: message,
      mode: 'auto'
    })
    // The Error itself, so the log carries its stack.
    expect(logger.error).toHaveBeenCalledWith('app', 'Updater: error', {
      error: expect.objectContaining({ message })
    })
    expect(vi.mocked(logger.error).mock.calls.at(-1)![2]!.error).toBeInstanceOf(
      Error
    )
  })

  it('walks checking → downloading → ready, logging each step', async () => {
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    squirrel.emit('checking-for-update')
    expect(updaterGetState().state).toBe('checking')
    squirrel.emit('update-available')
    expect(updaterGetState().state).toBe('downloading')
    squirrel.emit('update-downloaded', {}, '', 'v1.16.0')
    expect(updaterGetState()).toMatchObject({
      state: 'ready',
      availableVersion: 'v1.16.0'
    })
  })

  it('records "no update available" with the version it checked from', async () => {
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    squirrel.emit('update-not-available')

    expect(updaterGetState().state).toBe('up-to-date')
    expect(logger.info).toHaveBeenCalledWith(
      'app',
      'Updater: no update available',
      { version: '1.15.0' }
    )
  })

  it("routes update-electron-app's own log lines (the feed URL) into our log", async () => {
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(true)
    await settle()

    const { logger: libLogger } = updateElectronApp.mock.calls[0][0] as {
      logger: { log: (...args: unknown[]) => void }
    }
    libLogger.log(
      'feedURL',
      'https://update.electronjs.org/o/r/darwin-arm64/1.15.0'
    )
    libLogger.log('requestHeaders', {
      'User-Agent': 'update-electron-app/3.3.0'
    })

    expect(logger.info).toHaveBeenCalledWith('app', 'update-electron-app', {
      message: 'feedURL https://update.electronjs.org/o/r/darwin-arm64/1.15.0'
    })
    expect(logger.info).toHaveBeenCalledWith('app', 'update-electron-app', {
      message: expect.stringContaining('update-electron-app/3.3.0')
    })
  })

  it('a manual check asks Squirrel, and "download" is a no-op', async () => {
    const { setupAutoUpdater, updaterCheck, updaterDownload } = await load()
    setupAutoUpdater(true)
    await settle()

    await updaterCheck()
    expect(squirrel.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(netFetch).not.toHaveBeenCalled()

    updaterDownload()
    expect(openExternalSafely).not.toHaveBeenCalled()
  })
})

describe('manual mode (an ad-hoc build that cannot validate its own updates)', () => {
  beforeEach(() => {
    codesign.run.mockResolvedValue({ stdout: '', stderr: ADHOC })
  })

  it('never starts Squirrel or its 10-minute re-check', async () => {
    netFetch.mockResolvedValue(feedResponse(204))
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updateElectronApp).not.toHaveBeenCalled()
    expect(squirrel.listenerCount('error')).toBe(0)
    expect(squirrel.listenerCount('update-available')).toBe(0)
  })

  it('looks the feed up once at launch, with the same URL Squirrel would use', async () => {
    netFetch.mockResolvedValue(feedResponse(204))
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(netFetch).toHaveBeenCalledTimes(1)
    const [url, init] = netFetch.mock.calls[0]
    expect(url).toBe(
      `https://update.electronjs.org/actovia-ai/actovia/darwin-${process.arch}/1.15.0`
    )
    expect(init.headers['User-Agent']).toMatch(/^exodus\/1\.15\.0/)
    expect(updaterGetState()).toMatchObject({
      state: 'up-to-date',
      mode: 'manual'
    })
  })

  it('a newer release becomes "available", carrying its version', async () => {
    netFetch.mockResolvedValue(
      feedResponse(200, { name: 'v1.16.0', url: 'https://example/zip' })
    )
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updaterGetState()).toMatchObject({
      state: 'available',
      availableVersion: 'v1.16.0',
      mode: 'manual'
    })
  })

  it('"download" opens the release page instead of downloading anything', async () => {
    netFetch.mockResolvedValue(feedResponse(200, { name: 'v1.16.0' }))
    const { setupAutoUpdater, updaterDownload } = await load()
    setupAutoUpdater(true)
    await settle()

    updaterDownload()

    expect(openExternalSafely).toHaveBeenCalledWith(
      'https://github.com/actovia-ai/actovia/releases/latest'
    )
  })

  it('a failed lookup is an error the user can retry, and it is logged', async () => {
    netFetch.mockRejectedValueOnce(
      new Error('net::ERR_PROXY_CONNECTION_FAILED')
    )
    const { setupAutoUpdater, updaterCheck, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updaterGetState()).toMatchObject({
      state: 'error',
      errorMessage: 'net::ERR_PROXY_CONNECTION_FAILED'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'app',
      'Updater: feed check failed',
      { error: new Error('net::ERR_PROXY_CONNECTION_FAILED') }
    )

    netFetch.mockResolvedValueOnce(feedResponse(204))
    await updaterCheck()
    expect(updaterGetState().state).toBe('up-to-date')
  })

  it('an error status from the server is an error, not "up to date"', async () => {
    netFetch.mockResolvedValue(feedResponse(502))
    const { setupAutoUpdater, updaterGetState } = await load()
    setupAutoUpdater(true)
    await settle()

    expect(updaterGetState()).toMatchObject({
      state: 'error',
      errorMessage: 'The update server answered 502'
    })
  })

  it('does nothing at launch when automatic updates are turned off', async () => {
    const { setupAutoUpdater } = await load()
    setupAutoUpdater(false)
    await settle()

    expect(codesign.run).not.toHaveBeenCalled()
    expect(netFetch).not.toHaveBeenCalled()
    expect(updateElectronApp).not.toHaveBeenCalled()
  })
})
