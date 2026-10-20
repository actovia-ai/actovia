// src/main/lib/media/store.ts — generated media on disk under
// ~/.actovia/media/<chatId>/<uuid>.<ext>. Every test runs against a scratch
// ACTOVIA_HOME of its own, never the real data dir.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const logError = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: logError, debug: vi.fn() }
}))

const home = mkdtempSync(join(tmpdir(), 'actovia-media-'))
const originalActoviaHome = process.env.ACTOVIA_HOME
process.env.ACTOVIA_HOME = home
afterAll(() => {
  process.env.ACTOVIA_HOME = originalActoviaHome
})

const store = await import('@main/lib/media/store')
const paths = await import('@main/lib/paths')

const CHAT = '11111111-1111-4111-8111-111111111111'
const MEDIA = '22222222-2222-4222-8222-222222222222'

/** A 3×2 PNG header — enough for the sniffer and the IHDR size. */
function png(width = 3, height = 2): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

function jpeg(width = 5, height = 4): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    // SOF0: length 17, precision 8, height, width
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03
  ])
}

function webpVp8x(width = 640, height = 480): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(22, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8X', 12, 'ascii')
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}

beforeEach(() => logError.mockReset())

/** Every file under `dir`, relative, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()
}

const chatDir = (id: string) => join(home, 'media', id)

// Ids a client (a local process, a paired device) could send that must never
// name a directory: traversal, a separator, empty, encoded, the groups dir.
const BAD_CHAT_IDS = [
  '../x',
  '../../x',
  '..',
  '.',
  'a/b',
  '',
  '..%2Fx',
  '%2e%2e',
  '_groups',
  `${CHAT}/../..`,
  'AAAAAAAA-1111-4111-8111-111111111111'
]
const BAD_GROUP_IDS = ['../x', '..', '.', 'a/b', '', '..%2Fx', 'a\\b', '/etc']

describe('mediaDirFor', () => {
  it('puts media under <home>/media, one dir per chat, groups apart', () => {
    expect(paths.getMediaDir()).toBe(join(home, 'media'))
    expect(store.mediaDirFor({ chatId: CHAT })).toBe(join(home, 'media', CHAT))
    expect(store.mediaDirFor({ groupId: 'g1' })).toBe(
      join(home, 'media', '_groups', 'g1')
    )
  })

  it.each(BAD_CHAT_IDS)('refuses the chat id %j', (chatId) => {
    expect(() => store.mediaDirFor({ chatId })).toThrow(/invalid media target/i)
  })

  it.each(BAD_GROUP_IDS)('refuses the group id %j', (groupId) => {
    expect(() => store.mediaDirFor({ groupId })).toThrow(
      /invalid media target/i
    )
  })

  it('leaves no unguarded way to name a media dir in paths', () => {
    expect(paths).not.toHaveProperty('getChatMediaDir')
    expect(paths).not.toHaveProperty('getGroupMediaDir')
  })
})

describe('sniffImage', () => {
  it('reads the type and the size from the bytes', () => {
    expect(store.sniffImage(png(3, 2))).toEqual({
      ext: 'png',
      mimeType: 'image/png',
      width: 3,
      height: 2
    })
    expect(store.sniffImage(jpeg(5, 4))).toEqual({
      ext: 'jpg',
      mimeType: 'image/jpeg',
      width: 5,
      height: 4
    })
    expect(store.sniffImage(webpVp8x(640, 480))).toEqual({
      ext: 'webp',
      mimeType: 'image/webp',
      width: 640,
      height: 480
    })
  })

  it('falls back to the content type when the bytes are not recognised', () => {
    expect(store.sniffImage(Buffer.from('????'), 'image/webp; q=1')).toEqual({
      ext: 'webp',
      mimeType: 'image/webp'
    })
    expect(store.sniffImage(Buffer.from('<html>'), 'text/html')).toBeNull()
    expect(store.sniffImage(Buffer.from('<html>'))).toBeNull()
  })
})

describe('saveMedia', () => {
  it('writes <uuid>.<ext> into the dir and returns its id, type and size', async () => {
    const dir = chatDir(CHAT)
    const saved = await store.saveMedia({ chatId: CHAT }, png(3, 2))

    expect(saved.mediaId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/
    )
    expect(saved).toMatchObject({ mimeType: 'image/png', width: 3, height: 2 })
    expect(readFileSync(join(dir, saved.mediaId))).toEqual(png(3, 2))
  })

  it('refuses bytes that are not a png, jpeg or webp', async () => {
    await expect(
      store.saveMedia({ chatId: CHAT }, Buffer.from('<html>'))
    ).rejects.toThrow(/not a png, jpeg or webp/i)
  })

  it.each(BAD_CHAT_IDS)(
    'writes nothing anywhere for the chat id %j',
    async (chatId) => {
      const before = filesUnder(home)
      await expect(store.saveMedia({ chatId }, png())).rejects.toThrow(
        /invalid media target/i
      )
      expect(filesUnder(home)).toEqual(before)
    }
  )

  it.each(BAD_GROUP_IDS)(
    'writes nothing anywhere for the group id %j',
    async (groupId) => {
      const before = filesUnder(home)
      await expect(store.saveMedia({ groupId }, png())).rejects.toThrow(
        /invalid media target/i
      )
      expect(filesUnder(home)).toEqual(before)
    }
  )
})

describe('resolveMediaFile', () => {
  it('resolves a well-formed chat id + file inside the media dir', () => {
    expect(store.resolveMediaFile(CHAT, `${MEDIA}.png`)).toBe(
      join(home, 'media', CHAT, `${MEDIA}.png`)
    )
    // Postgres prints uuids in lowercase; nothing else is a chat id.
    expect(
      store.resolveMediaFile(
        'AAAAAAAA-1111-4111-8111-111111111111',
        `${MEDIA}.webp`
      )
    ).toBeNull()
  })

  it.each([
    ['a traversal chat id', '..', `${MEDIA}.png`],
    ['an encoded traversal', '..%2F..', `${MEDIA}.png`],
    ['the groups dir', '_groups', `${MEDIA}.png`],
    ['a non-uuid chat id', 'abc', `${MEDIA}.png`],
    ['a traversal file', CHAT, '../../lock.dat'],
    ['a bare uuid', CHAT, MEDIA],
    ['an unknown extension', CHAT, `${MEDIA}.svg`],
    ['a double extension', CHAT, `${MEDIA}.png.html`],
    ['an absolute path', CHAT, '/etc/passwd'],
    ['a trailing slash', CHAT, `${MEDIA}.png/`]
  ])('refuses %s', (_label, chatId, file) => {
    expect(store.resolveMediaFile(chatId, file)).toBeNull()
  })

  it('maps the extension to its content type', () => {
    expect(store.mediaContentType(`${MEDIA}.png`)).toBe('image/png')
    expect(store.mediaContentType(`${MEDIA}.jpg`)).toBe('image/jpeg')
    expect(store.mediaContentType(`${MEDIA}.webp`)).toBe('image/webp')
  })
})

describe('removal', () => {
  it('removes one chat’s dir and leaves the others', async () => {
    const other = '33333333-3333-4333-8333-333333333333'
    mkdirSync(chatDir(CHAT), { recursive: true })
    mkdirSync(chatDir(other), { recursive: true })
    writeFileSync(join(chatDir(CHAT), 'x.png'), 'x')

    await store.removeChatMedia(CHAT)

    expect(existsSync(chatDir(CHAT))).toBe(false)
    expect(existsSync(chatDir(other))).toBe(true)
  })

  it('is a quiet no-op for a chat that never had media', async () => {
    await store.removeChatMedia('44444444-4444-4444-8444-444444444444')
    expect(logError).not.toHaveBeenCalled()
  })

  it('never removes anything for an id that is not a uuid', async () => {
    mkdirSync(paths.getMediaDir(), { recursive: true })
    await store.removeChatMedia('..')
    expect(existsSync(paths.getMediaDir())).toBe(true)
    expect(existsSync(home)).toBe(true)
  })

  it('never removes anything for a traversal id, chat or group', async () => {
    // A sibling of the media dir a traversal would reach.
    const outside = join(home, 'x')
    mkdirSync(join(outside, 'keep'), { recursive: true })
    mkdirSync(join(home, 'media', '_groups'), { recursive: true })
    for (const id of BAD_CHAT_IDS) await store.removeChatMedia(id)
    for (const id of BAD_GROUP_IDS) await store.removeGroupMedia(id)
    expect(existsSync(join(outside, 'keep'))).toBe(true)
    expect(existsSync(join(home, 'media', '_groups'))).toBe(true)
    expect(logError).not.toHaveBeenCalled()
  })

  it('removes a group’s dir', async () => {
    mkdirSync(join(home, 'media', '_groups', 'g1'), { recursive: true })
    await store.removeGroupMedia('g1')
    expect(existsSync(join(home, 'media', '_groups', 'g1'))).toBe(false)
  })

  it('removes the whole media dir on reset', async () => {
    mkdirSync(chatDir(CHAT), { recursive: true })
    await store.removeAllMedia()
    expect(existsSync(paths.getMediaDir())).toBe(false)
    expect(existsSync(home)).toBe(true)
  })
})
