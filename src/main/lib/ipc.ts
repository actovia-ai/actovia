import { existsSync } from 'fs'
import { join, resolve, sep } from 'path'

import { toAppError } from '@actovia/shared'
import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  nativeTheme,
  shell
} from 'electron'

import { setupAttachmentIPC } from './attachment-actions'
import {
  updaterCheck,
  updaterDownload,
  updaterGetState,
  updaterInstall,
  updaterSetAutoDownload
} from './auto-updater'
import { getSettings } from './db/queries'
import { setupLockIPC } from './lock/ipc'
import { logger } from './logger'
import { getAnalyticsDir, getArtifactsDir, getLogsDir } from './paths'
import { getPresenceToken } from './presence'
import { destroyTray, setTray } from './tray'
import {
  closeSearchBar,
  getMainWindow,
  getQuickChatView,
  setQuickChatView
} from './window'
import { setupWorkspaceFileIPC } from './workspace-file-actions'

/** Wrap an IPC handler so that any thrown error is logged instead of silently lost. */
function safeHandle(
  channel: string,
  handler: (...args: unknown[]) => unknown | Promise<unknown>
) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args)
    } catch (err) {
      const appError = toAppError(err)
      // What was caught, not `appError`: wrapping gives a plain Error a new
      // stack that starts here rather than where it was thrown.
      logger.error('app', `IPC handler "${channel}" failed`, {
        code: appError.code,
        error: err
      })
      throw appError
    }
  })
}

// The window whose fullscreen events are already being relayed. Every mounted
// `useIsFullscreen()` invokes the subscribe channel, and each call used to add
// two more listeners to the window — never removed — so every transition was
// sent once per mount so far (and Node warned past ten).
let fullscreenRelayWindow: BrowserWindow | null = null

const PRESENCE_CHANNEL = 'api:presence-token'
const MAPS_KEY_CHANNEL = 'maps:js-key'

/** Whether an IPC call comes from the main window's own top frame. */
function fromMainFrame(event: IpcMainInvokeEvent): boolean {
  const main = getMainWindow()?.webContents
  return !!main && event.sender === main && event.senderFrame === main.mainFrame
}

export function setupIPC() {
  ipcMain.on('ping', () => logger.debug('app', 'pong'))
  setupLockIPC()
  setupAttachmentIPC()
  setupWorkspaceFileIPC()

  safeHandle('find-in-page', (_, keyword) => {
    if (keyword === '') {
      getMainWindow()?.webContents.stopFindInPage('clearSelection')
    } else {
      getMainWindow()?.webContents.findInPage(keyword as string)
    }
  })

  safeHandle('find-next', (_, keyword) => {
    if (keyword === '') {
      getMainWindow()?.webContents.stopFindInPage('clearSelection')
    } else {
      getMainWindow()?.webContents.findInPage(keyword as string, {
        findNext: true
      })
    }
  })

  safeHandle('find-previous', (_, keyword) => {
    if (keyword === '') {
      getMainWindow()?.webContents.stopFindInPage('clearSelection')
    } else {
      getMainWindow()?.webContents.findInPage(keyword as string, {
        findNext: false,
        forward: false
      })
    }
  })

  safeHandle('close-search-bar', () => closeSearchBar())

  // The user-presence token (presence.ts): only to the main window's own top
  // frame — the page that shows approval prompts and the Devices page. A
  // sub-app or an embedded frame never gets it.
  ipcMain.handle(PRESENCE_CHANNEL, (event) => {
    if (!fromMainFrame(event)) {
      logger.warn('app', 'Refused the presence token to another frame')
      return null
    }
    return getPresenceToken()
  })

  // The Google Maps JS key, for the map-itinerary card's `<APIProvider>`: the
  // one registry secret the renderer itself needs. Handed over IPC to the
  // main window's top frame only — never through the API, which any loopback
  // caller (the model's `curl`) can read, and which masks it like every other
  // key. Places photos go through `GET /api/v1/maps/photo` instead.
  ipcMain.handle(MAPS_KEY_CHANNEL, async (event) => {
    if (!fromMainFrame(event)) {
      logger.warn('app', 'Refused the Maps key to another frame')
      return null
    }
    try {
      return (await getSettings()).googleCloud?.googleApiKey || null
    } catch {
      return null
    }
  })

  safeHandle('close-quick-chat', () => {
    const quickChatView = getQuickChatView()
    if (quickChatView) {
      quickChatView.hide()
      setQuickChatView(null)
      quickChatView.destroy()
    }
  })

  safeHandle('transfer-quick-chat', (_, input: unknown) => {
    // Close quick-chat window first
    const quickChatView = getQuickChatView()
    if (quickChatView) {
      quickChatView.hide()
      setQuickChatView(null)
      quickChatView.destroy()
    }

    // Bring main window to front and send input
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      app.focus({ steal: true })
      mainWindow.webContents.send('quick-chat-input', input)
    }
  })

  safeHandle('bring-window-to-front', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }

    mainWindow.focus()

    app.focus({ steal: true })
  })

  safeHandle('check-fullscreen', () => getMainWindow()?.isFullScreen() ?? false)

  safeHandle('subscribe-fullscreen-change', () => {
    const win = getMainWindow()
    if (!win || fullscreenRelayWindow === win) return
    fullscreenRelayWindow = win

    const send = (isFullscreen: boolean) => {
      win.webContents.send('fullscreen-changed', isFullscreen)
    }

    win.on('enter-full-screen', () => send(true))
    win.on('leave-full-screen', () => send(false))
  })

  safeHandle('set-native-theme', (_, source: unknown) => {
    nativeTheme.themeSource = source as 'dark' | 'light' | 'system'
  })

  safeHandle('open-logs-dir', () => {
    shell.openPath(getLogsDir())
  })

  safeHandle('open-analytics-dir', () => {
    shell.openPath(getAnalyticsDir())
  })

  safeHandle('reveal-artifact-file', (_, arg: unknown) => {
    const { chatId, artifactId } = arg as {
      chatId?: string
      artifactId?: string
    }
    if (!artifactId || !chatId) {
      return { ok: false as const, reason: 'missing-ids' }
    }

    const artifactsBase = resolve(getArtifactsDir())
    const filePath = resolve(join(artifactsBase, chatId, `${artifactId}.tsx`))
    if (!filePath.startsWith(artifactsBase + sep)) {
      logger.warn('app', 'reveal-artifact-file: path traversal rejected', {
        chatId,
        artifactId
      })
      return { ok: false as const, reason: 'invalid-path' }
    }
    if (existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return { ok: true as const, filePath }
    }

    logger.warn('app', 'reveal-artifact-file: file missing', {
      chatId,
      artifactId,
      filePath
    })
    return { ok: false as const, reason: 'not-found' }
  })

  safeHandle('set-login-item', (_, enable: unknown) => {
    app.setLoginItemSettings({ openAtLogin: enable as boolean })
  })

  safeHandle('set-menu-bar', (_, enable: unknown) => {
    if (enable) {
      setTray()
    } else {
      destroyTray()
    }
  })

  safeHandle('updater-get-state', () => updaterGetState())

  safeHandle('updater-check', () => updaterCheck())

  safeHandle('updater-download', () => updaterDownload())

  safeHandle('updater-install', () => updaterInstall())

  safeHandle('updater-set-auto-download', (_, enable: unknown) =>
    updaterSetAutoDownload(enable as boolean)
  )
}
