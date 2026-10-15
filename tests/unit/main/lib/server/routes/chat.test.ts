// src/main/lib/server/routes/chat.ts
//
// The route's own job — validate, build the run, map kernel events onto SSE,
// persist however it ends — with the kernel (`runAgent`) mocked to a scripted
// event stream. The kernel itself is tested in tests/unit/main/lib/ai/kernel/,
// and chat.faux.test.ts drives this route through the real kernel on pi's
// faux provider. The route is wrapped in a bare Hono app and driven with
// app.request(), the pattern of middlewares/trace.test.ts.
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const runAgentMock = vi.fn()
vi.mock('@main/lib/ai/kernel/run', () => ({
  runAgent: (...args: unknown[]) => runAgentMock(...args)
}))

vi.mock('@main/lib/ai/context-management', () => ({
  trackContextMessages: vi.fn(async () => {}),
  freshTailRuns: () => 6,
  LcmManager: class {
    trackNewMessages = vi.fn(async () => {})
    assembleContext = vi.fn(async () => ({ messages: [] }))
    compactAfterTurn = vi.fn(async () => {})
  }
}))

vi.mock('@main/lib/ai/mcp', () => ({
  getMcpTools: vi.fn(async () => [])
}))

vi.mock('@main/lib/ai/memory/manager', () => ({
  loadRunMemoryBlocks: vi.fn(async () => new Map()),
  loadRelevantMemories: vi.fn(async () => [])
}))

vi.mock('@main/lib/ai/prompts', () => ({
  buildPersonalityPrompt: vi.fn(() => ''),
  deepResearchBootPrompt: 'DEEP_RESEARCH_BOOT',
  getSystemPrompt: vi.fn(() => 'SYSTEM')
}))

vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  getActiveSkillsIndex: vi.fn(async () => '')
}))

const getModelFromProviderMock = vi.fn()
const bindCallingToolsMock = vi.fn(() => [])
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: (...args: unknown[]) => bindCallingToolsMock(...args),
  generateTitleFromUserMessage: vi.fn(async () => 'A title'),
  getModelFromProvider: (...args: unknown[]) =>
    getModelFromProviderMock(...args),
  getTextFromMessage: vi.fn((m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : ''
  )
}))

vi.mock('@main/lib/ai/utils/cost', () => ({
  calculateCost: vi.fn(() => ({ total: 0 }))
}))

// Regenerate-group transitions (lib/chat/attempts.ts) are tested on a real
// PGlite in attempts.test.ts; no run here is a regenerate.
vi.mock('@main/lib/chat/attempts', () => ({
  applyAttempts: (messages: unknown[]) => messages,
  chooseAttempt: vi.fn(),
  getChatAttempts: vi.fn(async () => ({})),
  recordRegenerate: vi.fn(async () => {}),
  settleOpenComparison: vi.fn(async () => {})
}))
vi.mock('@main/lib/chat/sources', () => ({
  highestSourceRank: () => Promise.resolve(0),
  saveChatSources: () => Promise.resolve(),
  sourcesOfRows: () => []
}))
vi.mock('@main/lib/db/queries', () => ({
  deleteChatById: vi.fn(async () => {}),
  getChatById: vi.fn(async () => null),
  getMessagesByChatId: vi.fn(async () => []),
  saveChat: vi.fn(async () => {}),
  saveMessages: vi.fn(async () => {}),
  searchChats: vi.fn(async () => []),
  updateChat: vi.fn(async () => {}),
  updateChatTitleById: vi.fn(async () => {})
}))

const enqueueAndProcessMock = vi.fn(async () => {})
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess: (...args: unknown[]) => enqueueAndProcessMock(...args),
  logEnqueueFailure: vi.fn()
}))

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
}))

const removeChatMediaMock = vi.fn(async () => {})
vi.mock('@main/lib/media/store', () => ({
  removeChatMedia: (...args: unknown[]) => removeChatMediaMock(...args)
}))

const { default: chat } = await import('@main/lib/server/routes/chat')
const { saveMessages, searchChats } = await import('@main/lib/db/queries')
const saveMessagesMock = vi.mocked(saveMessages)

const FAKE_MODEL = { id: 'fake-model', cost: { input: 1, output: 2 } }
const CHAT_ID = '11111111-1111-4111-8111-111111111111'

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: true, autoCapture: true, useInChat: true }
    } as never)
    await next()
  })
  app.route('/', chat)
  return app
}

const RUN_ID = 'u1'

function fakeRun(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    }
  }
}

function assistant(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'a1',
    runId: RUN_ID,
    role: 'assistant',
    content: [{ type: 'text', text: 'partial answer' }],
    usage: { input: 1, output: 1, totalTokens: 2 },
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-x',
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides
  }
}

