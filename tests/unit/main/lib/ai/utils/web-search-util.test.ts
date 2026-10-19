import {
  fetchWebSearch,
  loadDocumentBuiltin,
  pickAgeLabel,
  webResultsToSources
} from '@main/lib/ai/utils/web-search-util'
import { LocalApiTargetError } from '@main/lib/net/local-api-guard'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
// The built-in loader's one I/O: a pinned GET that never follows a redirect
// (net/pinned-fetch.ts, tested on its own).
const pinnedMock = vi.fn()
vi.mock('@main/lib/net/pinned-fetch', () => ({
  fetchPinned: (...args: unknown[]) => pinnedMock(...args)
}))
afterEach(() => {
  fetchMock.mockReset()
  pinnedMock.mockReset()
})

function htmlResponse(
  status: number,
  headers: Record<string, string>,
  body = ''
) {
  const h = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  )
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => h.get(name.toLowerCase()) ?? null },
    text: async () => body
  }
}

function ctxResponse(
  generic: { url: string; title?: string; snippets: string[] }[]
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      grounding: { generic },
      sources: Object.fromEntries(
        generic.map((g) => [g.url, { hostname: new URL(g.url).hostname }])
      )
    })
  } as Response
}

describe('fetchWebSearch — query fan-out merge', () => {
  it('unions grounded sources across variants; multi-hit URLs rank first', async () => {
    fetchMock.mockImplementation((url: string) => {
      const q = new URL(url).searchParams.get('q')
      if (q === 'orig')
        return Promise.resolve(
          ctxResponse([
            { url: 'https://x.com/a', title: 'X', snippets: ['from orig'] },
            { url: 'https://y.com/b', title: 'Y', snippets: ['y only'] }
          ])
        )
      if (q === 'variant one')
        return Promise.resolve(
          ctxResponse([
            { url: 'https://x.com/a', title: 'X', snippets: ['from v1'] },
            { url: 'https://z.com/c', title: 'Z', snippets: ['z only'] }
          ])
        )
      return Promise.resolve(
        ctxResponse([
          { url: 'https://x.com/a', title: 'X', snippets: ['from v2'] }
        ])
      )
    })

    const results = await fetchWebSearch({
      query: 'orig',
      braveApiKey: 'k',
      expandedQueries: ['variant one', 'variant two']
    })

    expect(results?.map((r) => r.link)).toEqual([
      'https://x.com/a', // hit by all 3 variants
      'https://y.com/b', // order 1
      'https://z.com/c' // order 2
    ])
    // merged, de-duplicated snippets
    expect(results?.[0].content).toBe('from orig\n\nfrom v1\n\nfrom v2')
    expect(results?.map((r) => r.rank)).toEqual([1, 2, 3])
  })
})

