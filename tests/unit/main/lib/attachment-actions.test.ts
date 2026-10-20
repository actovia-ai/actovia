// Save / Copy for a chat attachment (attachment-actions.ts): the page names
// the attachment, main reads it from where its URL says, and writes only to
// the path the native save dialog returned.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { BASE_URL } from '@actovia/shared/constants/systems'
import { ATTACHMENT_CHANNELS } from '@actovia/shared/types/attachment-actions'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/me/Downloads', isPackaged: false },
  BrowserWindow: { fromWebContents: () => null },
  clipboard: { write: vi.fn() },
  ClipboardItem: class {},
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  net: { fetch: vi.fn() }
}))
vi.mock('@main/lib/i18n', () => ({
  mainT: (_key: string, fallback: string) => fallback
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const {
  attachmentMenuItems,
  copyAttachmentImage,
  loadAttachment,
  MAX_ATTACHMENT_BYTES,
  parseAttachmentRequest,
  saveAttachment,
  setupAttachmentIPC,
  suggestedFileName
} = await import('@main/lib/attachment-actions')
const { getMediaDir } = await import('@main/lib/paths')

const PNG_URL = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`

function deps(overrides: Record<string, unknown> = {}) {
  return {
    load: vi.fn(async () => ({
      bytes: Buffer.from('png-bytes'),
      mime: 'image/png'
    })),
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: '/Users/me/Desktop/cat.png'
    })),
    writeFile: vi.fn(async () => {}),
    writeImage: vi.fn(async () => true),
    downloadsDir: () => '/Users/me/Downloads',
    ...overrides
  }
}

describe('parseAttachmentRequest', () => {
  it('takes a data:, https: or http: URL with a kind', () => {
    expect(parseAttachmentRequest({ url: PNG_URL, kind: 'image' })).toEqual({
      url: PNG_URL,
      kind: 'image',
      name: undefined
    })
    expect(
      parseAttachmentRequest({
        url: 'https://example.com/a.pdf',
        kind: 'file',
        name: 'a.pdf'
      })
    ).toMatchObject({ name: 'a.pdf' })
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      'https://example.com/a.png',
      { url: 'file:///etc/passwd', kind: 'file' },
      { url: 'javascript:alert(1)', kind: 'image' },
      { url: PNG_URL, kind: 'video' },
      { url: PNG_URL, kind: 'image', name: 42 },
      { url: '', kind: 'image' }
    ]) {
      expect(parseAttachmentRequest(bad)).toBeNull()
    }
  })
})

describe('suggestedFileName', () => {
  it('keeps an original name as it is', () => {
    expect(suggestedFileName('Report Q3.pdf', 'application/pdf', 'file')).toBe(
      'Report Q3.pdf'
    )
  })

  it('adds the extension the bytes call for', () => {
    expect(suggestedFileName('A red fox', 'image/jpeg', 'image')).toBe(
      'A red fox.jpg'
    )
    expect(suggestedFileName(undefined, 'image/png', 'image')).toBe('image.png')
  })

  it('never names a path or a hidden file', () => {
    expect(suggestedFileName('../../.ssh/id_rsa', undefined, 'file')).toBe(
      '-..-.ssh-id_rsa'
    )
    expect(suggestedFileName('...', undefined, 'file')).toBe('attachment')
    expect(suggestedFileName('a\u0000b:c?.png', 'image/png', 'image')).toBe(
      'abc.png'
    )
  })
})

describe('loadAttachment', () => {
  it('decodes a data: URL', async () => {
    const { bytes, mime } = await loadAttachment(PNG_URL)
    expect(bytes.toString()).toBe('png-bytes')
    expect(mime).toBe('image/png')
  })

  it("reads Actovia's own media off disk, never over HTTP", async () => {
    const chatId = '11111111-1111-4111-8111-111111111111'
    const file = '22222222-2222-4222-8222-222222222222.webp'
    mkdirSync(join(getMediaDir(), chatId), { recursive: true })
    writeFileSync(join(getMediaDir(), chatId, file), 'webp-bytes')
    const fetchImpl = vi.fn()

    const loaded = await loadAttachment(
      `${BASE_URL}/api/v1/media/${chatId}/${file}`,
      fetchImpl
    )
    expect(loaded.bytes.toString()).toBe('webp-bytes')
    expect(loaded.mime).toBe('image/webp')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a media path that leaves the media dir, and the rest of loopback', async () => {
    const fetchImpl = vi.fn()
    for (const url of [
      `${BASE_URL}/api/v1/media/..%2F..%2Fsecrets/x.png`,
      `${BASE_URL}/api/v1/settings`,
      'http://127.0.0.1:60223/api/v1/media/x/y.png',
      'http://[::1]/a.png'
    ]) {
      await expect(loadAttachment(url, fetchImpl)).rejects.toMatchObject({
        reason: 'invalid-request'
      })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches a remote image, and refuses one too large', async () => {
    const ok = await loadAttachment(
      'https://imgs.example/a',
      async () =>
        new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } })
    )
    expect(ok.mime).toBe('image/jpeg')

    await expect(
      loadAttachment(
        'https://imgs.example/b',
        async () =>
          new Response('x', {
            headers: { 'content-length': String(MAX_ATTACHMENT_BYTES + 1) }
          })
      )
    ).rejects.toMatchObject({ reason: 'too-large' })
    await expect(
      loadAttachment(
        'https://imgs.example/c',
        async () => new Response('gone', { status: 404 })
      )
    ).rejects.toMatchObject({ reason: 'unavailable' })
  })
})

describe('saveAttachment', () => {
  it('offers the original name in Downloads, and writes where the user chose', async () => {
    const d = deps()
    const result = await saveAttachment(
      { url: PNG_URL, name: 'cat', kind: 'image' },
      null,
      d
    )
    expect(d.showSaveDialog).toHaveBeenCalledWith(
      null,
      join('/Users/me/Downloads', 'cat.png')
    )
    expect(d.writeFile).toHaveBeenCalledWith(
      '/Users/me/Desktop/cat.png',
      Buffer.from('png-bytes')
    )
    expect(result).toEqual({ status: 'saved', name: 'cat.png' })
  })

  it('names it from the URL when it has no name', async () => {
    const d = deps()
    await saveAttachment(
      { url: 'https://example.com/files/paper.pdf?x=1', kind: 'file' },
      null,
      d
    )
    expect(d.showSaveDialog).toHaveBeenCalledWith(
      null,
      join('/Users/me/Downloads', 'paper.pdf')
    )
  })

  it('writes nothing when the dialog is cancelled', async () => {
    const d = deps({
      showSaveDialog: vi.fn(async () => ({ canceled: true }))
    })
    expect(
      await saveAttachment({ url: PNG_URL, kind: 'image' }, null, d)
    ).toEqual({ status: 'cancelled' })
    expect(d.writeFile).not.toHaveBeenCalled()
  })

  it('says it failed when the bytes cannot be had', async () => {
    const d = deps({
      load: vi.fn(() => loadAttachment('file:///etc/passwd'))
    })
    expect(
      await saveAttachment({ url: PNG_URL, kind: 'image' }, null, d)
    ).toEqual({ status: 'failed', reason: 'invalid-request', action: 'save' })
    expect(d.showSaveDialog).not.toHaveBeenCalled()
  })
})

describe('copyAttachmentImage', () => {
  it('puts the image on the clipboard', async () => {
    const d = deps()
    expect(
      await copyAttachmentImage({ url: PNG_URL, kind: 'image' }, d)
    ).toEqual({ status: 'copied' })
    expect(d.writeImage).toHaveBeenCalledWith(Buffer.from('png-bytes'))
  })

  it('says so when the image cannot be decoded, and copies no file', async () => {
    const d = deps({ writeImage: vi.fn(async () => false) })
    expect(
      await copyAttachmentImage({ url: PNG_URL, kind: 'image' }, d)
    ).toEqual({ status: 'failed', reason: 'unsupported-image', action: 'copy' })
    expect(
      await copyAttachmentImage({ url: PNG_URL, kind: 'file' }, d)
    ).toMatchObject({ status: 'failed', action: 'copy' })
  })
})

describe('the context menu', () => {
  it('is Save Image As… and Copy Image for an image, Save As… for a file', () => {
    expect(attachmentMenuItems('image').map((i) => i.label)).toEqual([
      'Save Image As…',
      'Copy Image'
    ])
    expect(attachmentMenuItems('file').map((i) => i.label)).toEqual([
      'Save As…'
    ])
  })
})

describe('the IPC channels', () => {
  beforeAll(() => setupAttachmentIPC())
  const mainFrame = { id: 'top' }
  const sender = { mainFrame }

  it('are all registered', () => {
    for (const channel of Object.values(ATTACHMENT_CHANNELS)) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('refuse an embedded frame and a malformed request', async () => {
    const save = handlers.get(ATTACHMENT_CHANNELS.save) as (
      e: unknown,
      p: unknown
    ) => Promise<unknown>
    expect(
      await save(
        { sender, senderFrame: { id: 'iframe' } },
        { url: PNG_URL, kind: 'image' }
      )
    ).toEqual({ status: 'failed', reason: 'invalid-request' })
    expect(
      await save(
        { sender, senderFrame: mainFrame },
        { url: '/etc/passwd', kind: 'file' }
      )
    ).toEqual({ status: 'failed', reason: 'invalid-request' })
  })
})
