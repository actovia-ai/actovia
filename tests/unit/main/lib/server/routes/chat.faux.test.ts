// The chat route through the real kernel on pi's faux provider: a send that
// runs a tool call and answers, as SSE, with every message stamped with the
// run's id and the rows persisted once. Collaborators that reach the database,
// the job queue or the network are mocked; the kernel is not.
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

/** What the mocked LCM hands the route; a test can put a history in it. */
const lcmState = vi.hoisted(() => ({
  assembled: { messages: [], runHeads: [], kinds: [] } as {
    messages: unknown[]
    runHeads: (string | null)[]
    kinds: ('summary' | 'message')[]
  }
}))
vi.mock('@main/lib/ai/context-management', () => ({
  trackContextMessages: vi.fn(async () => {}),
  contextTokens: vi.fn(async () => 0),
  freshTailRuns: () => 6,
  LcmManager: class {
    // The window and mark the real LcmManager settles on (128k fallback).
    readonly contextWindow: number
    readonly tokenBudget: number
    constructor(
      _chatId: string,
      _model: unknown,
      _apiKey: string,
      o: { contextWindow?: number; contextWindowPercent?: number } = {}
    ) {
      this.contextWindow =
        o.contextWindow && o.contextWindow > 0 ? o.contextWindow : 128_000
      this.tokenBudget = Math.floor(
        (this.contextWindow * (o.contextWindowPercent ?? 75)) / 100
      )
    }
    trackNewMessages = vi.fn(async () => {})
    assembleContext = vi.fn(async () => lcmState.assembled)
    compactAfterTurn = vi.fn(async () => {})
  }
}))
vi.mock('@main/lib/ai/mcp', () => ({ getMcpTools: vi.fn(async () => []) }))
vi.mock('@main/lib/ai/memory/manager', () => ({
  loadRelevantMemories: vi.fn(async () => []),
  loadRunMemoryBlocks: vi.fn(async () => new Map())
}))
vi.mock('@main/lib/ai/prompts', () => ({
  buildPersonalityPrompt: vi.fn(() => ''),
  deepResearchBootPrompt: 'DEEP_RESEARCH_BOOT',
  getSystemPrompt: vi.fn(() => 'SYSTEM')
}))
vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  getActiveSkillsIndex: vi.fn(async () => '')
}))

const weather: AgentTool = {
  name: 'weather',
  label: 'Weather',
  description: 'test',
  parameters: Type.Object({ location: Type.String() }),
  execute: async (_id, { location }) => ({
    content: [{ type: 'text', text: `sunny in ${location}` }],
    details: { location }
  })
}
const getModelFromProviderMock = vi.fn()
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => [weather],
  generateTitleFromUserMessage: vi.fn(async () => 'A title'),
  getModelFromProvider: (...args: unknown[]) =>
    getModelFromProviderMock(...args),
  getTextFromMessage: vi.fn((m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : ''
  )
}))
const saveMessages = vi.fn(async () => {})
/** The chat's context snapshot column, by chat id (ISSUE-235). */
const snapshots = new Map<string, unknown>()
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
  getChatById: vi.fn(async () => ({ id: 'existing' })),
  getChatContextSnapshot: vi.fn(
    async (id: string) => snapshots.get(id) ?? null
  ),
  saveChatContextSnapshot: vi.fn(async (id: string, snapshot: unknown) => {
    snapshots.set(id, snapshot)
  }),
  getMessagesByChatId: vi.fn(async () => []),
  saveChat: vi.fn(async () => {}),
  saveMessages: (...args: unknown[]) => saveMessages(...(args as [])),
  updateChat: vi.fn(async () => {}),
  updateChatTitleById: vi.fn(async () => {})
}))
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess: vi.fn(async () => {}),
  logEnqueueFailure: vi.fn()
}))
vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
}))
const { default: chat } = await import('@main/lib/server/routes/chat')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')
const { enqueueAndProcess } = await import('@main/lib/jobs/worker')
const { SETTINGS_SECRET_PATHS } = await import('@main/lib/secrets/registry')
const { registerFauxProvider } = await import('@main/lib/ai/kernel/faux')
const { loadRelevantMemories, loadRunMemoryBlocks } =
  await import('@main/lib/ai/memory/manager')
const { getMessagesByChatId } = await import('@main/lib/db/queries')

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function buildApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: true, autoCapture: true, useInChat: false }
    } as never)
    await next()
  })
  app.route('/', chat)
  return app
}

/** Same as `buildApp()`, with LCM off: the context is the history itself. */
function buildAppLcmOff() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: false, autoCapture: true, useInChat: false }
    } as never)
    await next()
  })
  app.route('/', chat)
  return app
}

/** Same as `buildApp()`, but with "use memory in chat" on — for the
 *  `memories_used` SSE event tests, which need `loadRelevantMemories` to
 *  actually be called. */