// Owner's call, 2026-09-29: a person reads a page or two of results and
// most articles repeat each other, so a search hands the model about ten
// sources, not sixty. One request unless deep recall is on.
describe('fetchWebSearch — how much one search brings back', () => {
  const grounded = (n: number, host = (i: number) => `site${i}.example`) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://${host(i)}/page-${i}`,
      title: `T${i}`,
      snippets: [`s${i}`]
    }))

  const requests = () =>
    fetchMock.mock.calls.map(([url]) => new URL(url as string))

  it('is one request to the grounding endpoint, for ten sources', async () => {
    fetchMock.mockResolvedValue(ctxResponse(grounded(3)))

    await fetchWebSearch({ query: 'q', braveApiKey: 'k' })

    expect(requests()).toHaveLength(1)
    const [request] = requests()
    expect(request.pathname).toBe('/res/v1/llm/context')
    expect(request.searchParams.get('count')).toBe('10')
    expect(request.searchParams.get('maximum_number_of_urls')).toBe('10')
    expect(request.searchParams.get('maximum_number_of_tokens')).toBe('8192')
    expect(request.searchParams.get('maximum_number_of_tokens_per_url')).toBe(
      '2048'
    )
  })

  it('takes the number of sources from the setting, up to twenty', async () => {
    fetchMock.mockResolvedValue(ctxResponse(grounded(3)))

    await fetchWebSearch({ query: 'q', braveApiKey: 'k', maxResults: 5 })
    await fetchWebSearch({ query: 'q', braveApiKey: 'k', maxResults: 50 })

    expect(requests().map((r) => r.searchParams.get('count'))).toEqual([
      '5',
      '20'
    ])
  })

  it('hands over no more sources than that, however many came back', async () => {
    fetchMock.mockResolvedValue(ctxResponse(grounded(15)))

    const results = await fetchWebSearch({ query: 'q', braveApiKey: 'k' })

    expect(results).toHaveLength(10)
    expect(results?.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('keeps two results of a site: the rest say the same thing', async () => {
    fetchMock.mockResolvedValue(
      ctxResponse([
        ...grounded(5, () => 'finance.yahoo.com'),
        ...grounded(2, () => 'www.yahoo.com').map((g, i) => ({
          ...g,
          url: `https://www.cnbc.com/story-${i}`
        })),
        {
          url: 'https://reuters.example/x',
          title: 'R',
          snippets: ['r']
        }
      ])
    )

    const results = await fetchWebSearch({ query: 'q', braveApiKey: 'k' })

    expect(results?.map((r) => r.link)).toEqual([
      'https://finance.yahoo.com/page-0',
      'https://finance.yahoo.com/page-1',
      'https://www.cnbc.com/story-0',
      'https://www.cnbc.com/story-1',
      'https://reuters.example/x'
    ])
  })

  it('with deep recall: three phrasings, a breadth pass, and still a bounded list', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url)
      const q = u.searchParams.get('q')
      if (u.pathname.endsWith('/llm/context')) {
        return Promise.resolve(
          ctxResponse(grounded(8, (i) => `${q}-${i}.example`))
        )
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: Array.from({ length: 12 }, (_, i) => ({
              url: `https://breadth-${q}-${i}.example/p`,
              title: `B${i}`,
              description: 'snippet'
            }))
          }
        })
      } as Response)
    })

    const results = await fetchWebSearch({
      query: 'a',
      braveApiKey: 'k',
      deep: true,
      expandedQueries: ['b', 'c']
    })

    expect(requests()).toHaveLength(6)
    // Ten grounded sources and five breadth extras, not 24 + 15.
    expect(results).toHaveLength(15)
    expect(results?.filter((r) => r.link.includes('breadth-')).length).toBe(5)
  })

  it("numbers its sources after those of the chat's earlier runs", async () => {
    fetchMock.mockResolvedValue(ctxResponse(grounded(3)))

    const results = await fetchWebSearch({
      query: 'q',
      braveApiKey: 'k',
      webSources: new Map(),
      rankBase: 12
    })

    expect(results?.map((r) => r.rank)).toEqual([13, 14, 15])
  })

  it('brings back what it is asked to when the caller sets the limits', async () => {
    fetchMock.mockResolvedValue(
      ctxResponse(grounded(24, () => 'one-site.example'))
    )

    const results = await fetchWebSearch({
      query: 'q',
      braveApiKey: 'k',
      limits: {
        sources: 20,
        perSite: Number.POSITIVE_INFINITY,
        contextTokens: 16_384,
        tokensPerSource: 8192,
        breadth: 15
      }
    })

    const [request] = requests()
    expect(request.searchParams.get('count')).toBe('20')
    expect(request.searchParams.get('maximum_number_of_tokens')).toBe('16384')
    expect(results).toHaveLength(20)
  })
})

describe('webResultsToSources', () => {
  it('flattens web + news + discussions, deduping by url', () => {
    const flat = webResultsToSources({
      web: {
        results: [
          {
            title: 'A',
            url: 'https://a.com',
            description: 'desc a',
            extra_snippets: ['more a'],
            profile: { name: 'Site A' },
            meta_url: { hostname: 'a.com' }
          },
          { title: 'no content', url: 'https://x.com' }
        ]
      },
      news: {
        results: [{ title: 'A dup', url: 'https://a.com', description: 'dup' }]
      },
      discussions: {
        results: [
          {
            title: 'Q',
            url: 'https://forum.com/t',
            data: {
              forum_name: 'r/rust',
              num_answers: 3,
              question: 'how?',
              top_comment: 'like this'
            }
          }
        ]
      }
    })
    expect(flat.map((s) => s.url)).toEqual([
      'https://a.com',
      'https://forum.com/t'
    ])
    expect(flat[0].content).toBe('desc a\n\nmore a')
    expect(flat[0].siteName).toBe('Site A')
    expect(flat[1].content).toContain('[Forum: r/rust, 3 answers]')
    expect(flat[1].content).toContain('how?')
  })

  it('returns [] for a null response', () => {
    expect(webResultsToSources(null)).toEqual([])
  })
})

describe('pickAgeLabel', () => {
  it('prefers a relative label', () => {
    expect(
      pickAgeLabel(['Thursday, June 18, 2026', '2026-06-18', '5 days ago'])
    ).toBe('5 days ago')
  })

  it('falls back to the ISO date when no relative label', () => {
    expect(pickAgeLabel(['Monday, October 23, 2023', '2023-10-23'])).toBe(
      '2023-10-23'
    )
  })

  it('returns undefined for empty/missing input', () => {
    expect(pickAgeLabel([])).toBeUndefined()
    expect(pickAgeLabel(undefined)).toBeUndefined()
  })
})

