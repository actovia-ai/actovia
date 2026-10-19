import { app, session, shell } from 'electron'

import { logger } from './logger'

/**
 * Renderer-facing hardening, per Electron's security checklist. The renderer
 * shows model output — markdown links, generated artifacts, embedded
 * third-party frames — so what a page may open, navigate to, or be granted is
 * decided here in the main process, never left to the content.
 */

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Only web and mail links go to the OS. `shell.openExternal` will otherwise
 * launch whatever handles the scheme — `file:` opens (runs) a local file,
 * `smb:` mounts a share, and app-specific schemes have been a repeated RCE
 * vector — and the URL can come from a link the model was talked into writing.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function openExternalSafely(url: string): void {
  if (!isSafeExternalUrl(url)) {
    logger.warn('app', 'Refused to open a non-web URL externally', {
      // The scheme is the whole story; the rest may be long or sensitive.
      protocol: url.slice(0, url.indexOf(':') + 1).slice(0, 32)
    })
    return
  }
  shell.openExternal(url).catch((error) => {
    logger.warn('app', 'Failed to open external URL', { error })
  })
}

/**
 * Whether `target` is the page a window already shows (a reload, Vite's
 * full-reload) rather than somewhere else. The app is a hash-routed SPA per
 * window, so its path never legitimately changes: same origin in dev, the
 * same file when packaged.
 */
export function isInAppNavigation(current: string, target: string): boolean {
  try {
    const from = new URL(current)
    const to = new URL(target)
    if (from.protocol !== to.protocol) return false
    if (to.protocol === 'file:') return from.pathname === to.pathname
    return from.origin === to.origin
  } catch {
    return false
  }
}

/**
 * Whether a permission request comes from Actovia's own pages (the microphone
 * for voice input, the clipboard) rather than from a frame it embeds —
 * CodeSandbox, TradingView, diagrams.net. Electron grants every request by
 * default, third-party frames included.
 */
export function isAppUrl(
  url: string | undefined,
  devServerUrl: string | undefined
): boolean {
  if (!url) return false
  try {
    const { protocol, origin } = new URL(url)
    if (protocol === 'file:') return true
    return devServerUrl !== undefined && origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

export function hardenRenderers(devServerUrl: string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    // A plain link click (no target=_blank) would otherwise replace the app
    // with the remote page — inside a window whose preload exposes IPC.
    contents.on('will-navigate', (event, url) => {
      if (isInAppNavigation(contents.getURL(), url)) return
      event.preventDefault()
      openExternalSafely(url)
    })

    // Every window, sub-apps included: nothing in Actovia opens a child
    // BrowserWindow from the renderer, so a new window is always a link.
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const requester = details.requestingUrl || contents?.getURL()
      const granted = isAppUrl(requester, devServerUrl)
      if (!granted) {
        logger.warn(
          'app',
          'Denied a permission request from embedded content',
          {
            permission,
            requester
          }
        )
      }
      callback(granted)
    }
  )
}
