import { Client } from '@elastic/elasticsearch'
import type { Message } from '@main/lib/db/schema'
import { describe, expect, it, vi } from 'vitest'

// logger.ts transitively imports Electron for its log-directory resolution.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const mockIndex = vi.fn()
const mockSearch = vi.fn()
const mockDeleteByQuery = vi.fn()
const mockInfo = vi.fn()
const mockBulk = vi.fn()
const mockGetMessageHitsByIds = vi.fn()
const mockGetChatsByTitle = vi.fn()

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      index: mockIndex,
      search: mockSearch,
      deleteByQuery: mockDeleteByQuery,
      info: mockInfo,
      helpers: { bulk: mockBulk }
    }
  })
}))

vi.mock('@main/lib/db/queries', () => ({
  getMessageHitsByIds: mockGetMessageHitsByIds,
  getChatsByTitle: mockGetChatsByTitle
}))

const { createElasticsearchProvider } =
  await import('@main/lib/search/providers/elasticsearch-search')

const baseMessage: Message = {
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  searchText: 'hello',
  usage: null,
  api: null,
  provider: null,
  model: null,
  stopReason: null,
  errorMessage: null,
  toolCallId: null,
  toolName: null,
  details: null,
  isError: null,
  durationMs: null,
  createdAt: new Date('2026-01-01')
}

describe('createElasticsearchProvider', () => {
  it('indexes a message with only chatId, searchText, createdAt', async () => {
    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.indexMessage(baseMessage)

    expect(mockIndex).toHaveBeenCalledWith({
      index: 'exodus-messages',
      id: 'msg-1',
      document: {
        chatId: 'chat-1',
        searchText: 'hello',
        createdAt: baseMessage.createdAt
      }
    })
  })

  it('skips indexing when searchText is null', async () => {
    mockIndex.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.indexMessage({ ...baseMessage, searchText: null })

    expect(mockIndex).not.toHaveBeenCalled()
  })

  it('uses a custom index name when configured', async () => {
    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200',
      indexName: 'custom-index'
    })
    await provider.indexMessage(baseMessage)

    expect(mockIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 'custom-index' })
    )
  })

  it('deletes by chatId via a term query on the .keyword subfield', async () => {
    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.deleteByChatId('chat-1')

    // Must target `chatId.keyword`, not `chatId` — the dynamically mapped
    // `text` field is analyzed, so a `term` query on it never matches a UUID.
    expect(mockDeleteByQuery).toHaveBeenCalledWith({
      index: 'exodus-messages',
      query: { term: { 'chatId.keyword': 'chat-1' } }
    })
  })

  it('clears the whole index via a match_all delete-by-query', async () => {
    mockDeleteByQuery.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.deleteAll()

    expect(mockDeleteByQuery).toHaveBeenCalledWith({
      index: 'exodus-messages',
      query: { match_all: {} }
    })
  })

  it('clears a custom index name when configured', async () => {
    mockDeleteByQuery.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200',
      indexName: 'custom-index'
    })
    await provider.deleteAll()

    expect(mockDeleteByQuery).toHaveBeenCalledWith(
      expect.objectContaining({ index: 'custom-index' })
    )
  })

  it('configures the client with a request timeout and limited retries', () => {
    const ClientMock = vi.mocked(Client)
    ClientMock.mockClear()

    createElasticsearchProvider({ url: 'http://localhost:9200' })

    expect(ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        node: 'http://localhost:9200',
        requestTimeout: 5000,
        maxRetries: 1
      })
    )
  })

  it('asks for every word among the newest hits, and answers one row per chat', async () => {
    mockSearch.mockResolvedValue({
      hits: { hits: [{ _id: 'msg-1' }, { _id: 'msg-2' }] }
    })
    mockGetMessageHitsByIds.mockResolvedValue({
      chats: [
        {
          chatId: 'chat-1',
          title: 'Chat One',
          activityAt: baseMessage.createdAt
        }
      ],
      messages: [{ ...baseMessage, searchText: '**hello** world' }]
    })
    mockGetChatsByTitle.mockResolvedValue([
      {
        chatId: 'chat-2',
        title: 'Hello world',
        activityAt: '2025-12-01T00:00:00.000Z'
      }
    ])

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    const results = await provider.search('hello world')

    expect(mockSearch).toHaveBeenCalledWith({
      index: 'exodus-messages',
      query: {
        match: { searchText: { query: 'hello world', operator: 'and' } }
      },
      sort: [{ createdAt: { order: 'desc' } }],
      size: 300,
      _source: false
    })
    expect(mockGetMessageHitsByIds).toHaveBeenCalledWith(['msg-1', 'msg-2'])
    expect(mockGetChatsByTitle).toHaveBeenCalledWith(['hello', 'world'])
    expect(results).toEqual([
      {
        chatId: 'chat-1',
        title: 'Chat One',
        matchedAt: '2026-01-01T00:00:00.000Z',
        snippets: [
          {
            messageId: 'msg-1',
            role: 'assistant',
            text: 'hello world',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      },
      {
        chatId: 'chat-2',
        title: 'Hello world',
        matchedAt: '2025-12-01T00:00:00.000Z',
        snippets: []
      }
    ])
  })

  it('answers [] for a blank query without asking the cluster', async () => {
    mockSearch.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })

    expect(await provider.search('  ')).toEqual([])
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('pings via client.info() rather than a query against the index', async () => {
    mockInfo.mockResolvedValue({ cluster_name: 'test' })
    mockSearch.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.ping()

    // Must not go through search()/deleteByQuery() — those depend on the
    // index existing, so a freshly-configured cluster would otherwise
    // report itself as unreachable.
    expect(mockInfo).toHaveBeenCalledTimes(1)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('propagates a ping failure so callers can distinguish reachable from not', async () => {
    mockInfo.mockRejectedValueOnce(new Error('connection refused'))

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })

    await expect(provider.ping()).rejects.toThrow('connection refused')
  })

  it('bulk-indexes only messages with a non-null searchText', async () => {
    mockBulk.mockClear()
    mockBulk.mockResolvedValue({ total: 1, failed: 0, successful: 1 })

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.bulkIndexMessages([
      baseMessage,
      { ...baseMessage, id: 'msg-2', searchText: null }
    ])

    expect(mockBulk).toHaveBeenCalledTimes(1)
    const options = mockBulk.mock.calls[0][0]
    expect(options.datasource).toEqual([baseMessage])
    expect(options.onDocument(baseMessage)).toEqual({
      index: { _index: 'exodus-messages', _id: 'msg-1' }
    })
  })

  it('skips the bulk call entirely when there is nothing to index', async () => {
    mockBulk.mockClear()

    const provider = createElasticsearchProvider({
      url: 'http://localhost:9200'
    })
    await provider.bulkIndexMessages([{ ...baseMessage, searchText: null }])

    expect(mockBulk).not.toHaveBeenCalled()
  })
})
