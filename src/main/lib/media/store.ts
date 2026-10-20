import { randomUUID } from 'crypto'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

import { logger } from '../logger'
import { getMediaDir } from '../paths'

/**
 * Generated media on disk: `~/.actovia/media/<chatId>/<uuid>.<ext>` for a chat,
 * `~/.actovia/media/_groups/<conversationId>/…` for a Philharmonic Group. A
 * file is written once and never changed, so the route can cache it forever.
 */

export type MediaExt = 'png' | 'jpg' | 'webp'

const MIME_BY_EXT: Record<MediaExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
}

const EXT_BY_MIME: Record<string, MediaExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CHAT_ID_RE = new RegExp(`^${UUID}$`)
const MEDIA_FILE_RE = new RegExp(`^${UUID}\\.(png|jpg|webp)$`)
// A Group's conversation id: one path segment of safe characters.
const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** Whose media: a chat's (a lowercase uuid) or a Philharmonic Group's. */
export type MediaTarget = { chatId: string } | { groupId: string }

/**
 * The directory a target's media lives in — the one way to name it, for
 * writing and for removing alike. The id comes from a client (the chat
 * request body, a route param), so it is checked here rather than trusted:
 * a chat id must be a lowercase uuid, a Group's one safe path segment, and
 * the resolved path must still sit strictly inside the media dir. Anything
 * else throws, before any directory is created or removed.
 */
export function mediaDirFor(target: MediaTarget): string {
  const base = resolve(getMediaDir())
  const [valid, dir] =
    'chatId' in target
      ? [CHAT_ID_RE.test(target.chatId), resolve(base, target.chatId)]
      : [
          GROUP_ID_RE.test(target.groupId),
          resolve(base, '_groups', target.groupId)
        ]
  if (!valid || !dir.startsWith(base + sep)) {
    throw new Error(`Invalid media target: ${JSON.stringify(target)}`)
  }
  return dir
}

export interface SniffedImage {
  ext: MediaExt
  mimeType: string
  width?: number
  height?: number
}

export interface SavedMedia {
  /** The file name, `<uuid>.<ext>` — the last segment of the media route. */
  mediaId: string
  mimeType: string
  width?: number
  height?: number
}

function typeOfBytes(b: Buffer): MediaExt | null {
  if (
    b.length >= 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'jpg'
  }
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

function pngSize(b: Buffer) {
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return {}
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

function jpegSize(b: Buffer) {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return {}
    const marker = b[i + 1]
    // SOF0–SOF15, less DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return {}
}

function webpSize(b: Buffer) {
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff
    }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return {}
}

/**
 * What the bytes are — the magic bytes win; the content type is the fallback
 * — and, when the header says, how big. `null` for anything that is not a
 * png, jpeg or webp.
 */
export function sniffImage(
  bytes: Buffer,
  contentType?: string | null
): SniffedImage | null {
  const fromBytes = typeOfBytes(bytes)
  const ext =
    fromBytes ??
    EXT_BY_MIME[(contentType ?? '').split(';')[0].trim().toLowerCase()]
  if (!ext) return null
  const size = !fromBytes
    ? {}
    : ext === 'png'
      ? pngSize(bytes)
      : ext === 'jpg'
        ? jpegSize(bytes)
        : webpSize(bytes)
  return { ext, mimeType: MIME_BY_EXT[ext], ...size }
}

/** Writes the bytes as `<uuid>.<ext>` in the target's dir (created if missing). */
export async function saveMedia(
  target: MediaTarget,
  bytes: Buffer,
  contentType?: string | null
): Promise<SavedMedia> {
  const dir = mediaDirFor(target)
  const sniffed = sniffImage(bytes, contentType)
  if (!sniffed) throw new Error('The image is not a png, jpeg or webp')
  const mediaId = `${randomUUID()}.${sniffed.ext}`
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, mediaId), bytes, { flag: 'wx' })
  const { ext: _ext, ...rest } = sniffed
  return { mediaId, ...rest }
}

/**
 * The file a `GET /api/v1/media/:chatId/:file` may serve, or `null`. Both
 * segments must be exactly what `saveMedia` writes (a lowercase uuid chat id;
 * `<uuid>.png|jpg|webp`), and the resolved path must still sit inside the
 * media dir — belt and braces, since the patterns already exclude `/` and `.`.
 */
export function resolveMediaFile(chatId: string, file: string): string | null {
  if (!CHAT_ID_RE.test(chatId) || !MEDIA_FILE_RE.test(file)) return null
  const base = resolve(getMediaDir())
  const path = resolve(base, chatId, file)
  if (!path.startsWith(base + sep)) return null
  return path
}

export function mediaContentType(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1) as MediaExt
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

async function removeDir(dir: () => string, what: Record<string, string>) {
  try {
    await rm(dir(), { recursive: true, force: true })
  } catch (error) {
    logger.error('media', 'Failed to remove generated media', {
      ...what,
      error
    })
  }
}

/** Best-effort: a deleted chat's media goes with it; a failure is logged. */
export async function removeChatMedia(chatId: string): Promise<void> {
  // A malformed id never named a media dir: nothing to remove, nothing to log.
  if (!CHAT_ID_RE.test(chatId)) return
  await removeDir(() => mediaDirFor({ chatId }), { chatId })
}

/** Best-effort: a deleted Group's media goes with it; a failure is logged. */
export async function removeGroupMedia(conversationId: string): Promise<void> {
  if (!GROUP_ID_RE.test(conversationId)) return
  await removeDir(() => mediaDirFor({ groupId: conversationId }), {
    conversationId
  })
}

/** "Reset all data": every chat's and every Group's media. */
export async function removeAllMedia(): Promise<void> {
  await removeDir(getMediaDir, { scope: 'all' })
}
