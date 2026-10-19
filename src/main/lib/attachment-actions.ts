import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'

import { BASE_URL } from '@exodus/shared/constants/systems'
import {
  ATTACHMENT_CHANNELS,
  type AttachmentFailure,
  type AttachmentKind,
  type AttachmentRequest,
  type AttachmentResult
} from '@exodus/shared/types/attachment-actions'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  nativeImage,
  net
} from 'electron'

import { mainT } from './i18n'
import { logger } from './logger'
import { mediaContentType, resolveMediaFile } from './media/store'

/**
 * Save / Copy for an attachment in the chat (see `ATTACHMENT_CHANNELS`).
 *
 * The page only says which attachment: its URL — a `data:` URL, Actovia's own
 * media route, or an `https:` image — and its name. Main never writes where
 * the page says: the path always comes from the native save dialog the user
 * answered. A media URL is read off disk through `resolveMediaFile` (the same
 * check as the route); anything else on loopback is refused, so the channel
 * cannot be used to read the local API.
 */

/** Generous for a photo or a PDF; keeps a hostile URL from filling memory. */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024
// The base64 of the above, plus a header.
const MAX_URL_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024

const MEDIA_PREFIX = `${BASE_URL}/api/v1/media/`

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt'
}

class AttachmentError extends Error {
  constructor(readonly reason: AttachmentFailure) {
    super(reason)
  }
}

/** The request as sent, or null when it is not one. */
export function parseAttachmentRequest(
  value: unknown
): AttachmentRequest | null {
  if (!value || typeof value !== 'object') return null
  const { url, name, kind } = value as Record<string, unknown>
  if (typeof url !== 'string' || url.length === 0) return null
  if (url.length > MAX_URL_LENGTH) return null
  if (kind !== 'image' && kind !== 'file') return null
  if (name !== undefined && typeof name !== 'string') return null
  if (!/^(data:|https?:)/iu.test(url)) return null
  return { url, kind, name: name || undefined }
}

/**
 * A file name to offer in the dialog: one path segment, no control or
 * reserved characters, never empty, with an extension that matches the bytes
 * when it had none.
 */