/** A run that answers "Hello world" in one step. */
function successfulRun() {
  const message = assistant({
    content: [{ type: 'text', text: 'Hello world' }]
  })
  return fakeRun([
    { type: 'message_end', runId: RUN_ID, message },
    { type: 'run_end', runId: RUN_ID, messages: [message], durationMs: 10 }
  ])
}

/** Rows handed to saveMessages for the assistant side of the turn. */
function savedAssistantRows() {
  return saveMessagesMock.mock.calls
    .flatMap(([arg]) => arg.messages)
    .filter((row) => row.role === 'assistant')
}

function sseEvents(body: string): Array<{ type: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)))
}

function postChat(body: Record<string, unknown>) {
  const app = buildApp()
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: CHAT_ID,
      messages: [{ id: 'u1', role: 'user', content: 'hi' }],
      advancedTools: [],
      ...body
    })
  })
}

describe('POST /api/v1/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelFromProviderMock.mockReturnValue({
      model: FAKE_MODEL,
      apiKey: 'test-key'
    })
    runAgentMock.mockReturnValue(successfulRun())
  })

  it('passes reasoningEffort through to the kernel as the reasoning level', async () => {
    const response = await postChat({ reasoningEffort: 'high' })
    await response.text() // drain the SSE stream so start() finishes

    expect(runAgentMock).toHaveBeenCalledTimes(1)
    const input = runAgentMock.mock.calls[0][0]
    expect(input).toMatchObject({
      chatId: CHAT_ID,
      model: FAKE_MODEL,
      apiKey: 'test-key',
      reasoning: 'high',
      userMessage: { id: RUN_ID, runId: RUN_ID, role: 'user' }
    })
  })

  it('omits reasoning when reasoningEffort is "off"', async () => {
    const response = await postChat({ reasoningEffort: 'off' })
    await response.text()

    const input = runAgentMock.mock.calls[0][0]
    expect(input.reasoning).toBeUndefined()
  })

  it('omits reasoning when reasoningEffort is absent', async () => {
    const response = await postChat({})
    await response.text()

    const input = runAgentMock.mock.calls[0][0]
    expect(input.reasoning).toBeUndefined()
  })

  it('passes reasoningEffort "max" through (a ThinkingLevel since pi 0.85)', async () => {
    const response = await postChat({ reasoningEffort: 'max' })
    await response.text()

    const input = runAgentMock.mock.calls[0][0]
    expect(input.reasoning).toBe('max')
  })

  it('forces reasoning "high" for Deep Research regardless of reasoningEffort', async () => {
    const response = await postChat({
      advancedTools: ['Deep Research'],
      reasoningEffort: 'off'
    })
    await response.text()

    const input = runAgentMock.mock.calls[0][0]
    expect(input.reasoning).toBe('high')
  })

  // No `apiKey` in either payload (ledger ruling R3): the handler reads the
  // key from settings when the job runs.
  it('enqueues lcm-post-turn and memory-consolidate payloads with the renamed model field and no key', async () => {
    const response = await postChat({ reasoningEffort: 'low' })
    await response.text()

    const lcmCall = enqueueAndProcessMock.mock.calls.find(
      (c) => c[0] === 'lcm-post-turn'
    )
    const memoryCall = enqueueAndProcessMock.mock.calls.find(
      (c) => c[0] === 'memory-consolidate'
    )
    expect(lcmCall?.[1]).toMatchObject({ model: FAKE_MODEL })
    expect(lcmCall?.[1]).not.toHaveProperty('chatModel')
    expect(lcmCall?.[1]).not.toHaveProperty('apiKey')
    expect(memoryCall?.[1]).toMatchObject({ model: FAKE_MODEL })
    expect(memoryCall?.[1]).not.toHaveProperty('chatModel')
    expect(memoryCall?.[1]).not.toHaveProperty('apiKey')
  })

  describe('saving the run', () => {
    it('saves the steps that finished when a later step fails, and still reports the error', async () => {
      const stepOne = assistant({
        content: [{ type: 'text', text: 'step one' }]
      })
      runAgentMock.mockReturnValue(
        fakeRun([
          { type: 'message_end', runId: RUN_ID, message: stepOne },
          {
            type: 'run_end',
            runId: RUN_ID,
            messages: [stepOne],
            durationMs: 5
          },
          { type: 'error', runId: RUN_ID, error: 'provider 500' }
        ])
      )

      const response = await postChat({})
      const events = sseEvents(await response.text())

      expect(events.map((e) => e.type)).toContain('error')
      const rows = savedAssistantRows()
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows[0].content)).toContain('step one')
      expect(rows[0]).toMatchObject({ runId: RUN_ID, durationMs: 5 })
      // LCM must learn about what was saved, or its context drifts from the DB.
      expect(
        enqueueAndProcessMock.mock.calls.some((c) => c[0] === 'lcm-post-turn')
      ).toBe(true)
    })

    it('keeps the partial answer of a stopped run', async () => {
      const partial = assistant({ stopReason: 'aborted' })
      runAgentMock.mockReturnValue(
        fakeRun([
          { type: 'run_end', runId: RUN_ID, messages: [partial], durationMs: 5 }
        ])
      )

      const response = await postChat({})
      const events = sseEvents(await response.text())

      expect(events.map((e) => e.type)).not.toContain('error')
      const rows = savedAssistantRows()
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows[0].content)).toContain('partial answer')
    })

    it('a run that produced nothing saves nothing and is not an error', async () => {
      runAgentMock.mockReturnValue(
        fakeRun([
          { type: 'run_end', runId: RUN_ID, messages: [], durationMs: 1 }
        ])
      )

      const response = await postChat({})
      const events = sseEvents(await response.text())

      expect(events.map((e) => e.type)).not.toContain('error')
      expect(savedAssistantRows()).toHaveLength(0)
    })

    it('maps a tool step onto tool_call_start / message_update / tool_call_end, with the notice', async () => {
      const call = assistant({
        id: 'a1',
        stopReason: 'toolUse',
        content: [
          { type: 'toolCall', id: 'c1', name: 'weather', arguments: {} }
        ]
      })
      const result = {
        id: 't1',
        runId: RUN_ID,
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'weather',
        content: [{ type: 'text', text: 'sunny' }],
        details: { notice: { level: 'warning', message: 'key expiring' } },
        isError: false,
        timestamp: Date.now()
      }
      const answer = assistant({
        id: 'a2',
        content: [{ type: 'text', text: 'Sunny.' }]
      })
      runAgentMock.mockReturnValue(
        fakeRun([
          { type: 'message_end', runId: RUN_ID, message: call },
          {
            type: 'tool_start',
            runId: RUN_ID,
            toolCallId: 'c1',
            toolName: 'weather',
            messageId: 't1'
          },
          { type: 'tool_end', runId: RUN_ID, message: result },
          { type: 'message_end', runId: RUN_ID, message: answer },
          {
            type: 'run_end',
            runId: RUN_ID,
            messages: [call, result, answer],
            durationMs: 7
          }
        ])
      )

      const response = await postChat({})
      const events = sseEvents(await response.text())

      expect(events.map((e) => e.type)).toEqual([
        'tool_call_start',
        'message_update',
        'notice',
        'tool_call_end',
        'title', // a new chat: its title is generated in the background
        'done'
      ])
      const done = events.at(-1) as {
        messages: Array<{ runId?: string; role: string }>
      }
      expect(done.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'toolResult',
        'assistant'
      ])
      expect(done.messages.every((m) => m.runId === RUN_ID)).toBe(true)
      expect(savedAssistantRows()).toHaveLength(2)
    })

    it('still saves the run when the client has hung up (Stop cancels the response stream)', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const partial = assistant({ stopReason: 'aborted' })
      runAgentMock.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message_update',
            runId: RUN_ID,
            message: assistant({ stopReason: 'pending' })
          }
          await gate
          yield {
            type: 'run_end',
            runId: RUN_ID,
            messages: [partial],
            durationMs: 3
          }
        }
      })

      const response = await postChat({})
      const reader = response.body!.getReader()
      await reader.read() // first frame arrived — the run is streaming
      await reader.cancel()
      release()

      await vi.waitFor(() => expect(savedAssistantRows()).toHaveLength(1))
    })
  })
})

