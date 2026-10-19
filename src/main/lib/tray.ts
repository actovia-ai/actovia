import { Menu, Tray } from 'electron'

import { mainT } from './i18n'
import { logger } from './logger'
import { getResourcePath } from './paths'
import {
  getMainWindow,
  getQuickChatView,
  registerQuickChat,
  setQuickChatView
} from './window'

let tray: Tray | null = null

/** Open quick-chat if closed; otherwise hide+destroy it. Mirrors the
 *  `close-quick-chat` IPC handler so left-click on the tray icon flips
 *  the quick-chat window like a switch. */
function toggleQuickChat() {
  const view = getQuickChatView()
  if (!view) {
    registerQuickChat()
    return
  }
  try {
    view.hide()
    view.destroy()
  } catch (err) {
    logger.warn('app', 'Failed to close quick-chat from tray', {
      error: err
    })
  }
  setQuickChatView(null)
}

/** Show + focus the main window, or hide it if it's already visible. A
 *  minimized window counts as "not visible" for UX intent — the user
 *  hitting "Show App" expects to actually see the window. */
function toggleMainWindow() {
  const win = getMainWindow()
  if (!win) return
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildContextMenu(): Menu {
  const win = getMainWindow()
  const visible = !!win && win.isVisible() && !win.isMinimized()
  return Menu.buildFromTemplate([
    {
      label: visible
        ? mainT('menu:tray.hideApp', 'Hide App')
        : mainT('menu:tray.showApp', 'Show App'),
      click: toggleMainWindow,
      enabled: !!win
    },
    { type: 'separator' },
    { role: 'quit', label: mainT('menu:tray.quitExodus', 'Quit Actovia') }
  ])
}

export function setTray() {
  if (tray) return
  try {
    // Tray needs a raster image — nativeImage.createFromPath rejects SVGs
    // on macOS. Electron picks up @2x/@3x by filename next to the 1x base,
    // and the `Template` suffix lets macOS tint it for the menu bar. The
    // PNGs come from `bun run icons` (brand/peekaboo.mjs).
    tray = new Tray(getResourcePath('trayTemplate.png'))
    tray.addListener('click', toggleQuickChat)
    // Rebuild on each right-click so the Show/Hide label tracks current
    // window visibility — Electron caches a Menu set via setContextMenu,
    // so popUpContextMenu(buildContextMenu()) is the dynamic-label path.
    tray.addListener('right-click', () => {
      tray?.popUpContextMenu(buildContextMenu())
    })
  } catch (err) {
    logger.error('app', 'Failed to create tray icon', {
      error: err
    })
  }
}

export function getTray(): Tray | null {
  return tray
}

export function destroyTray() {
  if (tray) {
    try {
      tray.destroy()
    } catch (err) {
      logger.warn('app', 'Failed to destroy tray icon', {
        error: err
      })
    }
    tray = null
  }
}