export function suggestedFileName(
  name: string | undefined,
  mime: string | undefined,
  kind: AttachmentKind
): string {
  const ext = mime ? EXT_BY_MIME[mime.toLowerCase()] : undefined
  const cleaned = basename(
    (name ?? '')
      .replaceAll(/[\\/]/gu, '-')
      // oxlint-disable-next-line no-control-regex -- stripping them is the point
      .replaceAll(/[\u0000-\u001F\u007F<>:"|?*]/gu, '')
      .trim()
  )
    .replace(/^\.+/u, '')
    .slice(0, 120)
    .trim()
  const stem = cleaned || (kind === 'image' ? 'image' : 'attachment')
  if (/\.[A-Za-z0-9]{1,5}$/u.test(stem) || !ext) return stem
  return `${stem}.${ext}`
}

/** The last path segment of a URL, for a name when none was given. */
function nameFromUrl(url: string): string | undefined {
  if (/^data:/iu.test(url)) return undefined
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1)
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

function isLoopback(host: string): boolean {
  const h = host.replaceAll(/^\[|\]$/gu, '').toLowerCase()
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.startsWith('127.')
  )
}

export interface LoadedAttachment {
  bytes: Buffer
  mime?: string
}

type Fetch = (url: string) => Promise<Response>

/** The attachment's bytes, from wherever its URL says they are. */
export async function loadAttachment(
  url: string,
  fetchImpl: Fetch = (u) => net.fetch(u)
): Promise<LoadedAttachment> {
  if (/^data:/iu.test(url)) {
    const data = /^data:([^;,]*)(?:;[^;,]*)*?;base64,(.*)$/isu.exec(url)
    if (!data) throw new AttachmentError('invalid-request')
    const bytes = Buffer.from(data[2], 'base64')
    if (bytes.length === 0) throw new AttachmentError('unavailable')
    return { bytes, mime: data[1] || undefined }
  }

  if (url.startsWith(MEDIA_PREFIX)) {
    const [chatId, file, ...rest] = url
      .slice(MEDIA_PREFIX.length)
      .split(/[?#]/u)[0]
      .split('/')
      .map((s) => {
        try {
          return decodeURIComponent(s)
        } catch {
          return ''
        }
      })
    const path =
      rest.length === 0 && chatId && file
        ? resolveMediaFile(chatId, file)
        : null
    if (!path) throw new AttachmentError('invalid-request')
    const bytes = await readFile(path).catch(() => {
      throw new AttachmentError('unavailable')
    })
    return { bytes, mime: mediaContentType(path) }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AttachmentError('invalid-request')
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    isLoopback(parsed.hostname)
  ) {
    throw new AttachmentError('invalid-request')
  }
  const response = await fetchImpl(parsed.href).catch(() => {
    throw new AttachmentError('unavailable')
  })
  if (!response.ok) throw new AttachmentError('unavailable')
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_ATTACHMENT_BYTES) throw new AttachmentError('too-large')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    throw new AttachmentError('too-large')
  if (bytes.length === 0) throw new AttachmentError('unavailable')
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim()
  return { bytes, mime: mime || undefined }
}

function failure(error: unknown, action: 'save' | 'copy'): AttachmentResult {
  if (error instanceof AttachmentError) {
    return { status: 'failed', reason: error.reason, action }
  }
  logger.error('app', 'Attachment action failed', { action, error })
  return { status: 'failed', reason: 'write-failed', action }
}

export interface AttachmentDeps {
  load: (url: string) => Promise<LoadedAttachment>
  showSaveDialog: (
    window: BrowserWindow | null,
    defaultPath: string
  ) => Promise<{ canceled: boolean; filePath?: string }>
  writeFile: (path: string, bytes: Buffer) => Promise<void>
  writeImage: (bytes: Buffer) => Promise<boolean>
  downloadsDir: () => string
}

const electronDeps: AttachmentDeps = {
  load: (url) => loadAttachment(url),
  showSaveDialog: (window, defaultPath) =>
    window
      ? dialog.showSaveDialog(window, { defaultPath })
      : dialog.showSaveDialog({ defaultPath }),
  writeFile: (path, bytes) => writeFile(path, bytes),
  writeImage: async (bytes) => {
    // Whatever the format (JPEG, WebP…), the clipboard gets a PNG: what every
    // app pastes. An image Chromium cannot decode is empty here.
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return false
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  },
  downloadsDir: () => app.getPath('downloads')
}

/** Ask where, then write there. Nothing is written without the dialog. */
export async function saveAttachment(
  request: AttachmentRequest,
  window: BrowserWindow | null,
  deps: AttachmentDeps = electronDeps
): Promise<AttachmentResult> {
  try {
    const { bytes, mime } = await deps.load(request.url)
    const name = suggestedFileName(
      request.name ?? nameFromUrl(request.url),
      mime,
      request.kind
    )
    const choice = await deps.showSaveDialog(
      window,
      join(deps.downloadsDir(), name)
    )
    if (choice.canceled || !choice.filePath) return { status: 'cancelled' }
    await deps.writeFile(choice.filePath, bytes).catch((error: unknown) => {
      logger.warn('app', 'Could not write a saved attachment', { error })
      throw new AttachmentError('write-failed')
    })
    return { status: 'saved', name: basename(choice.filePath) }
  } catch (error) {
    return failure(error, 'save')
  }
}

/** The image onto the system clipboard, as an image (not a file or a URL). */
export async function copyAttachmentImage(
  request: AttachmentRequest,
  deps: AttachmentDeps = electronDeps
): Promise<AttachmentResult> {
  if (request.kind !== 'image') {
    return { status: 'failed', reason: 'invalid-request', action: 'copy' }
  }
  try {
    const { bytes } = await deps.load(request.url)
    if (!(await deps.writeImage(bytes))) {
      return { status: 'failed', reason: 'unsupported-image', action: 'copy' }
    }
    return { status: 'copied' }
  } catch (error) {
    return failure(error, 'copy')
  }
}

/** The right-click menu's items for an attachment of this kind. */
export function attachmentMenuItems(
  kind: AttachmentKind
): Array<{ action: 'save' | 'copy'; label: string }> {
  return kind === 'image'
    ? [
        {
          action: 'save',
          label: mainT('menu:attachment.saveImageAs', 'Save Image As…')
        },
        {
          action: 'copy',
          label: mainT('menu:attachment.copyImage', 'Copy Image')
        }
      ]
    : [{ action: 'save', label: mainT('menu:attachment.saveAs', 'Save As…') }]
}

/**
 * The native context menu. Resolves with what the chosen item did, or
 * `cancelled` when the menu closed without a choice.
 */
function popupAttachmentMenu(
  request: AttachmentRequest,
  window: BrowserWindow | null
): Promise<AttachmentResult> {
  return new Promise((resolveResult) => {
    let chosen = false
    const menu = Menu.buildFromTemplate(
      attachmentMenuItems(request.kind).map(({ action, label }) => ({
        label,
        click: () => {
          chosen = true
          const run =
            action === 'save'
              ? saveAttachment(request, window)
              : copyAttachmentImage(request)
          void run.then(resolveResult)
        }
      }))
    )
    menu.popup({
      ...(window ? { window } : {}),
      // An item's click can arrive just after the menu reports it closed.
      callback: () =>
        setTimeout(() => {
          if (!chosen) resolveResult({ status: 'cancelled' })
        }, 250)
    })
  })
}

/** Only a window's own top frame — never a frame it embeds. */
function fromTopFrame(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame === event.sender.mainFrame
}

function handle(
  channel: string,
  run: (
    request: AttachmentRequest,
    window: BrowserWindow | null
  ) => Promise<AttachmentResult>
) {
  ipcMain.handle(channel, (event, payload: unknown) => {
    if (!fromTopFrame(event)) {
      logger.warn('app', 'Refused an attachment action from an embedded frame')
      return { status: 'failed', reason: 'invalid-request' }
    }
    const request = parseAttachmentRequest(payload)
    if (!request) return { status: 'failed', reason: 'invalid-request' }
    return run(request, BrowserWindow.fromWebContents(event.sender))
  })
}

export function setupAttachmentIPC(): void {
  handle(ATTACHMENT_CHANNELS.save, (request, window) =>
    saveAttachment(request, window)
  )
  handle(ATTACHMENT_CHANNELS.copyImage, (request) =>
    copyAttachmentImage(request)
  )
  handle(ATTACHMENT_CHANNELS.contextMenu, popupAttachmentMenu)
}
