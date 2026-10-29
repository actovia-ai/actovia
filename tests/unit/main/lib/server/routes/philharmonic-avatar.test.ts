// src/main/lib/server/routes/philharmonic-avatar.ts — GET
// /api/v1/philharmonic/avatar, mounted behind the real authGate and
// errorHandler as app.ts mounts it (ISSUE-296: actovia-ios draws the
// desktop's DiceBear faces from it).
import { Avatar, Style } from '@dicebear/core'
import notionists from '@dicebear/styles/notionists.json'
import thumbs from '@dicebear/styles/thumbs.json'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/lan/devices', () => ({
  authenticate: vi.fn(async (token: string) =>
    token === 'good' ? 'dev-1' : null
  )
}))

const { default: avatarRouter } =
  await import('@main/lib/server/routes/philharmonic-avatar')
const { avatarSvg, resolveAvatarStyle } =
  await import('@main/lib/ai/philharmonic/avatar-image')
const { authGate } = await import('@main/lib/server/middlewares/auth-gate')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const app = new Hono()
app.use('/api/*', authGate)
app.route('/api/v1/philharmonic', avatarRouter)
app.onError(errorHandler)

const get = (query: string, init?: RequestInit, env?: unknown) =>
  app.request(`/api/v1/philharmonic/avatar${query}`, init, env as never)

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('avatarSvg', () => {
  it('is the renderer’s SVG for the same seed and style', () => {
    expect(avatarSvg('Iris', 'thumbs')).toBe(
      new Avatar(new Style(thumbs), { seed: 'Iris' }).toString()
    )
    expect(avatarSvg('Oskar', 'notionists')).toBe(
      new Avatar(new Style(notionists), { seed: 'Oskar' }).toString()
    )
  })

  it('falls back as the renderer does: no seed → default, unknown style → notionists', () => {
    expect(avatarSvg(null, null)).toBe(
      new Avatar(new Style(notionists), { seed: 'default' }).toString()
    )
    expect(resolveAvatarStyle('bottts')).toBe('notionists')
    expect(resolveAvatarStyle('adventurer')).toBe('adventurer')
  })
})

describe('GET /api/v1/philharmonic/avatar', () => {
  it('answers a PNG of the asked size with a long, immutable cache', async () => {
    const res = await get('?seed=Iris&style=thumbs&size=96')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable'
    )
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes.subarray(0, 8))).toEqual(PNG_MAGIC)
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    expect(pngSize(bytes)).toEqual({ width: 96, height: 96 })
  })

  it('defaults to 128 px and draws different seeds differently', async () => {
    const a = new Uint8Array(await (await get('?seed=Iris')).arrayBuffer())
    const b = new Uint8Array(await (await get('?seed=Oskar')).arrayBuffer())
    expect(pngSize(a)).toEqual({ width: 128, height: 128 })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it.each([
    ['?size=8', 'below the minimum'],
    ['?size=2048', 'above the maximum'],
    ['?size=12.5', 'not an integer'],
    ['?size=abc', 'not a number'],
    ['?style=../etc', 'a style that is not a name'],
    [`?seed=${'x'.repeat(257)}`, 'a seed past 256 characters']
  ])('refuses %s (%s) with a 400', async (query) => {
    const res = await get(query)
    expect(res.status).toBe(400)
  })

  it('needs a paired device’s token on the LAN listener', async () => {
    const lan = { listener: 'lan' }
    expect((await get('?seed=Iris', undefined, lan)).status).toBe(401)
    const ok = await get(
      '?seed=Iris',
      { headers: { authorization: 'Bearer good' } },
      lan
    )
    expect(ok.status).toBe(200)
  })
})
