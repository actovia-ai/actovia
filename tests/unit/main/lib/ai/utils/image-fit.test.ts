import { describe, expect, it, vi } from 'vitest'

// A stand-in for Electron's nativeImage: a "picture" is the JSON of its size
// and whether it has transparency; an encoded one says what it was encoded as.
type Fake = { width: number; height: number; alpha?: boolean }
const fake = (img: Fake) => ({
  isEmpty: () => false,
  getSize: () => ({ width: img.width, height: img.height }),
  resize: ({ width, height }: { width: number; height: number }) =>
    fake({ ...img, width, height }),
  toBitmap: () => Buffer.from([0, 0, 0, img.alpha ? 128 : 255]),
  toJPEG: (q: number) => Buffer.from(`jpeg ${img.width}x${img.height} q${q}`),
  toPNG: () => Buffer.from(`png ${img.width}x${img.height}`)
})

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buf: Buffer) => {
      try {
        return fake(JSON.parse(buf.toString()) as Fake)
      } catch {
        return { isEmpty: () => true }
      }
    }
  }
}))
vi.mock('@main/lib/logger', () => ({ logger: { info: vi.fn() } }))

const { fitImageDataUrl, fitImagePart, withFittedImages } =
  await import('@main/lib/ai/utils/image-fit')

const dataUrl = (mime: string, img: Fake) =>
  `data:${mime};base64,${Buffer.from(JSON.stringify(img)).toString('base64')}`
const decoded = (url: string) =>
  Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString()
const image = (mime: string, img: Fake) =>
  ({ type: 'image', data: dataUrl(mime, img), mimeType: mime }) as const

describe('fitImagePart', () => {
  it('leaves a picture within limits untouched (the same object)', () => {
    const part = image('image/jpeg', { width: 1600, height: 1200 })
    expect(fitImagePart(part)).toBe(part)
  })

  it('scales an oversized photo to 2048 and encodes it as JPEG', () => {
    const out = fitImagePart(image('image/jpeg', { width: 4032, height: 3024 }))
    expect(out).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect(decoded((out as { data: string }).data)).toBe('jpeg 2048x1536 q85')
  })

  it('keeps a transparent PNG a PNG, and turns an opaque one into JPEG', () => {
    const clear = fitImagePart(
      image('image/png', { width: 3000, height: 1000, alpha: true })
    )
    expect(clear).toMatchObject({ mimeType: 'image/png' })
    expect(decoded((clear as { data: string }).data)).toBe('png 2048x683')
    const opaque = fitImagePart(
      image('image/png', { width: 3000, height: 1000 })
    )
    expect(opaque).toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('leaves remote URLs, GIFs, undecodable data and text alone', () => {
    const remote = {
      type: 'image',
      data: 'https://bucket/x.png',
      mimeType: 'image/png'
    } as const
    const gif = image('image/gif', { width: 5000, height: 5000 })
    const broken = {
      type: 'image',
      data: 'data:image/png;base64,bm9wZQ==',
      mimeType: 'image/png'
    } as const
    const text = { type: 'text', text: 'hi' } as const
    for (const part of [remote, gif, broken, text])
      expect(fitImagePart(part)).toBe(part)
  })
})

describe('withFittedImages', () => {
  it('returns the same message when nothing needed fitting', () => {
    const plain = { role: 'user', content: 'hello' }
    expect(withFittedImages(plain)).toBe(plain)
    const small = {
      role: 'user',
      content: [image('image/jpeg', { width: 10, height: 10 })]
    }
    expect(withFittedImages(small)).toBe(small)
  })

  it('fits only the oversized parts and keeps the rest', () => {
    const text = { type: 'text', text: 'look' } as const
    const message = {
      role: 'user',
      content: [text, image('image/jpeg', { width: 8000, height: 2000 })]
    }
    const out = withFittedImages(message)
    expect(out).not.toBe(message)
    expect(out.content[0]).toBe(text)
    expect(decoded((out.content[1] as { data: string }).data)).toBe(
      'jpeg 2048x512 q85'
    )
  })
})

describe('fitImageDataUrl', () => {
  it('leaves an attachment that is not a picture as it is', () => {
    const input = {
      url: 'data:application/pdf;base64,AAAA',
      type: 'application/pdf'
    }
    const out = fitImageDataUrl(input.url, input.type)
    expect(out).toEqual({ url: input.url, contentType: input.type })
  })

  it('fits an oversized picture and reports its new type', () => {
    const url = dataUrl('image/png', { width: 4096, height: 2048 })
    const out = fitImageDataUrl(url, 'image/png')
    expect(out.contentType).toBe('image/jpeg')
    expect(decoded(out.url)).toMatch(/^jpeg 2048x1024/)
  })
})
