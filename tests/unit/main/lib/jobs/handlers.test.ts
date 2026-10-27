import type { Model } from '@earendil-works/pi-ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', () => ({ pglite: {}, db: {} }))

const mockGetSettings = vi.fn()
const mockGetMessagesByChatId = vi.fn()
vi.mock('@main/lib/db/queries', () => ({
  getSettings: mockGetSettings,
  getMessagesByChatId: mockGetMessagesByChatId
}))

const mockTrackContextMessages = vi.fn()
const mockCompactAfterTurn = vi.fn()
vi.mock('@main/lib/ai/context-management', () => ({
  trackContextMessages: mockTrackContextMessages,
  LcmManager: vi.fn().mockImplementation(function () {
    return { compactAfterTurn: mockCompactAfterTurn }
  })
}))

const mockRunMemoryConsolidation = vi.fn()
vi.mock('@main/lib/ai/memory/manager', () => ({
  runMemoryConsolidation: mockRunMemoryConsolidation
}))

const mockRunDiscoverRefresh = vi.fn()
vi.mock('@main/lib/discover/manager', () => ({
  runDiscoverRefresh: mockRunDiscoverRefresh
}))

const mockGetKnowledgeDocById = vi.fn()
const mockSetIndexStatus = vi.fn()
vi.mock('@main/lib/db/knowledge-queries', () => ({
  getKnowledgeDocById: mockGetKnowledgeDocById,
  setIndexStatus: mockSetIndexStatus
}))

const mockKbInsertText = vi.fn()
const mockKbDeleteDoc = vi.fn()
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: () => ({
    insertText: mockKbInsertText,
    deleteDoc: mockKbDeleteDoc
  })
}))
// contentHash (from knowledge-base/reconcile) is pure — use the real module.

const { handlers } = await import('@main/lib/jobs/handlers')

const fakeModel = {
  id: 'gpt-4.1-mini',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  contextWindow: 1_047_576
} as unknown as Model<string>

/** Settings whose OpenAI key the jobs resolve at run time (ruling R3). */
const withOpenAiKey = (over: Record<string, unknown> = {}) => ({
  id: 'global',
  providers: { openaiApiKey: 'sk-from-settings', ...over }
})

describe('handlers.lcm-post-turn', () => {
  beforeEach(() => {
    mockTrackContextMessages.mockReset().mockResolvedValue(undefined)
    mockCompactAfterTurn.mockReset().mockResolvedValue(undefined)
  })

  // The run's rows enter the context when they are saved (RunRecorder); the
  // job only compacts.
  it('compacts with the key from settings', async () => {
    mockGetSettings.mockResolvedValue(withOpenAiKey())
    const { LcmManager } = await import('@main/lib/ai/context-management')
    vi.mocked(LcmManager).mockClear()

    await handlers['lcm-post-turn']({
      chatId: 'chat-1',
      model: fakeModel,
      freshTailRuns: 6,
      contextWindowPercent: 75
    })

    expect(mockTrackContextMessages).not.toHaveBeenCalled()
    expect(mockCompactAfterTurn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(LcmManager).mock.calls[0][2]).toBe('sk-from-settings')
    // ISSUE-235: compaction measures against the model's own window.
    expect(vi.mocked(LcmManager).mock.calls[0][3]).toMatchObject({
      contextWindow: 1_047_576,
      contextWindowPercent: 75
    })
  })

  // A job an earlier build queued still carries its run: it is tracked —
  // with or without a key, since tracking needs none. Skipping it when the
  // key was gone left the run out of the context for good.
  it('tracks the run a job queued by an earlier build carries, key or not', async () => {
    mockGetSettings.mockResolvedValue(
      withOpenAiKey({ openaiBaseUrl: 'https://elsewhere.example.net/v1' })
    )
    await handlers['lcm-post-turn']({
      chatId: 'chat-1',
      model: fakeModel,
      freshTailRuns: 6,
      contextWindowPercent: 75,
      newMessages: [{ id: 'msg-1', content: 'hi' }]
    })
    expect(mockTrackContextMessages).toHaveBeenCalledWith('chat-1', [
      { id: 'msg-1', content: 'hi' }
    ])
    expect(mockCompactAfterTurn).not.toHaveBeenCalled()
  })
})

