import { beforeEach, describe, expect, it, vi } from 'vitest'

// Deep Research reads widely on purpose: the chat's smaller search (ten
// sources, 8k tokens, two per site) is not its search.
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.mock('@main/lib/net/pinned-fetch', () => ({ fetchPinned: vi.fn() }))
vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))

const { webSearch } = await import('@main/lib/ai/deep-research/web-search')

beforeEach(() => {
  fetchMock.mockReset()
})

describe('deep research web search', () => {
  it('keeps its own volume: twenty sources, the larger token budget, no site cap', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        grounding: {
          generic: Array.from({ length: 24 }, (_, i) => ({
            url: `https://one-site.example/page-${i}`,
            title: `T${i}`,
            snippets: [`s${i}`]
          }))
        },
        sources: {}
      })
    })

    const results = await webSearch(
      { query: 'q', webSources: new Map() },
      { braveApiKey: 'k' }
    )

    // The grounding request, and the rich hint's web/search beside it.
    const requests = fetchMock.mock.calls.map(([u]) => new URL(u as string))
    expect(requests.map((r) => r.pathname)).toEqual([
      '/res/v1/llm/context',
      '/res/v1/web/search'
    ])
    const [request] = requests
    expect(request.searchParams.get('count')).toBe('20')
    expect(request.searchParams.get('maximum_number_of_tokens')).toBe('16384')
    expect(request.searchParams.get('maximum_number_of_tokens_per_url')).toBe(
      '8192'
    )
    expect(results).toHaveLength(20)
  })

  it('leaves a failed query empty and goes on, as before', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402 })

    await expect(
      webSearch({ query: 'q', webSources: new Map() }, { braveApiKey: 'k' })
    ).resolves.toBeNull()
  })
})