function buildAppMemoryOn() {
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

function sseEvents(
  body: string
): Array<Record<string, unknown> & { type: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)))
}

beforeEach(() => {
  saveMessages.mockClear()
  snapshots.clear()
  vi.mocked(loadRelevantMemories).mockReset().mockResolvedValue([])
})

describe('POST /api/v1/chat on the faux provider', () => {
  it('streams a tool run as SSE, every message stamped with the run id, and persists once', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([fauxText('Sunny.')])
    ])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })

    const response = await buildApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [
          {
            id: USER_ID,
            role: 'user',
            content: 'weather in Oslo',
            timestamp: 1
          }
        ],
        advancedTools: []
      })
    })
    const events = sseEvents(await response.text())

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'message_update',
        'tool_call_start',
        'tool_call_end',
        'done'
      ])
    )
    expect(events.some((e) => e.type === 'error')).toBe(false)

    const done = events.find((e) => e.type === 'done') as {
      messages: Array<{ role: string; runId: string; content: unknown }>
    }
    expect(done.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant'
    ])
    expect(done.messages.every((m) => m.runId === USER_ID)).toBe(true)
    expect(done.messages[2].content).toEqual([
      { type: 'text', text: 'sunny in Oslo' }
    ])
    expect(done.messages[3].content).toEqual([{ type: 'text', text: 'Sunny.' }])

    // The user row, then the run's three rows, each with the run id.
    expect(saveMessages).toHaveBeenCalledTimes(2)
    const runRows = (
      saveMessages.mock.calls[1] as unknown as [
        { messages: Array<{ runId: string; role: string }> }
      ]
    )[0].messages
    expect(runRows.map((r) => r.role)).toEqual([
      'assistant',
      'toolResult',
      'assistant'
    ])
    expect(runRows.every((r) => r.runId === USER_ID)).toBe(true)
  })

  it('sends memories_used as the first SSE event, stamped with the run id, when the read filter selected a memory', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Sunny.')])])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })
    vi.mocked(loadRelevantMemories).mockResolvedValue([
      { id: 'mem-1', key: 'Classical Music', section: 'topic' } as never
    ])

    const response = await buildAppMemoryOn().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
        advancedTools: []
      })
    })
    const events = sseEvents(await response.text())

    expect(events[0]).toEqual({
      type: 'memories_used',
      runId: USER_ID,
      memories: [{ id: 'mem-1', key: 'Classical Music', section: 'topic' }]
    })
  })

  // The memory chosen for a message used to close the system prompt — chosen
  // afresh every message, so the prompt cache (tools → system → messages)
  // missed on every turn (2026-10-01). Each run now carries its own block.
  it('puts each run’s memory before its question, never in the system prompt', async () => {
    const OLD_RUN = '33333333-3333-4333-8333-333333333333'
    const faux = registerFauxProvider()
    let seen: { system?: string; messages: unknown[] } = { messages: [] }
    faux.setResponses([
      (ctx) => {
        // pi 1.0: the system prompt is the transcript's leading system message.
        const lead = ctx.messages.find((m) => m.role === 'system')
        seen = {
          system: typeof lead?.content === 'string' ? lead.content : undefined,
          messages: ctx.messages
        }
        return fauxAssistantMessage([fauxText('Sunny.')])
      }
    ])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })
    vi.mocked(loadRelevantMemories).mockResolvedValue([
      {
        id: 'mem-1',
        key: 'Classical Music',
        section: 'topic',
        summary: 'Into Bach',
        details: [],
        isActive: true
      } as never
    ])
    vi.mocked(loadRunMemoryBlocks).mockResolvedValue(
      new Map([[OLD_RUN, '<user_memory>OLD RUN MEMORY</user_memory>']])
    )
    // The assembled history ends with this run's own question (the route
    // drops it and sends the prompt itself); the run before it is OLD_RUN.
    lcmState.assembled = {
      messages: [
        { role: 'user', content: 'earlier question', timestamp: 0 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'earlier answer' }],
          api: 'a',
          provider: 'p',
          model: 'm',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: 0
        },
        { role: 'user', content: 'hi', timestamp: 1 }
      ],
      runHeads: [OLD_RUN, null, USER_ID]
    }

    const app = buildAppMemoryOn()
    await (
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: CHAT_ID,
          messages: [
            { id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }
          ],
          advancedTools: []
        })
      })
    ).text()

    expect(seen.system).toBe('SYSTEM')
    const users = seen.messages.filter(
      (m) => (m as { role: string }).role === 'user'
    ) as Array<{ content: Array<{ type: string; text: string }> }>
    expect(users).toHaveLength(2)
    expect(users[0].content[0].text).toBe(
      '<user_memory>OLD RUN MEMORY</user_memory>'
    )
    expect(users[0].content[1].text).toBe('earlier question')
    expect(users[1].content[0].text).toContain('## Classical Music (topic)')
    expect(users[1].content.at(-1)?.text).toBe('hi')
    lcmState.assembled = { messages: [], runHeads: [] }
  })

  // The server owns the conversation (spec 2026-10-01 §C1): a client sends
  // what is new, and the model's context is read from the database — not
  // from whatever history a client posts.
  describe('history is the server’s', () => {
    const OLD_RUN = '44444444-4444-4444-8444-444444444444'
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
    const stored = [
      {
        id: OLD_RUN,
        chatId: CHAT_ID,
        runId: OLD_RUN,
        role: 'user',
        content: 'stored question',
        createdAt: new Date(1000)
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        chatId: CHAT_ID,
        runId: OLD_RUN,
        role: 'assistant',
        content: [{ type: 'text', text: 'stored answer' }],
        usage,
        api: 'a',
        provider: 'p',
        model: 'm',
        stopReason: 'stop',
        createdAt: new Date(2000)
      }
    ]

    async function send(body: Record<string, unknown>) {
      const faux = registerFauxProvider()
      let seen: unknown[] = []
      faux.setResponses([
        (ctx) => {
          // The conversation only: pi 1.0 leads the transcript with the
          // system message, which these cases do not compare.
          seen = ctx.messages.filter((m) => m.role !== 'system')
          return fauxAssistantMessage([fauxText('Sunny.')])
        }
      ])
      getModelFromProviderMock.mockReturnValue({
        model: faux.getModel(),
        apiKey: 'k'
      })
      vi.mocked(getMessagesByChatId).mockResolvedValue(stored as never)
      const response = await buildAppLcmOff().request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: CHAT_ID, advancedTools: [], ...body })
      })
      const events = sseEvents(await response.text())
      vi.mocked(getMessagesByChatId).mockResolvedValue([])
      return { seen, events, status: response.status }
    }

    const texts = (messages: unknown[]) =>
      messages.map((m) => {
        const c = (m as { content: unknown }).content
        return typeof c === 'string'
          ? c
          : (c as Array<{ text?: string }>).map((p) => p.text ?? '').join('')
      })

    it('takes the context from the database, not from what was posted', async () => {
      const { seen } = await send({
        messages: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            role: 'user',
            content: 'a history the client made up',
            timestamp: 1
          },
          { id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }
        ]
      })
      expect(texts(seen)).toEqual(['stored question', 'stored answer', 'hi'])
    })

    it('takes a send that carries only the new message', async () => {
      const { seen, status } = await send({
        message: { id: USER_ID, role: 'user', content: 'hi' }
      })
      expect(status).toBe(200)
      expect(texts(seen)).toEqual(['stored question', 'stored answer', 'hi'])
    })

    // A client that says protocol 2 merges: `done` carries this run and the
    // stored regenerate states, not the whole conversation again.
    it('answers protocol 2 with the run and the attempt states only', async () => {
      const { events } = await send({
        message: { id: USER_ID, role: 'user', content: 'hi' },
        protocol: 2
      })
      const done = events.find((e) => e.type === 'done') as {
        messages: Array<{ role: string; runId: string }>
        attempts: Record<string, unknown>
      }
      expect(done.messages.every((m) => m.runId === USER_ID)).toBe(true)
      expect(done.messages.some((m) => m.role === 'user')).toBe(true)
      expect(done.attempts).toEqual({})
    })

    // An old client still gets the whole conversation back — now read from
    // the database.
    it('echoes the whole conversation to a client that does not say', async () => {
      const { events } = await send({
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }]
      })
      const done = events.find((e) => e.type === 'done') as {
        messages: Array<{ id: string }>
      }
      expect(done.messages[0].id).toBe(OLD_RUN)
    })
  })

  // Every read orders by createdAt; a phone whose clock is off sorted its
  // question before earlier answers (audit, 2026-10-01).
  it('stamps the question with the server’s clock, not the client’s', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Sunny.')])])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })
    const before = Date.now()
    await (
      await buildApp().request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: CHAT_ID,
          messages: [
            { id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }
          ],
          advancedTools: []
        })
      })
    ).text()
    const rows = saveMessages.mock.calls.flatMap(
      (call) =>
        (
          call as unknown as [{ messages: { id: string; createdAt: Date }[] }]
        )[0].messages
    )
    const question = rows.find((r) => r.id === USER_ID)
    expect(question?.createdAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('in Deep Research mode runs no read filter and sends no memories_used — its prompt carries no memories', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Researching.')])])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })
    vi.mocked(loadRelevantMemories).mockResolvedValue([
      { id: 'mem-1', key: 'Classical Music', section: 'topic' } as never
    ])

    const response = await buildAppMemoryOn().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
        advancedTools: ['Deep Research']
      })
    })
    const events = sseEvents(await response.text())

    // No read filter means no usage-log rows and no lastUsedAt bump either —
    // those happen inside loadRelevantMemories.
    expect(loadRelevantMemories).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'memories_used')).toBe(false)
  })

  it('sends no memories_used event when the read filter selected nothing', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Sunny.')])])
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: 'k'
    })
    vi.mocked(loadRelevantMemories).mockResolvedValue([])

    const response = await buildAppMemoryOn().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
        advancedTools: []
      })
    })
    const events = sseEvents(await response.text())

    expect(events.some((e) => e.type === 'memories_used')).toBe(false)
  })

  // Ledger ruling R3: pgmq rows live in PGlite (and a job given up on is
  // archived until the next launch), so a job payload must carry no key —
  // the handler reads it from settings when it runs.
  it('enqueues post-run jobs whose payloads carry no registry secret', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Hi.')])])
    const secret = (path: string) => `sk-${path}-DO-NOT-QUEUE-0000`
    const settings: Record<string, unknown> = {
      id: 'settings-1',
      memory: { lcmEnabled: true, autoCapture: true, useInChat: false }
    }
    for (const path of SETTINGS_SECRET_PATHS) {
      const keys = path.split('.')
      let o = settings
      for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as typeof o
      o[keys.at(-1)!] = secret(path)
    }
    getModelFromProviderMock.mockReturnValue({
      model: faux.getModel(),
      apiKey: secret('providers.openaiApiKey')
    })
    vi.mocked(enqueueAndProcess).mockClear()

    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('settings', settings as never)
      await next()
    })
    app.route('/', chat)
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
        advancedTools: []
      })
    })
    await response.text()

    const calls = vi.mocked(enqueueAndProcess).mock.calls as unknown[][]
    expect(calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['lcm-post-turn', 'memory-consolidate'])
    )
    const queued = JSON.stringify(calls.map((c) => c[1]))
    expect(queued).not.toContain('apiKey')
    for (const path of SETTINGS_SECRET_PATHS) {
      expect(queued).not.toContain(secret(path))
    }
  })
})

