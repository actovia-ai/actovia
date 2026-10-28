import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { webSearch } from '@main/lib/ai/calling-tools/web-search'
import { fetchWebSearch } from '@main/lib/ai/utils/web-search-util'
import type { Settings } from '@main/lib/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/ai/utils/web-search-util', () => ({
  fetchWebSearch: vi.fn()
}))
const expandQuery = vi.fn()
vi.mock('@main/lib/ai/utils/query-expansion', () => ({
  expandQuery: (...args: unknown[]) => expandQuery(...args)
}))
vi.mock('@main/lib/ai/utils/model-util', () => ({
  getModelFromProvider: () => ({ model: { id: 'm' }, apiKey: 'k' })
}))

const mockedFetchWebSearch = vi.mocked(fetchWebSearch)

function result(rank: number, link: string): WebSearchResult {
  return {
    rank,
    link,
    title: `Title ${rank}`,
    content: `Content ${rank}`,
    snippet: `Snippet ${rank}`
  }
}

const settings = {
  webSearch: {
    braveApiKey: 'brave-key',
    country: null,
    languages: null,
    maxResults: null,
    recencyFilter: null,
    domainFilter: null
  }
} as Settings

describe('webSearch tool', () => {
  beforeEach(() => {
    mockedFetchWebSearch.mockReset()
    expandQuery.mockReset()
    expandQuery.mockResolvedValue(['phrasing two', 'phrasing three'])
  })

  it('searches once, as asked, unless deep recall is switched on', async () => {
    mockedFetchWebSearch.mockResolvedValue([result(1, 'https://example.com/1')])

    await webSearch(settings).execute('call-1', { query: 'first query' })

    expect(expandQuery).not.toHaveBeenCalled()
    expect(mockedFetchWebSearch.mock.calls[0][0]).toMatchObject({
      deep: false,
      expandedQueries: []
    })
  })

  it('asks for structured data when the model says the question wants it', async () => {
    mockedFetchWebSearch.mockResolvedValue([result(1, 'https://example.com/1')])

    await webSearch(settings).execute('call-1', {
      query: 'kospi today',
      structured: true
    })
    await webSearch(settings).execute('call-2', { query: 'history of kospi' })

    expect(mockedFetchWebSearch.mock.calls.map(([o]) => o.rich)).toEqual([
      true,
      false
    ])
  })

  it('fans out and adds the breadth pass with deep recall on', async () => {
    mockedFetchWebSearch.mockResolvedValue([result(1, 'https://example.com/1')])
    const deep = {
      webSearch: { ...settings.webSearch, deepRecall: true }
    } as Settings

    await webSearch(deep).execute('call-1', { query: 'first query' })

    expect(expandQuery).toHaveBeenCalledTimes(1)
    expect(mockedFetchWebSearch.mock.calls[0][0]).toMatchObject({
      deep: true,
      expandedQueries: ['phrasing two', 'phrasing three']
    })
  })

  it('keeps source ranks unique across searches in one tool binding', async () => {
    const sourceSizesAtCall: number[] = []
    mockedFetchWebSearch.mockImplementation(({ webSources }) => {
      sourceSizesAtCall.push(webSources?.size ?? -1)
      const nextRank = (webSources?.size ?? 0) + 1
      return Promise.resolve([
        result(nextRank, `https://example.com/${nextRank}`)
      ])
    })

    const tool = webSearch(settings)

    await tool.execute('call-1', { query: 'first query' })
    await tool.execute('call-2', { query: 'second query' })

    expect(mockedFetchWebSearch).toHaveBeenCalledTimes(2)
    const firstSources = mockedFetchWebSearch.mock.calls[0][0].webSources
    const secondSources = mockedFetchWebSearch.mock.calls[1][0].webSources

    expect(firstSources).toBe(secondSources)
    expect(sourceSizesAtCall).toEqual([0, 1])
    expect(firstSources?.size).toBe(2)
    expect(secondSources?.get('https://example.com/1')?.rank).toBe(1)
    expect(secondSources?.get('https://example.com/2')?.rank).toBe(2)
  })

  it('serializes concurrent searches before assigning ranks', async () => {
    const sourceSizesAtCall: number[] = []
    mockedFetchWebSearch.mockImplementation(({ webSources }) => {
      sourceSizesAtCall.push(webSources?.size ?? -1)
      const nextRank = (webSources?.size ?? 0) + 1
      return Promise.resolve([
        result(nextRank, `https://example.com/concurrent-${nextRank}`)
      ])
    })

    const tool = webSearch(settings)

    await Promise.all([
      tool.execute('call-1', { query: 'first query' }),
      tool.execute('call-2', { query: 'second query' })
    ])

    const firstSources = mockedFetchWebSearch.mock.calls[0][0].webSources
    const secondSources = mockedFetchWebSearch.mock.calls[1][0].webSources

    expect(firstSources).toBe(secondSources)
    expect(sourceSizesAtCall).toEqual([0, 1])
    expect(secondSources?.get('https://example.com/concurrent-1')?.rank).toBe(1)
    expect(secondSources?.get('https://example.com/concurrent-2')?.rank).toBe(2)
  })

  it('passes media requests through to web search', async () => {
    mockedFetchWebSearch.mockResolvedValueOnce([
      {
        ...result(1, 'https://example.com/a'),
        media: [
          {
            kind: 'image',
            title: 'Example image',
            url: 'https://example.com/image.jpg',
            sourceUrl: 'https://example.com/a',
            thumbnailUrl: 'https://example.com/thumb.jpg'
          }
        ]
      }
    ])

    const tool = webSearch(settings)
    const output = await tool.execute('call-1', {
      query: 'visual query',
      media: 'all'
    })

    expect(mockedFetchWebSearch.mock.calls[0][0].media).toBe('all')
    expect(output.content[0].text).toContain('Media results')
    expect(output.content[0].text).toContain('https://example.com/image.jpg')
  })
})

// The providers cache a request by its prefix — tools, then system, then
// messages. A description that changed on every request (it ended with the
// millisecond time) re-wrote the whole cache on every message, at 1.25×,
// instead of reading it at 0.1× (2026-10-01). The date is in the system
// prompt, at day granularity.
describe('webSearch — a description that caches', () => {
  it('is the same on every request', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'))
      const first = webSearch(settings).description
      vi.setSystemTime(new Date('2026-10-01T08:03:17.456Z'))
      const second = webSearch(settings).description
      expect(second).toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })
})
