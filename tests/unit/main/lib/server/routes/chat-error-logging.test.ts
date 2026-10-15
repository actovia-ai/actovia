// What the chat route logs when a run fails: the Error it caught, so the log
// carries the stack — and, where the message may quote a conversation (a
// failed write), the frames alone. What the client is sent does not change.
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

const error = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
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
vi.mock('@main/lib/ai/mcp', () => ({ getMcpTools: vi.fn(async () => []) }))
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
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => [],
  generateTitleFromUserMessage: vi.fn(async () => 'A title'),
  getModelFromProvider: () => ({
    model: { id: 'm', provider: 'faux', api: 'faux' },
    apiKey: 'k'
  }),
  getTextFromMessage: vi.fn((m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : ''
  )
}))
vi.mock('@main/lib/chat/attempts', () => ({
  applyAttempts: (messages: unknown[]) => messages,
  chooseAttempt: vi.fn(),
  getChatAttempts: vi.fn(async () => ({})),
  recordRegenerate: vi.fn(async () => {}),
  resolveRegenerateGroup: vi.fn(async () => null),
  settleOpenComparison: vi.fn(async () => {})
}))
const saveMessages = vi.fn<(arg: unknown) => Promise<void>>(async () => {})
vi.mock('@main/lib/chat/sources', () => ({
  highestSourceRank: () => Promise.resolve(0),
  saveChatSources: () => Promise.resolve(),
  sourcesOfRows: () => []
}))
vi.mock('@main/lib/db/queries', () => ({
  deleteChatById: vi.fn(async () => {}),
  getChatById: vi.fn(async () => ({ id: 'existing' })),
  getMessagesByChatId: vi.fn(async () => []),
  saveChat: vi.fn(async () => {}),
  saveMessages: (arg: unknown) => saveMessages(arg),
  updateChat: vi.fn(async () => {}),
  updateChatTitleById: vi.fn(async () => {})
}))
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess: vi.fn(async () => {}),
  logEnqueueFailure: vi.fn()
}))
// The kernel is scripted: each test says what the run yields or throws.
const runAgent = vi.fn()
vi.mock('@main/lib/ai/kernel/run', () => ({
  runAgent: (...args: unknown[]) => runAgent(...args)
}))

const { default: chat } = await import('@main/lib/server/routes/chat')

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function send() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: false, autoCapture: false, useInChat: false }
    } as never)
    await next()
  })
  app.route('/', chat)
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: CHAT_ID,
      messages: [{ id: USER_ID, role: 'user', content: 'hi', timestamp: 1 }],
      advancedTools: []
    })
  })
}

function sseEvents(
  body: string
): Array<Record<string, unknown> & { type: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)))
}

const loggedAs = (message: string) =>
  error.mock.calls.find(([, m]) => m === message) as
    | [string, string, Record<string, unknown>]
    | undefined

beforeEach(() => {
  error.mockClear()
  runAgent.mockReset()
  saveMessages.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/v1/chat — a run that throws', () => {
  it('logs the Error it caught, and sends the client the message alone', async () => {
    const thrown = new TypeError(
      "Cannot read properties of undefined (reading 'totalTokens')"
    )
    runAgent.mockImplementation(async function* () {
      yield* []
      throw thrown
    })

    const events = sseEvents(await (await send()).text())

    const call = loggedAs('Chat stream error')
    expect(call).toBeDefined()
    expect(call![0]).toBe('chat')
    // The Error, not its message: the logger records the stack from it.
    expect(call![2].error).toBe(thrown)

    const sent = events.find((e) => e.type === 'error')
    expect(sent).toBeDefined()
    expect(typeof sent!.error).toBe('string')
    expect(JSON.stringify(events)).not.toContain('chat-error-logging.test.ts')
  })

  it('still logs what the kernel reported as a string', async () => {
    runAgent.mockImplementation(async function* () {
      yield { type: 'run_end', runId: USER_ID, messages: [], durationMs: 1 }
      yield { type: 'error', runId: USER_ID, error: '429 rate limited' }
    })
    await (await send()).text()
    expect(loggedAs('Chat stream error')![2]).toEqual({
      error: '429 rate limited'
    })
  })
})

describe('POST /api/v1/chat — a run that cannot be saved', () => {
  it('logs the error name and where it was thrown, never its message', async () => {
    runAgent.mockImplementation(async function* () {
      yield {
        type: 'run_end',
        runId: USER_ID,
        durationMs: 1,
        messages: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            runId: USER_ID,
            role: 'assistant',
            content: [{ type: 'text', text: 'the whole answer' }],
            stopReason: 'stop',
            timestamp: 2
          }
        ]
      }
    })
    // The user's row saves; the run's rows do not. A drizzle error quotes
    // the statement's parameters — here, the conversation.
    saveMessages.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
      const failed = new Error(
        'Failed query: insert into "message" …\nparams: the whole answer'
      )
      failed.name = 'DrizzleQueryError'
      return Promise.reject(failed)
    })

    await (await send()).text()

    const call = loggedAs('Failed to persist chat run')
    expect(call).toBeDefined()
    const detail = call![2]
    expect(detail.chatId).toBe(CHAT_ID)
    expect(detail.errorName).toBe('DrizzleQueryError')
    expect(detail['exception.stacktrace']).toMatch(/^ {4}at /u)
    expect(detail['exception.stacktrace']).toContain(
      'chat-error-logging.test.ts'
    )
    expect(detail).not.toHaveProperty('error')
    const written = JSON.stringify(detail)
    expect(written).not.toContain('the whole answer')
    expect(written).not.toContain('Failed query')
  })
})