describe('handlers.memory-consolidate', () => {
  beforeEach(() => {
    mockRunMemoryConsolidation.mockReset().mockResolvedValue(undefined)
    mockGetMessagesByChatId.mockReset()
  })

  it('reads the conversation from the database when it runs', async () => {
    mockGetSettings.mockResolvedValue(withOpenAiKey())
    mockGetMessagesByChatId.mockResolvedValue([
      { role: 'user', content: 'hi', details: { big: true } },
      { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }
    ])

    await handlers['memory-consolidate']({
      chatId: 'chat-1',
      model: fakeModel
    })

    expect(mockGetMessagesByChatId).toHaveBeenCalledWith({ id: 'chat-1' })
    expect(mockRunMemoryConsolidation).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }
      ],
      fakeModel,
      'sk-from-settings'
    )
  })

  it('still takes the conversation a job queued by an earlier build carries', async () => {
    mockGetSettings.mockResolvedValue(withOpenAiKey())

    await handlers['memory-consolidate']({
      messages: [{ role: 'user', content: 'hi' }],
      model: fakeModel
    })

    expect(mockGetMessagesByChatId).not.toHaveBeenCalled()
    expect(mockRunMemoryConsolidation).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      fakeModel,
      'sk-from-settings'
    )
  })

  it('ignores a key a previous build left in the payload', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global', providers: {} })

    await handlers['memory-consolidate']({
      messages: [],
      model: fakeModel,
      apiKey: 'sk-stale-from-queue'
    })

    expect(mockRunMemoryConsolidation).not.toHaveBeenCalled()
  })
})

describe('handlers.kb-sync', () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetKnowledgeDocById.mockReset()
    mockSetIndexStatus.mockReset()
    mockKbInsertText.mockReset()
    mockKbDeleteDoc.mockReset()
  })

  it('inserts a new doc and marks it processing', async () => {
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: null,
      indexStatus: 'pending',
      lightragDocId: null
    })
    mockKbInsertText.mockResolvedValue({ trackId: 'txt_9' })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })

    expect(mockKbInsertText).toHaveBeenCalledWith('# T\n\nbody', 'd1')
    expect(mockSetIndexStatus).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        indexStatus: 'processing',
        lightragTrackId: 'txt_9'
      })
    )
  })

  it('deletes the old LightRAG doc before reinserting on content change', async () => {
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'new body',
      syncedHash: 'old-hash',
      indexStatus: 'processed',
      lightragDocId: 'ldoc-1'
    })
    mockKbInsertText.mockResolvedValue({ trackId: 'txt_10' })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })

    expect(mockKbDeleteDoc).toHaveBeenCalledWith('ldoc-1')
    expect(mockKbInsertText).toHaveBeenCalled()
  })

  it('is a no-op when the hash is unchanged and already processed', async () => {
    const { contentHash } = await import('@main/lib/knowledge-base/reconcile')
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: contentHash('T', 'body'),
      indexStatus: 'processed',
      lightragDocId: 'ldoc-1'
    })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })
    expect(mockKbInsertText).not.toHaveBeenCalled()
  })

  it('marks failed and rethrows when insertText throws', async () => {
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: null,
      indexStatus: 'pending',
      lightragDocId: null
    })
    mockKbInsertText.mockRejectedValue(new Error('down'))

    await expect(
      handlers['kb-sync']({ op: 'upsert', docId: 'd1' })
    ).rejects.toThrow('down')
    expect(mockSetIndexStatus).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ indexStatus: 'failed' })
    )
  })

  it('delete op calls deleteDoc and swallows errors', async () => {
    mockKbDeleteDoc.mockRejectedValue(new Error('404'))
    await expect(
      handlers['kb-sync']({ op: 'delete', lightragDocId: 'ldoc-x' })
    ).resolves.toBeUndefined()
  })
})

describe('handlers.discover-refresh', () => {
  it('forwards the force flag to runDiscoverRefresh', async () => {
    mockRunDiscoverRefresh.mockResolvedValue(undefined)
    await handlers['discover-refresh']({ force: true })
    expect(mockRunDiscoverRefresh).toHaveBeenCalledWith({ force: true })
  })

  it('treats an empty payload as force: undefined', async () => {
    mockRunDiscoverRefresh.mockResolvedValue(undefined)
    await handlers['discover-refresh']({})
    expect(mockRunDiscoverRefresh).toHaveBeenCalledWith({ force: undefined })
  })
})