// What fills the chat's context (ISSUE-235): measured before the run, saved
// with it, served by GET /:id/context.
describe('GET /api/v1/chat/:id/context', () => {
  async function send(
    app: Hono,
    contextWindow: number,
    guessed = false
  ): Promise<Record<string, unknown>> {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('Sunny.')])])
    getModelFromProviderMock.mockReturnValue({
      model: {
        ...faux.getModel(),
        contextWindow,
        ...(guessed ? { contextWindowGuessed: true } : {})
      },
      apiKey: 'k'
    })
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CHAT_ID,
        messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
        advancedTools: []
      })
    })
    await response.text()
    const res = await app.request(`/${CHAT_ID}/context`)
    expect(res.status).toBe(200)
    return (await res.json()) as Record<string, unknown>
  }

  it('is a 404 for a chat that has run nothing', async () => {
    const res = await buildApp().request(`/${CHAT_ID}/context`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).toContain('CONTEXT_NOT_FOUND')
  })

  it('serves every part in order, with the compaction mark under LCM', async () => {
    const snapshot = await send(buildApp(), 200_000)
    expect((snapshot.parts as { key: string }[]).map((p) => p.key)).toEqual([
      'system',
      'skills',
      'mcp',
      'tools',
      'memory',
      'summaries',
      'messages'
    ])
    expect(snapshot).toMatchObject({
      runId: USER_ID,
      contextWindow: 200_000,
      compactAt: 150_000
    })
    const sum = (snapshot.parts as { tokens: number }[]).reduce(
      (n, p) => n + p.tokens,
      0
    )
    expect(sum).toBe(snapshot.total)
    expect(sum).toBeGreaterThan(0)
  })

  it('has no compaction mark with LCM off', async () => {
    expect(await send(buildAppLcmOff(), 200_000)).toMatchObject({
      compactAt: null
    })
  })

  // The mark is where LCM compacts: with no window of its own, LCM keeps
  // its 128k fallback, so "Compaction is off" would be untrue.
  it("marks LCM's fallback for a model that reports no window", async () => {
    expect(await send(buildApp(), 0)).toMatchObject({
      contextWindow: 128_000,
      compactAt: 96_000
    })
  })

  it("marks LCM's fallback for a window that is only a guess", async () => {
    expect(await send(buildApp(), 1_050_000, true)).toMatchObject({
      contextWindow: 128_000,
      compactAt: 96_000
    })
  })

  it('has no window and no mark with LCM off and no window known', async () => {
    expect(await send(buildAppLcmOff(), 1_050_000, true)).toMatchObject({
      contextWindow: 0,
      compactAt: null
    })
  })
})
