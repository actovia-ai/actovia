import type { Model } from '@earendil-works/pi-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const mockDbWhere = vi.fn()
const mockDbSet = vi.fn(() => ({ where: mockDbWhere }))
const mockDbUpdate = vi.fn(() => ({ set: mockDbSet }))
vi.mock('@main/lib/db/db', () => ({
  db: { update: mockDbUpdate },
  pglite: {}
}))

const mockEq = vi.fn((col: unknown, value: unknown) => ({ col, value }))
vi.mock('drizzle-orm', async (importActual) => ({
  ...(await importActual<typeof import('drizzle-orm')>()),
  eq: mockEq
}))

vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const mockGetSettings = vi.fn()
vi.mock('@main/lib/db/queries', () => ({ getSettings: mockGetSettings }))

const mockGetActiveMemories = vi.fn()
vi.mock('@main/lib/db/memory-queries', () => ({
  getActiveMemories: mockGetActiveMemories
}))

const mockGetDiscoverFeed = vi.fn()
const mockSetDiscoverFeed = vi.fn()
vi.mock('@main/lib/db/discover-queries', () => ({
  getDiscoverFeed: mockGetDiscoverFeed,
  setDiscoverFeed: mockSetDiscoverFeed
}))

const mockGetModelFromProvider = vi.fn()
vi.mock('@main/lib/ai/utils/model-util', () => ({
  getModelFromProvider: mockGetModelFromProvider
}))

const mockCompleteSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({
    completeSimple: (...args: unknown[]) => mockCompleteSimple(...args)
  })
}))

const mockSearchBraveNews = vi.fn()
vi.mock('@main/lib/discover/brave-news-client', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@main/lib/discover/brave-news-client')
  >()),
  searchBraveNews: (...args: unknown[]) => mockSearchBraveNews(...args)
}))

const { runDiscoverRefresh, resetStuckDiscoverRefresh } =
  await import('@main/lib/discover/manager')

const model = { id: 'm' } as unknown as Model<string>

function llmReturns(obj: unknown) {
  mockCompleteSimple.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(obj) }]
  })
}

/** The model's two answers in turn: the topics, then which results fit. */
function llmAnswers(...answers: unknown[]) {
  for (const answer of answers) {
    mockCompleteSimple.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(answer) }]
    })
  }
}

function pooled(title: string, hoursAgo: number) {
  return {
    title,
    url: `https://x/${encodeURIComponent(title)}`,
    description: '',
    source: 'x',
    publishedMs: Date.parse('2026-10-08T12:00:00Z') - hoursAgo * 3_600_000
  }
}

function memoryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    key: 'SoftBank',
    section: 'topic',
    summary: 'Holds SoftBank 9984',
    lastUsedAt: new Date('2026-09-05'),
    updatedAt: new Date('2026-09-05'),
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSettings.mockResolvedValue({
    id: 'global',
    discover: { enabled: true, topicCount: 4, articlesPerTopic: 3 },
    webSearch: { braveApiKey: 'brave-key', country: 'us', languages: ['en'] }
  })
  mockGetDiscoverFeed.mockResolvedValue({
    id: 'global',
    groups: [],
    generatedAt: null,
    status: 'idle',
    error: null
  })
  mockGetModelFromProvider.mockReturnValue({ chatModel: model, apiKey: 'k' })
  mockGetActiveMemories.mockResolvedValue([])
  mockSearchBraveNews.mockResolvedValue([])
})

