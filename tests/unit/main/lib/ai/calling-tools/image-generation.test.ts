import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { Settings } from '@main/lib/db/schema'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const generate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    images = { generate }
  }
}))

// The download itself (https only, public addresses only, pinned) is
// safe-fetch's own suite; here it is the seam the tool calls.
const fetchMock = vi.fn()
vi.mock('@main/lib/net/safe-fetch', () => ({ fetchPublicHttps: fetchMock }))

// A scratch data dir of this file's own: the tool writes real files.
const home = mkdtempSync(join(tmpdir(), 'actovia-imagegen-'))
const originalActoviaHome = process.env.ACTOVIA_HOME
process.env.ACTOVIA_HOME = home
afterAll(() => {
  process.env.ACTOVIA_HOME = originalActoviaHome
})

const { imageGeneration } =
  await import('@main/lib/ai/calling-tools/image-generation')

const CHAT = '11111111-1111-4111-8111-111111111111'
const MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/

const settings = {
  providers: { openaiApiKey: 'sk-test' },
  image: { model: 'gpt-image-2', size: '1024x1536' }
} as unknown as Settings

function png(width = 3, height = 2): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const chatDir = join(home, 'media', CHAT)

/** What `fetchPublicHttps` resolves with for a downloaded image. */
const downloaded = (bytes: Buffer | string, contentType: string | null) => ({
  bytes: Buffer.from(bytes),
  contentType
})

/** Every file under `dir`, relative, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()
}

afterEach(() => {
  generate.mockReset()
  fetchMock.mockReset()
})

function textOf(out: { content: Array<{ type: string; text?: string }> }) {
  const block = out.content[0]
  return block?.type === 'text' ? (block.text ?? '') : ''
}

const run = (
  target: { chatId: string } | { groupId: string } = { chatId: CHAT }
) => imageGeneration(settings, target).execute('c1', { prompt: 'a fox' })

describe('image_generation', () => {
  it('writes a base64 result to ~/.actovia/media/<chatId> and puts only its id in details', async () => {
    const bytes = png(3, 2)
    generate.mockResolvedValue({
      output_format: 'png',
      data: [
        {
          b64_json: bytes.toString('base64'),
          revised_prompt: 'a red fox, watercolour'
        }
      ]
    })
    const out = await run()

    const [image] = out.details.images
    expect(image).toEqual({
      mediaId: expect.stringMatching(MEDIA_ID),
      chatId: CHAT,
      mimeType: 'image/png',
      width: 3,
      height: 2,
      revisedPrompt: 'a red fox, watercolour'
    })
    expect(out.details.size).toBe('1024x1536')
    expect(readFileSync(join(chatDir, image.mediaId!))).toEqual(bytes)
    // No bytes anywhere in what gets stored or sent.
    expect(JSON.stringify(out.details)).not.toContain(bytes.toString('base64'))
    expect(JSON.stringify(out.details)).not.toContain('data:')
    const text = textOf(out)
    expect(text).not.toContain(bytes.toString('base64'))
    expect(JSON.parse(text)).toEqual({
      shownToUser: 1,
      images: [{ revisedPrompt: 'a red fox, watercolour' }]
    })
  })

  it("leaves out a choice saved as '' — the API refuses an empty background, size or quality", async () => {
    generate.mockResolvedValue({
      output_format: 'png',
      data: [{ b64_json: png().toString('base64') }]
    })
    // What Settings saves for selects the user never touched (2026-10-22).
    const unset = {
      providers: { openaiApiKey: 'sk-test' },
      image: { model: null, size: '', quality: '', background: '' }
    } as unknown as Settings
    await imageGeneration(unset, { chatId: CHAT }).execute('c1', {
      prompt: 'a fox'
    })
    const [params] = generate.mock.calls[0] as [Record<string, unknown>]
    expect(params).toMatchObject({ model: 'gpt-image-2', prompt: 'a fox' })
    expect(params.size).toBeUndefined()
    expect(params.quality).toBeUndefined()
    expect(params.background).toBeUndefined()
  })

  it('downloads a URL result right away and saves it, typed by its bytes', async () => {
    const bytes = png(8, 8)
    fetchMock.mockResolvedValue(downloaded(bytes, 'image/png'))
    generate.mockResolvedValue({
      data: [{ url: 'https://img.example/1.png' }]
    })
    const out = await run()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://img.example/1.png',
      // The 50 MB cap and the 60 s timeout are kept, now enforced there.
      expect.objectContaining({
        maxBytes: 50 * 1024 * 1024,
        timeoutMs: 60_000
      })
    )
    const [image] = out.details.images
    expect(image).toMatchObject({
      mediaId: expect.stringMatching(MEDIA_ID),
      chatId: CHAT,
      mimeType: 'image/png',
      width: 8,
      height: 8
    })
    expect(image).not.toHaveProperty('url')
    expect(readFileSync(join(chatDir, image.mediaId!))).toEqual(bytes)
    // The model text is what it was: the count, and the link while it lives.
    expect(JSON.parse(textOf(out))).toEqual({
      shownToUser: 1,
      images: [{ url: 'https://img.example/1.png' }]
    })
  })

  it('turns a failed download into a tool error, and leaves no files behind', async () => {
    fetchMock
      .mockResolvedValueOnce(downloaded(png(), null))
      .mockRejectedValueOnce(new Error('HTTP 403'))
    generate.mockResolvedValue({
      data: [
        { url: 'https://img.example/1.png' },
        { url: 'https://img.example/2.png' }
      ]
    })
    const before = existsSync(chatDir) ? readdirSync(chatDir).length : 0

    await expect(run()).rejects.toThrow(/image 2 of 2.*403/i)
    expect(existsSync(chatDir) ? readdirSync(chatDir).length : 0).toBe(before)
  })

  it('turns a download that is not an image into a tool error', async () => {
    fetchMock.mockResolvedValue(downloaded('<html>', 'text/html'))
    generate.mockResolvedValue({ data: [{ url: 'https://img.example/1.png' }] })

    await expect(run()).rejects.toThrow(/not a png, jpeg or webp/i)
  })

  it('saves a Philharmonic result under media/_groups/<groupId>, with no chatId', async () => {
    generate.mockResolvedValue({
      data: [{ b64_json: png().toString('base64') }]
    })
    const out = await run({ groupId: 'group-1' })

    const [image] = out.details.images
    expect(image).not.toHaveProperty('chatId')
    expect(
      existsSync(join(home, 'media', '_groups', 'group-1', image.mediaId!))
    ).toBe(true)
  })

  it('turns a link the download guard refuses into a tool error', async () => {
    fetchMock.mockRejectedValue(
      new Error('Refused: 169.254.169.254 is not a public address')
    )
    generate.mockResolvedValue({
      data: [{ url: 'https://169.254.169.254/latest/meta-data/' }]
    })
    await expect(run()).rejects.toThrow(/image 1 of 1.*refused/i)
  })

  it.each([
    { chatId: '../../x' },
    { chatId: '..' },
    { chatId: 'a/b' },
    { chatId: '' },
    { chatId: '..%2Fx' },
    { groupId: '../x' },
    { groupId: '..' },
    { groupId: 'a/b' },
    { groupId: '' }
  ])('fails with a tool error and writes nothing for %j', async (target) => {
    generate.mockResolvedValue({
      data: [{ b64_json: png().toString('base64') }]
    })
    const before = filesUnder(home)
    await expect(run(target)).rejects.toThrow(/invalid media target/i)
    expect(filesUnder(home)).toEqual(before)
  })
})
