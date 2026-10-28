import {
  BraveSearchError,
  createBraveClient,
  imageSearch,
  llmContext,
  newsSearch,
  richSearch,
  videoSearch,
  webSearch
} from '@actovia-ai/brave-search'
import { describe, expect, it, vi } from 'vitest'

const json = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response

function clientWith(...responses: Response[]) {
  const fetch = vi.fn()
  for (const r of responses) fetch.mockResolvedValueOnce(r)
  fetch.mockResolvedValue(json({}))
  const client = createBraveClient({ apiKey: 'key', fetch, retryDelayMs: 0 })
  const urls = () => fetch.mock.calls.map(([url]) => new URL(url as string))
  return { client, fetch, urls }
}

describe('createBraveClient', () => {
  it('sends the key and asks for gzip', async () => {
    const { client, fetch } = clientWith(json({ ok: 1 }))

    const body = await client.get('/web/search', new URLSearchParams('q=x'))

    expect(body).toEqual({ ok: 1 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.search.brave.com/res/v1/web/search?q=x')
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'x-subscription-token': 'key'
    })
  })

  it('passes the signal on', async () => {
    const { client, fetch } = clientWith(json({}))
    const signal = new AbortController().signal

    await client.get('/web/search', new URLSearchParams(), signal)

    expect(fetch.mock.calls[0][1].signal).toBe(signal)
  })

  it('retries a 429 once', async () => {
    const { client, fetch } = clientWith(json({}, 429), json({ again: true }))

    await expect(client.get('/x', new URLSearchParams())).resolves.toEqual({
      again: true
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    [429, 'rate_limited'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'quota'],
    [500, 'http']
  ] as const)('names a %i as %s', async (status, failure) => {
    const { client } = clientWith(json({}, status), json({}, status))

    const error = await client
      .get('/x', new URLSearchParams())
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BraveSearchError)
    expect(error).toMatchObject({ failure, status })
  })

  it('never puts the key in an error', async () => {
    const fetch = vi.fn().mockResolvedValue(json({}, 401))
    const client = createBraveClient({ apiKey: 'BSA-s3cr3t', fetch })

    const error = (await client
      .get('/x', new URLSearchParams())
      .catch((e: unknown) => e)) as Error

    expect(error.message).not.toContain('BSA-s3cr3t')
  })
})

describe('endpoints', () => {
  it('llmContext: budgets, metadata, no spellcheck, strict on request', async () => {
    const { client, urls } = clientWith()

    await llmContext(client, {
      query: 'axum',
      country: 'DE',
      languages: ['de', 'en'],
      recency: 'week',
      sources: 7,
      maxTokens: 4096,
      maxTokensPerSource: 1024,
      threshold: 'strict'
    })

    const [u] = urls()
    expect(u.pathname).toBe('/res/v1/llm/context')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: 'axum',
      country: 'de',
      search_lang: 'de',
      freshness: 'pw',
      count: '7',
      maximum_number_of_urls: '7',
      maximum_number_of_tokens: '4096',
      maximum_number_of_tokens_per_url: '1024',
      enable_source_metadata: 'true',
      spellcheck: 'false',
      context_threshold_mode: 'strict'
    })
  })

  it('webSearch: web, news and discussions, and the rich callback when asked', async () => {
    const { client, urls } = clientWith()

    await webSearch(client, { query: 'q' })
    await webSearch(client, { query: 'q', richCallback: true })

    const [plain, rich] = urls()
    expect(plain.pathname).toBe('/res/v1/web/search')
    expect(plain.searchParams.get('result_filter')).toBe('web,news,discussions')
    expect(plain.searchParams.get('extra_snippets')).toBe('true')
    expect(plain.searchParams.get('count')).toBe('20')
    expect(plain.searchParams.has('enable_rich_callback')).toBe(false)
    expect(rich.searchParams.get('enable_rich_callback')).toBe('true')
  })

  it('richSearch: the callback key, on /web/rich', async () => {
    const { client, urls } = clientWith()

    await richSearch(client, 'f5f8999d')

    const [u] = urls()
    expect(u.pathname).toBe('/res/v1/web/rich')
    expect(u.searchParams.get('callback_key')).toBe('f5f8999d')
  })

  it('images and videos: safe search, small counts', async () => {
    const { client, urls } = clientWith()

    await imageSearch(client, { query: 'q', count: 50 })
    await videoSearch(client, { query: 'q', recency: 'hour' })

    const [images, videos] = urls()
    expect(images.pathname).toBe('/res/v1/images/search')
    expect(images.searchParams.get('safesearch')).toBe('strict')
    expect(images.searchParams.get('count')).toBe('8')
    expect(videos.pathname).toBe('/res/v1/videos/search')
    expect(videos.searchParams.get('safesearch')).toBe('moderate')
    expect(videos.searchParams.get('count')).toBe('4')
    // Brave has no past hour: the nearest is the past day.
    expect(videos.searchParams.get('freshness')).toBe('pd')
  })

  it('newsSearch: a week by default', async () => {
    const { client, urls } = clientWith()

    await newsSearch(client, { query: 'q', count: 12, language: 'fr' })

    const [u] = urls()
    expect(u.pathname).toBe('/res/v1/news/search')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: 'q',
      search_lang: 'fr',
      count: '12',
      freshness: 'pw'
    })
  })
})