describe('DELETE /api/v1/chat/:id', () => {
  it('removes the chat’s generated media along with its rows', async () => {
    const { deleteChatById } = await import('@main/lib/db/queries')
    removeChatMediaMock.mockClear()
    const res = await buildApp().request(`/${CHAT_ID}`, { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(vi.mocked(deleteChatById)).toHaveBeenCalledWith({ id: CHAT_ID })
    expect(removeChatMediaMock).toHaveBeenCalledWith(CHAT_ID)
  })
})

describe('GET /api/v1/chat/search', () => {
  it('answers the one-row-per-chat results for the query, as they are', async () => {
    const results = [
      {
        chatId: CHAT_ID,
        title: 'Peking duck',
        matchedAt: '2026-10-14T00:00:00.000Z',
        snippets: [
          {
            messageId: 'm1',
            role: 'assistant',
            text: '…the best 北京烤鸭 in town',
            createdAt: '2026-10-14T00:00:00.000Z'
          }
        ]
      }
    ]
    vi.mocked(searchChats).mockResolvedValueOnce(results as never)

    const res = await buildApp().request(
      `/search?query=${encodeURIComponent('北京 duck')}`
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(results)
    expect(vi.mocked(searchChats)).toHaveBeenCalledWith('北京 duck')
  })

  it('passes a missing query on as empty', async () => {
    vi.mocked(searchChats).mockResolvedValueOnce([])

    const res = await buildApp().request('/search')

    expect(await res.json()).toEqual([])
    expect(vi.mocked(searchChats)).toHaveBeenLastCalledWith('')
  })
})
