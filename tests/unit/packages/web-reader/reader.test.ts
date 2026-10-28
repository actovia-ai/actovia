// @actovia-ai/web-reader's reader — a page as Markdown. Every hop is a
// stubbed `fetchHop`, so nothing here leaves the process.
import {
  extractHtmlBody,
  readDirect,
  readPage,
  readWithJina
} from '@actovia-ai/web-reader'
import { afterEach, describe, expect, it, vi } from 'vitest'

const page = (
  status: number,
  headers: Record<string, string>,
  body: string | Blob = ''
) =>
  new Response(status >= 300 && status < 400 ? null : body, { status, headers })

const html = (body: string) => page(200, { 'content-type': 'text/html' }, body)

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('readDirect', () => {
  it('turns the main content into Markdown, with the og:image', async () => {
    const fetchHop = vi
      .fn()
      .mockResolvedValue(
        html(
          '<html><head><meta property="og:image" content="https://i.example/a.png"></head>' +
            '<body><nav>menu</nav><article><h1>Title</h1><p>Body text</p></article></body></html>'
        )
      )

    const doc = await readDirect('https://a.example/', { fetchHop })

    expect(doc).toEqual({
      ogImage: 'https://i.example/a.png',
      type: 'html',
      content: '# Title\n\nBody text'
    })
  })

  it('follows a redirect, asking the guard before every hop', async () => {
    const guard = vi.fn()
    const fetchHop = vi
      .fn()
      .mockResolvedValueOnce(page(302, { location: '/final' }))
      .mockResolvedValueOnce(html('<main>Final</main>'))

    const doc = await readDirect('https://a.example/start', { fetchHop, guard })

    expect(doc?.content).toBe('Final')
    expect(guard.mock.calls.map(([u]) => String(u))).toEqual([
      'https://a.example/start',
      'https://a.example/final'
    ])
  })

  it('throws what the guard throws, and never requests that hop', async () => {
    const refusal = new Error('no')
    const fetchHop = vi
      .fn()
      .mockResolvedValueOnce(page(302, { location: 'http://127.0.0.1:8123/' }))
    const guard = (url: URL) => {
      if (url.port === '8123') throw refusal
    }

    await expect(
      readDirect('https://a.example/', { fetchHop, guard })
    ).rejects.toBe(refusal)
    expect(fetchHop).toHaveBeenCalledTimes(1)
  })

  it('throws a refusal from inside the hop, and reads other failures as null', async () => {
    class Refused extends Error {}
    const isRefusal = (e: unknown) => e instanceof Refused

    await expect(
      readDirect('https://a.example/', {
        fetchHop: () => Promise.reject(new Refused()),
        isRefusal
      })
    ).rejects.toBeInstanceOf(Refused)
    await expect(
      readDirect('https://a.example/', {
        fetchHop: () => Promise.reject(new TypeError('fetch failed')),
        isRefusal
      })
    ).resolves.toBeNull()
  })

  it('is null for an error page, another type, a bad URL or a non-http hop', async () => {
    expect(
      await readDirect('https://a.example/', {
        fetchHop: async () =>
          page(404, { 'content-type': 'text/html' }, 'Not Found')
      })
    ).toBeNull()
    expect(
      await readDirect('https://a.example/', {
        fetchHop: async () => page(200, { 'content-type': 'image/png' }, 'x')
      })
    ).toBeNull()
    expect(await readDirect('not a url')).toBeNull()

    const fetchHop = vi
      .fn()
      .mockResolvedValueOnce(page(302, { location: 'file:///etc/passwd' }))
    expect(await readDirect('https://a.example/', { fetchHop })).toBeNull()
    expect(fetchHop).toHaveBeenCalledTimes(1)
  })

  it('reads a PDF only with a parser', async () => {
    const pdf = () =>
      page(200, { 'content-type': 'application/pdf' }, new Blob(['%PDF']))

    expect(
      await readDirect('https://a.example/a.pdf', {
        fetchHop: async () => pdf()
      })
    ).toBeNull()
    expect(
      await readDirect('https://a.example/a.pdf', {
        fetchHop: async () => pdf(),
        parsePdf: async () => 'Page one'
      })
    ).toEqual({ ogImage: '', type: 'pdf', content: 'Page one' })
    expect(
      await readDirect('https://a.example/a.pdf', {
        fetchHop: async () => pdf(),
        parsePdf: () => Promise.reject(new Error('broken'))
      })
    ).toBeNull()
  })
})

describe('readWithJina / readPage', () => {
  it('asks Jina Reader for the page as text', async () => {
    fetchMock.mockResolvedValue(new Response('# From Jina'))

    const doc = await readWithJina('https://a.example/x')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://r.jina.ai/https://a.example/x'
    )
    expect(doc).toEqual({ ogImage: '', type: 'html', content: '# From Jina' })
  })

  it('falls back to the page itself when Jina has nothing', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 451 }))
    const fetchHop = vi.fn().mockResolvedValue(html('<main>Direct</main>'))

    const doc = await readPage('https://a.example/', { fetchHop })

    expect(doc?.content).toBe('Direct')
  })
})

describe('extractHtmlBody', () => {
  it('drops scripts, styles and chrome, and prefers the article', () => {
    const dom = extractHtmlBody(
      '<body><header>h</header><script>x()</script><article>A</article><main>M</main></body>'
    )

    expect(dom?.html).toBe('A')
  })
})
