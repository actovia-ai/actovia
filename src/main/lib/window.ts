import { join } from 'path'

import {
  BrowserWindow,
  WebContentsView,
  app,
  autoUpdater,
  screen
} from 'electron'

import { logger } from './logger'
import { getResourcePath } from './paths'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1280,
    minHeight: 820,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    title: '',
    titleBarStyle: 'hidden',
    trafficLightPosition: {
      x: 20,
      y: 16
    },
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const
        }
      : {}),
    ...(process.platform === 'linux'
      ? { icon: getResourcePath('icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Registered once for the window's life (the find bar is opened and closed
  // many times; hooking these per open leaked a listener each time).
  mainWindow.on('resize', placeSearchView)
  mainWindow.webContents.on('found-in-page', (_event, result) => {
    if (searchBarOpen) {
      searchView?.webContents.send('find-in-page-result', result)
    }
  })
  // The bar searches the page it is docked to, and a route change swaps that
  // page's content out from under it (hash routes are in-page navigations), so
  // its query and highlights no longer mean anything.
  mainWindow.webContents.on('did-navigate-in-page', () => closeSearchBar())
  mainWindow.webContents.on('did-navigate', () => closeSearchBar())

  app.on('before-quit', () => {
    isQuitting = true
  })
  // "Restart & Install" (`quitAndInstall()`) closes every window *before*
  // `before-quit`, so the hide-on-close below would keep the main window
  // open and the quit, and with it the update, would never happen.
  autoUpdater.on('before-quit-for-update', () => {
    isQuitting = true
  })

  app.on('activate', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // New-window and navigation handling is installed for every webContents by
  // `hardenRenderers()` (security.ts), not per window.

  // A sandboxed preload (webPreferences.sandbox: true) that throws at load
  // time otherwise fails silently — the renderer just never gets
  // `window.electron`/`window.api`, with no error anywhere. Surface it.
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error('app', 'Preload script failed to load', {
      preloadPath,
      error
    })
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).catch((err) => {
      logger.error('app', 'Failed to load main window URL', {
        error: err
      })
    })
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow
      .loadFile(
        join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
      )
      .catch((err) => {
        logger.error('app', 'Failed to load main window file', {
          error: err
        })
      })
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Bring the main window back in front of the user, wherever it was left. */
export function raiseMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  app.focus({ steal: true })
}

// ── Sub-apps ────────────────────────────────────────────────────────────
// The search bar and quick-chat are separate HTML entries of the one
// renderer build (see vite.renderer.config.mts). Vite's root is the repo
// root, so their pages keep the `src/renderer/sub-apps/<name>/` prefix.

const SUB_APP_DIR = 'src/renderer/sub-apps'

const SUB_APP_WEB_PREFERENCES = {
  preload: join(__dirname, 'preload.cjs'),
  sandbox: true,
  contextIsolation: true
}

function loadSubApp(
  webContents: Electron.WebContents,
  name: 'searchbar' | 'quick-chat'
): void {
  const page = `${SUB_APP_DIR}/${name}/index.html`
  const onError = (err: unknown) =>
    logger.error('app', `Failed to load ${name}`, { error: err })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    webContents
      .loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/${page}`)
      .catch(onError)
  } else {
    webContents
      .loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/${page}`))
      .catch(onError)
  }
}

let searchView: WebContentsView | null = null
let quickChatView: BrowserWindow | null = null

// The find bar is a view of its own, not React inside the main page:
// `webContents.findInPage` searches the page it is called on, so a bar
// rendered there would match its own input and its own match counter.
// The view is a strip just under the 48px header, sized to the bar plus room
// for its shadow; it is created on first use and then only shown/hidden, so
// Cmd+F is instant and no renderer process is left behind per open.
const SEARCH_BAR_WIDTH = 416
const SEARCH_BAR_HEIGHT = 74
const SEARCH_BAR_TOP = 44
const SEARCH_BAR_RIGHT_GAP = 4

let searchBarOpen = false

function placeSearchView(): void {
  if (!searchView || !mainWindow) return
  const [width] = mainWindow.getContentSize()
  searchView.setBounds({
    x: width - SEARCH_BAR_WIDTH - SEARCH_BAR_RIGHT_GAP,
    y: SEARCH_BAR_TOP,
    width: SEARCH_BAR_WIDTH,
    height: SEARCH_BAR_HEIGHT
  })
}

export function openSearchBar(): void {
  const parent = mainWindow
  if (!parent) return

  if (!searchView) {
    searchView = new WebContentsView({
      webPreferences: SUB_APP_WEB_PREFERENCES
    })
    // Without this the view paints an opaque backdrop (a dark rectangle behind
    // the bar in dark mode) — the bar's own rounded surface is the only thing
    // that should show.
    searchView.setBackgroundColor('#00000000')
    parent.contentView.addChildView(searchView)
    loadSubApp(searchView.webContents, 'searchbar')
    // The page focuses its input once it has mounted; this covers the view
    // taking key focus at all.
    searchView.webContents.once('did-finish-load', () => {
      if (searchBarOpen) searchView?.webContents.focus()
    })
  }

  const wasOpen = searchBarOpen
  searchBarOpen = true
  placeSearchView()
  searchView.setVisible(true)
  searchView.webContents.focus()
  // A freshly created page is still loading and focuses itself on mount.
  if (!searchView.webContents.isLoading()) {
    searchView.webContents.send('focus-search-bar', !wasOpen)
  }
}

export function closeSearchBar(): void {
  if (!searchView || !searchBarOpen) return
  searchBarOpen = false
  searchView.setVisible(false)
  mainWindow?.webContents.stopFindInPage('clearSelection')
  // Hiding the focused view leaves the window with no key view: hand focus
  // back to the page so shortcuts keep working without a click.
  mainWindow?.webContents.focus()
}

// Quick chat: room around the pill for its shadow (a window cut tight to the
// pill clips it into hard rectangular edges). The window is transparent, so
// the extra room is invisible.
const QUICK_CHAT_MARGIN = 24
const QUICK_CHAT_WIDTH = 600 + 2 * QUICK_CHAT_MARGIN
const QUICK_CHAT_HEIGHT = 58 + 2 * QUICK_CHAT_MARGIN

export function registerQuickChat(): void {
  if (quickChatView) return

  quickChatView = new BrowserWindow({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    // The pill draws its own shadow inside the transparent margin; the native
    // one would trace the whole window.
    hasShadow: false,
    webPreferences: SUB_APP_WEB_PREFERENCES
  })

  // Open where the user is working: the display under the cursor (the tray
  // icon that summoned this was just clicked), not always the primary one.
  const { x, y, width, height } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea
  quickChatView.setBounds({
    x: Math.round(x + (width - QUICK_CHAT_WIDTH) / 2),
    // The pill (not the window) sits 32% down the screen, as it always did.
    y: Math.round(y + height * 0.32 - QUICK_CHAT_MARGIN),
    width: QUICK_CHAT_WIDTH,
    height: QUICK_CHAT_HEIGHT
  })

  loadSubApp(quickChatView.webContents, 'quick-chat')
}

export function getQuickChatView(): BrowserWindow | null {
  return quickChatView
}

export function setQuickChatView(view: BrowserWindow | null): void {
  quickChatView = view
}