describe('runDiscoverRefresh', () => {
  it('no-ops when discover is disabled', async () => {
    mockGetSettings.mockResolvedValue({
      id: 'global',
      discover: { enabled: false }
    })
    await runDiscoverRefresh()
    expect(mockGetDiscoverFeed).not.toHaveBeenCalled()
  })

  it('no-ops when no Brave key is configured', async () => {
    mockGetSettings.mockResolvedValue({
      id: 'global',
      discover: { enabled: true },
      webSearch: {}
    })
    await runDiscoverRefresh()
    expect(mockGetDiscoverFeed).not.toHaveBeenCalled()
  })

  it('no-ops when the feed is fresh and force is not set', async () => {
    mockGetDiscoverFeed.mockResolvedValue({
      id: 'global',
      groups: [],
      generatedAt: new Date(), // just now
      status: 'idle',
      error: null
    })
    await runDiscoverRefresh()
    expect(mockGetActiveMemories).not.toHaveBeenCalled()
  })

  it('proceeds when force is set even if fresh', async () => {
    mockGetDiscoverFeed.mockResolvedValue({
      id: 'global',
      groups: [],
      generatedAt: new Date(),
      status: 'idle',
      error: null
    })
    mockGetActiveMemories.mockResolvedValue([])
    await runDiscoverRefresh({ force: true })
    expect(mockGetActiveMemories).toHaveBeenCalled()
  })

  it('writes an empty feed when there are no active memories', async () => {
    mockGetActiveMemories.mockResolvedValue([])
    await runDiscoverRefresh()
    expect(mockSetDiscoverFeed).toHaveBeenCalledWith(
      expect.objectContaining({ groups: [], status: 'idle' })
    )
  })

  it('builds groups from surviving (non-null-query) LLM items', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1', key: 'SoftBank' }),
      memoryRow({ id: 'mem-2', key: 'Japanese grammar' })
    ])
    llmReturns({
      items: [
        { memoryId: 'mem-1', topic: 'SoftBank', query: 'SoftBank 9984 news' },
        { memoryId: 'mem-2', topic: 'Japanese grammar', query: null }
      ]
    })
    mockSearchBraveNews.mockResolvedValue([
      { title: 'A', url: 'https://x/a', description: '', source: 'x' }
    ])

    await runDiscoverRefresh()

    expect(mockSearchBraveNews).toHaveBeenCalledTimes(1)
    expect(mockSearchBraveNews).toHaveBeenCalledWith(
      'brave-key',
      'SoftBank 9984 news',
      {
        count: 3,
        country: 'us',
        language: 'en'
      }
    )
    const written = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'idle' && c[0].groups
    )?.[0]
    expect(written.groups).toEqual([
      {
        memoryId: 'mem-1',
        topic: 'SoftBank',
        query: 'SoftBank 9984 news',
        articles: [
          { title: 'A', url: 'https://x/a', description: '', source: 'x' }
        ]
      }
    ])
  })

  it('drops a group whose query returned zero articles', async () => {
    mockGetActiveMemories.mockResolvedValue([memoryRow()])
    llmReturns({
      items: [{ memoryId: 'mem-1', topic: 'SoftBank', query: 'q' }]
    })
    mockSearchBraveNews.mockResolvedValue([])

    await runDiscoverRefresh()

    const written = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'idle'
    )?.[0]
    expect(written.groups).toEqual([])
  })

  it('one failed Brave query does not drop other groups', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1' }),
      memoryRow({ id: 'mem-2', key: 'Argentina' })
    ])
    llmReturns({
      items: [
        { memoryId: 'mem-1', topic: 'SoftBank', query: 'q1' },
        { memoryId: 'mem-2', topic: 'Argentina', query: 'q2' }
      ]
    })
    mockSearchBraveNews.mockImplementation(async (_key: string, q: string) => {
      if (q === 'q1') throw new Error('rate limited')
      return [{ title: 'B', url: 'https://x/b', description: '', source: 'x' }]
    })

    await runDiscoverRefresh()

    const written = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'idle'
    )?.[0]
    expect(written.groups).toHaveLength(1)
    expect(written.groups[0].memoryId).toBe('mem-2')
  })

  it('when every Brave query fails, marks the feed failed and keeps the old one', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1' }),
      memoryRow({ id: 'mem-2', key: 'Argentina' })
    ])
    llmReturns({
      items: [
        { memoryId: 'mem-1', topic: 'SoftBank', query: 'q1' },
        { memoryId: 'mem-2', topic: 'Argentina', query: 'q2' }
      ]
    })
    mockSearchBraveNews.mockRejectedValue(
      new Error('Brave News search failed: 402')
    )

    await expect(runDiscoverRefresh()).rejects.toThrow('402')

    expect(
      mockSetDiscoverFeed.mock.calls.find((c) => c[0].status === 'idle')
    ).toBeUndefined()
    const failedCall = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'failed'
    )?.[0]
    expect(failedCall.error).toContain('Every Brave News query failed')
    expect(failedCall.groups).toBeUndefined()
    expect(failedCall.generatedAt).toBeUndefined()
  })

  it('keeps valid groups when one LLM item is malformed (lenient per-item parse)', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1', key: 'SoftBank' }),
      memoryRow({ id: 'mem-2', key: 'Argentina' })
    ])
    llmReturns({
      items: [
        { memoryId: 'mem-1', topic: 'SoftBank', query: 'SoftBank 9984 news' },
        // Malformed: a numeric query. Previously this threw inside the schema
        // parse and collapsed the whole response to { items: [] }.
        { memoryId: 'mem-2', topic: 'Argentina', query: 123 }
      ]
    })
    mockSearchBraveNews.mockResolvedValue([
      { title: 'A', url: 'https://x/a', description: '', source: 'x' }
    ])

    await runDiscoverRefresh()

    // Only the valid item drove a Brave query.
    expect(mockSearchBraveNews).toHaveBeenCalledTimes(1)
    expect(mockSearchBraveNews).toHaveBeenCalledWith(
      'brave-key',
      'SoftBank 9984 news',
      expect.anything()
    )

    const idleWrites = mockSetDiscoverFeed.mock.calls
      .map((c) => c[0])
      .filter((p) => p.status === 'idle')
    // The success-path write keeps the good group…
    const written = idleWrites.find((p) => p.groups)
    expect(written.groups).toEqual([
      {
        memoryId: 'mem-1',
        topic: 'SoftBank',
        query: 'SoftBank 9984 news',
        articles: [
          { title: 'A', url: 'https://x/a', description: '', source: 'x' }
        ]
      }
    ])
    // …and never blanks the feed with an empty groups array.
    expect(
      idleWrites.some((p) => Array.isArray(p.groups) && p.groups.length === 0)
    ).toBe(false)
  })

  it('asks only about the topics the user follows, not their profile or people', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1', key: 'Investing' }),
      memoryRow({ id: 'mem-2', key: 'Location', section: 'profile' }),
      memoryRow({ id: 'mem-3', key: 'Meiji', section: 'person' })
    ])
    llmReturns({ items: [] })

    await runDiscoverRefresh()

    const prompt = mockCompleteSimple.mock.calls[0][1].messages[0].content[0]
      .text as string
    expect(prompt).toContain('mem-1')
    expect(prompt).not.toContain('mem-2')
    expect(prompt).not.toContain('mem-3')
  })

  it('shows the freshest of what the check keeps, and drops a topic left with nothing', async () => {
    mockGetActiveMemories.mockResolvedValue([
      memoryRow({ id: 'mem-1', key: 'Investing' }),
      memoryRow({ id: 'mem-2', key: 'Zelda' })
    ])
    llmAnswers(
      {
        items: [
          { memoryId: 'mem-1', topic: 'Japan stocks', query: 'q1' },
          { memoryId: 'mem-2', topic: 'Zelda', query: 'q2' }
        ]
      },
      {
        topics: [
          { topic: 1, keep: [1, 3, 4] },
          { topic: 2, keep: [] }
        ]
      }
    )
    mockSearchBraveNews.mockImplementation(async (_key: string, q: string) =>
      q === 'q1'
        ? [
            pooled('Nikkei tops 70,000', 30),
            pooled('European shares fall', 1),
            pooled('Advantest buyback', 5),
            pooled('Murata results', 50)
          ]
        : [pooled('A failed execution', 2)]
    )

    await runDiscoverRefresh()

    const judge = mockCompleteSimple.mock.calls[1][1].messages[0].content[0]
      .text as string
    expect(judge).toContain('Topic 1: Japan stocks')
    expect(judge).toContain('2. European shares fall')
    const written = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'idle' && c[0].groups
    )?.[0]
    expect(written.groups).toHaveLength(1)
    expect(
      written.groups[0].articles.map((a: { title: string }) => a.title)
    ).toEqual(['Advantest buyback', 'Nikkei tops 70,000', 'Murata results'])
    expect(written.groups[0].articles[0]).not.toHaveProperty('publishedMs')
  })

  it('when the check cannot be read, shows Brave’s relevance order, not the newest', async () => {
    mockGetActiveMemories.mockResolvedValue([memoryRow()])
    llmAnswers(
      { items: [{ memoryId: 'mem-1', topic: 'SoftBank', query: 'q' }] },
      'not json'
    )
    mockSearchBraveNews.mockResolvedValue([
      pooled('most relevant', 40),
      pooled('second', 30),
      pooled('third', 20),
      pooled('fresh loose match', 1)
    ])

    await runDiscoverRefresh()

    const written = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'idle' && c[0].groups
    )?.[0]
    expect(
      written.groups[0].articles.map((a: { title: string }) => a.title)
    ).toEqual(['third', 'second', 'most relevant'])
  })

  it('on an LLM failure, marks status failed, leaves groups/generatedAt untouched, and rethrows', async () => {
    mockGetActiveMemories.mockResolvedValue([memoryRow()])
    mockCompleteSimple.mockRejectedValue(new Error('provider down'))

    await expect(runDiscoverRefresh()).rejects.toThrow('provider down')

    expect(mockSetDiscoverFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('provider down')
      })
    )
    const failedCall = mockSetDiscoverFeed.mock.calls.find(
      (c) => c[0].status === 'failed'
    )?.[0]
    expect(failedCall.groups).toBeUndefined()
    expect(failedCall.generatedAt).toBeUndefined()
  })
})

describe('resetStuckDiscoverRefresh', () => {
  it("resets rows stuck at 'refreshing' back to 'idle'", async () => {
    await resetStuckDiscoverRefresh()

    expect(mockDbUpdate).toHaveBeenCalledTimes(1)
    expect(mockDbSet).toHaveBeenCalledWith({ status: 'idle' })
    expect(mockDbWhere).toHaveBeenCalledTimes(1)
    // The WHERE clause targets the stuck status specifically.
    expect(mockEq).toHaveBeenCalledWith(expect.anything(), 'refreshing')
  })
})