describe('loadDocumentBuiltin — cannot reach Exodus’s own API', () => {
  it('fetches a URL on another localhost port normally', async () => {
    pinnedMock.mockResolvedValue(
      htmlResponse(
        200,
        { 'content-type': 'text/html' },
        '<html><body><main>Hello from a local dev server</main></body></html>'
      )
    )

    const result = await loadDocumentBuiltin('http://localhost:3000/page')

    expect(result?.type).toBe('html')
    expect(result?.content).toContain('Hello from a local dev server')
    expect(pinnedMock).toHaveBeenCalledTimes(1)
  })

  it('fetches a URL on a LAN IP, non-Exodus port normally', async () => {
    pinnedMock.mockResolvedValue(
      htmlResponse(
        200,
        { 'content-type': 'text/html' },
        '<html><body><main>Intranet page</main></body></html>'
      )
    )

    const result = await loadDocumentBuiltin('http://192.168.1.50:8080/page')

    expect(result?.content).toContain('Intranet page')
  })

  it('follows an ordinary redirect to another public host', async () => {
    pinnedMock
      .mockResolvedValueOnce(
        htmlResponse(302, { location: 'https://cdn.example/final' })
      )
      .mockResolvedValueOnce(
        htmlResponse(
          200,
          { 'content-type': 'text/html' },
          '<html><body><main>Final content</main></body></html>'
        )
      )

    const result = await loadDocumentBuiltin('https://a.example/start')

    expect(result?.content).toContain('Final content')
    expect(pinnedMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect from a public URL to Exodus’s own loopback API', async () => {
    pinnedMock.mockResolvedValueOnce(
      htmlResponse(302, {
        location: 'http://127.0.0.1:60223/api/v1/settings'
      })
    )

    await expect(
      loadDocumentBuiltin('https://public.example/start')
    ).rejects.toThrow(LocalApiTargetError)
    // The redirect target itself is never actually requested.
    expect(pinnedMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect to the LAN listener by IP too', async () => {
    pinnedMock.mockResolvedValueOnce(
      htmlResponse(302, { location: 'http://127.0.0.1:63129/api/v1/pair' })
    )

    await expect(
      loadDocumentBuiltin('https://public.example/start')
    ).rejects.toThrow('Actovia cannot fetch its own API.')
  })

  it('refuses the initial URL itself when it targets the API directly', async () => {
    await expect(
      loadDocumentBuiltin('http://127.0.0.1:60223/api/v1/settings')
    ).rejects.toThrow(LocalApiTargetError)
    expect(pinnedMock).not.toHaveBeenCalled()
  })

  it('a hop to anything but http(s) is refused before any request', async () => {
    pinnedMock.mockResolvedValueOnce(
      htmlResponse(302, { location: 'file:///etc/passwd' })
    )
    await expect(
      loadDocumentBuiltin('https://public.example/start')
    ).resolves.toBeNull()
    expect(pinnedMock).toHaveBeenCalledTimes(1)
  })
})

// An image search's pictures used to be hung on the first source, so the
// model cited that page for every picture — a whitehouse.gov photo of 2025
// came out as 【21-source】, a Reuters page (owner's report, 2026-09-30).
describe('fetchWebSearch — a picture belongs to the page it came from', () => {
  function mockSearch() {
    fetchMock.mockImplementation((url: string) => {
      const path = new URL(url).pathname
      if (path.endsWith('/images/search'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                url: 'https://a.com/story',
                title: 'At the lunch',
                source: 'a.com',
                properties: { url: 'https://a.com/up/lunch-1140x815.jpg' }
              },
              {
                url: 'https://a.com/story',
                title: 'At the lunch',
                source: 'a.com',
                properties: { url: 'https://a.com/up/lunch-120x86.jpg' }
              },
              {
                url: 'https://c.com/2025/old',
                title: 'Oval Office, 2025',
                source: 'c.com',
                properties: { url: 'https://c.com/old.jpg' }
              }
            ]
          })
        } as Response)
      return Promise.resolve(
        ctxResponse([
          { url: 'https://a.com/story/', title: 'A', snippets: ['a'] },
          { url: 'https://b.com/x', title: 'B', snippets: ['b'] }
        ])
      )
    })
  }

  it('hangs a picture on the source it came from, not on the first one', async () => {
    mockSearch()
    const results = await fetchWebSearch({
      query: 'q',
      braveApiKey: 'k',
      media: 'image'
    })
    const byLink = new Map(results?.map((r) => [r.link, r]))
    expect(
      byLink.get('https://a.com/story/')?.media?.map((m) => m.url)
    ).toEqual(['https://a.com/up/lunch-1140x815.jpg'])
    expect(byLink.get('https://b.com/x')?.media).toBeUndefined()
  })

  it('gives a picture from a page it did not read a number of its own', async () => {
    mockSearch()
    const results = await fetchWebSearch({
      query: 'q',
      braveApiKey: 'k',
      media: 'image'
    })
    const own = results?.find((r) => r.link === 'https://c.com/2025/old')
    expect(own?.rank).toBe(3)
    expect(own?.title).toBe('Oval Office, 2025')
    expect(own?.media?.map((m) => m.url)).toEqual(['https://c.com/old.jpg'])
    // Said to the model plainly: the page itself was not read.
    expect(own?.content).toContain('not read')
  })
})
