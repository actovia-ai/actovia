// src/main/lib/server/routes/media.ts — GET /api/v1/media/:chatId/:file,
// mounted in a bare Hono app behind the real authGate and errorHandler, the
// way app.ts mounts it. Files live in a scratch ACTOVIA_HOME.
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Hono } from 'hono'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/lan/devices', () => ({
  authenticate: vi.fn(async (token: string) =>
    token === 'good' ? 'dev-1' : null
  )
}))

const home = mkdtempSync(join(tmpdir(), 'actovia-media-route-'))
const originalActoviaHome = process.env.ACTOVIA_HOME
process.env.ACTOVIA_HOME = home
afterAll(() => {
  process.env.ACTOVIA_HOME = originalActoviaHome
})

const { default: mediaRouter } = await import('@main/lib/server/routes/media')
const { authGate } = await import('@main/lib/server/middlewares/auth-gate')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const CHAT = '11111111-1111-4111-8111-111111111111'
const MEDIA = '22222222-2222-4222-8222-222222222222'
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

mkdirSync(join(home, 'media', CHAT), { recursive: true })
writeFileSync(join(home, 'media', CHAT, `${MEDIA}.png`), BYTES)
// A file the route must never hand out, one level above the media dir.
writeFileSync(join(home, 'lock.dat'), 'secret')

const app = new Hono()
app.use('/api/*', authGate)
app.route('/api/v1/media', mediaRouter)
app.onError(errorHandler)

const get = (path: string, init?: RequestInit, env?: unknown) =>
  app.request(`/api/v1/media/${path}`, init, env as never)

describe('GET /api/v1/media/:chatId/:file', () => {
  it('serves the bytes with their type and a long, immutable cache', async () => {
    const res = await get(`${CHAT}/${MEDIA}.png`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe(String(BYTES.length))
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable'
    )
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES)
  })

  it('answers 404 for a well-formed id with no file', async () => {
    const res = await get(`${CHAT}/33333333-3333-4333-8333-333333333333.png`)
    expect(res.status).toBe(404)
  })

  it.each([
    ['a non-uuid chat', `abc/${MEDIA}.png`],
    ['the groups dir', `_groups/${MEDIA}.png`],
    ['an encoded traversal in the file', `${CHAT}/..%2F..%2Flock.dat`],
    ['an encoded traversal in the chat', `..%2F..%2F/${MEDIA}.png`],
    ['an unknown extension', `${CHAT}/${MEDIA}.svg`],
    ['a bare uuid', `${CHAT}/${MEDIA}`],
    ['a double extension', `${CHAT}/${MEDIA}.png.html`]
  ])('answers 400 for %s', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('secret')
  })

  it('never reaches outside the media dir through a raw ../', async () => {
    const res = await get(`${CHAT}/../../lock.dat`)
    expect([400, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('secret')
  })

  it('is behind the LAN auth gate: 401 without a paired token, 200 with one', async () => {
    const lan = { listener: 'lan' }
    const denied = await get(`${CHAT}/${MEDIA}.png`, {}, lan)
    expect(denied.status).toBe(401)

    const allowed = await get(
      `${CHAT}/${MEDIA}.png`,
      { headers: { authorization: 'Bearer good' } },
      lan
    )
    expect(allowed.status).toBe(200)
    expect(Buffer.from(await allowed.arrayBuffer())).toEqual(BYTES)
  })
})
