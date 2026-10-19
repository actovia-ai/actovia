// src/main/lib/server/routes/entity.ts — GET /api/v1/entity/:title: Wikipedia's
// summary of an article for the entity panel, fetched in main through the safe
// fetch so a phone needs only its computer, cached a day. The asked language
// first, then English; nothing found is an answer (200, no extract).
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const warn = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }
}))
const fetchPublicHttps = vi.fn()
vi.mock('@main/lib/net/safe-fetch', () => ({ fetchPublicHttps }))

const { default: entityRouter, clearEntityCache } =
  await import('@main/lib/server/routes/entity')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const app = new Hono()
app.route('/api/v1/entity', entityRouter as never)
app.onError(errorHandler)
const get = (path: string) => app.request(`/api/v1/entity${path}`)

const CURIE = {
  title: 'Marie Curie',
  extract:
    'Maria Salomea Skłodowska-Curie was a Polish and naturalised-French physicist and chemist.',
  description: 'Polish-French physicist and chemist (1867–1934)',
  thumbnail: {
    source: 'https://upload.wikimedia.org/x/330px-Marie_Curie.jpg',
    width: 330,
    height: 448
  },
  content_urls: {
    desktop: { page: 'https://en.wikipedia.org/wiki/Marie_Curie' }
  },
  lang: 'en',
  type: 'standard'
}
const json = (value: unknown) => ({
  bytes: Buffer.from(JSON.stringify(value)),
  contentType: 'application/json'
})
const urls = () => fetchPublicHttps.mock.calls.map((call) => call[0])

beforeEach(() => {
  fetchPublicHttps.mockReset()
  warn.mockReset()
  clearEntityCache()
})

describe('GET /api/v1/entity/:title', () => {
  it('answers the summary from the asked language, with the fields the panel draws', async () => {
    fetchPublicHttps.mockResolvedValue(json(CURIE))
    const res = await get('/Marie_Curie?lang=en')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: 'Marie Curie',
      extract: CURIE.extract,
      description: CURIE.description,
      thumbnail: CURIE.thumbnail,
      url: 'https://en.wikipedia.org/wiki/Marie_Curie',
      lang: 'en'
    })
    const [url, options] = fetchPublicHttps.mock.calls[0]!
    expect(url).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/Marie_Curie'
    )
    expect(options.headers['User-Agent']).toMatch(/^Actovia\//u)
    expect(options.headers.Accept).toBe('application/json')
    expect(options.maxBytes).toBe(512 * 1024)
  })

  it('percent-encodes the title and uses the language subdomain', async () => {
    fetchPublicHttps.mockResolvedValue(
      json({ ...CURIE, title: '東京', lang: 'ja' })
    )
    await get('/%E6%9D%B1%E4%BA%AC?lang=ja')
    expect(urls()).toEqual([
      'https://ja.wikipedia.org/api/rest_v1/page/summary/%E6%9D%B1%E4%BA%AC'
    ])
  })

  it('falls back to English when the asked language has no article', async () => {
    fetchPublicHttps
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce(json(CURIE))
    const res = await get('/Marie_Curie?lang=zh')
    expect(res.status).toBe(200)
    expect((await res.json()).lang).toBe('en')
    expect(urls()).toEqual([
      'https://zh.wikipedia.org/api/rest_v1/page/summary/Marie_Curie',
      'https://en.wikipedia.org/api/rest_v1/page/summary/Marie_Curie'
    ])
  })

  it('nothing found anywhere is a 200 with no extract', async () => {
    fetchPublicHttps.mockRejectedValue(new Error('HTTP 404'))
    const res = await get('/Nobody_Here?lang=en')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: 'Nobody Here',
      extract: null,
      description: null,
      thumbnail: null,
      url: null,
      lang: 'en'
    })
    expect(fetchPublicHttps).toHaveBeenCalledTimes(1)
  })

  it('remembers an answer for a day, per language', async () => {
    fetchPublicHttps.mockResolvedValue(json(CURIE))
    await get('/Marie_Curie?lang=en')
    await get('/Marie_Curie?lang=en')
    expect(fetchPublicHttps).toHaveBeenCalledTimes(1)
    await get('/Marie_Curie?lang=fr')
    expect(fetchPublicHttps).toHaveBeenCalledTimes(2)
  })

  it('defaults the language to English', async () => {
    fetchPublicHttps.mockResolvedValue(json(CURIE))
    await get('/Marie_Curie')
    expect(urls()[0]).toContain('https://en.wikipedia.org/')
  })

  // (`..` and `.` as a path segment are swallowed by URL parsing before the
  // route sees them; the title rule's own vectors cover them in Task 1.)
  it.each([
    '/a%2Fb?lang=en',
    '/Marie%20Curie?lang=en',
    `/${'a'.repeat(201)}?lang=en`,
    '/Marie_Curie?lang=EN',
    '/Marie_Curie?lang=e',
    '/Marie_Curie?lang=en.evil',
    '/Marie_Curie?lang=en%2Fx'
  ])('refuses %s with a 400 before any fetch', async (path) => {
    const res = await get(path)
    expect(res.status).toBe(400)
    expect(fetchPublicHttps).not.toHaveBeenCalled()
  })

  it('an upstream failure is a 503 that names no URL', async () => {
    fetchPublicHttps.mockRejectedValue(new Error('HTTP 503'))
    const res = await get('/Marie_Curie?lang=en')
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('wikipedia.org')
    expect(warn).toHaveBeenCalledWith(
      'entity',
      'Wikipedia summary fetch failed',
      { error: expect.any(Error) }
    )
  })

  it('a summary without a thumbnail or a page is answered without them', async () => {
    fetchPublicHttps.mockResolvedValue(json({ title: 'X', extract: 'Y' }))
    expect(await (await get('/X?lang=en')).json()).toEqual({
      title: 'X',
      extract: 'Y',
      description: null,
      thumbnail: null,
      url: null,
      lang: 'en'
    })
  })

  it('a thumbnail that is not https is dropped', async () => {
    fetchPublicHttps.mockResolvedValue(
      json({
        ...CURIE,
        thumbnail: { source: 'http://x/y.jpg', width: 1, height: 1 }
      })
    )
    expect(
      (await (await get('/Marie_Curie?lang=en')).json()).thumbnail
    ).toBeNull()
  })

  it('a thumbnail with no size is dropped', async () => {
    fetchPublicHttps.mockResolvedValue(
      json({ ...CURIE, thumbnail: { ...CURIE.thumbnail, width: 0 } })
    )
    expect(
      (await (await get('/Marie_Curie?lang=en')).json()).thumbnail
    ).toBeNull()
  })

  it('a page URL that is not https is dropped', async () => {
    fetchPublicHttps.mockResolvedValue(
      json({
        ...CURIE,
        content_urls: {
          desktop: { page: 'http://en.wikipedia.org/wiki/Marie_Curie' }
        }
      })
    )
    expect((await (await get('/Marie_Curie?lang=en')).json()).url).toBeNull()
  })
})
