// The tool-approval gate end to end on the server: a faux run whose
// read_file call touches ~/.ssh streams `approval_required`, waits, and
// resumes on `POST /api/v1/chat/approval` — which a loopback caller without
// the app window's presence token (a `curl` run by the model) cannot use.
// Same mocks as chat.faux.test.ts; the kernel and the gates are real.
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

vi.mock('@main/lib/ai/context-management', () => ({
  contextTokens: vi.fn(async () => 0),
  trackContextMessages: vi.fn(async () => {}),
  freshTailRuns: () => 6,
  LcmManager: class {
    trackNewMessages = vi.fn(async () => {})
    assembleContext = vi.fn(async () => ({ messages: [] }))
    compactAfterTurn = vi.fn(async () => {})
  }
}))
vi.mock('@main/lib/ai/mcp', () => ({ getMcpTools: vi.fn(async () => []) }))
// Nothing here touches the database; a real PGlite booting in the background
// (pulled in transitively) intermittently failed to initialise under the
// parallel suite and surfaced as an unhandled rejection in this file.
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
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

const readFileExecute = vi.fn(async () => ({
  content: [{ type: 'text' as const, text: 'file contents' }],
  details: {}
}))
const readFile: AgentTool = {
  name: 'read_file',
  label: 'Read File',
  description: 'test',
  parameters: Type.Object({ path: Type.String() }),
  execute: readFileExecute as unknown as AgentTool['execute']
}
const getModelFromProviderMock = vi.fn()
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => [readFile],
  generateTitleFromUserMessage: vi.fn(async () => 'A title'),
  getModelFromProvider: (...args: unknown[]) =>
    getModelFromProviderMock(...args),
  getTextFromMessage: vi.fn((m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : ''
  )
}))
const saveMessages = vi.fn(async () => {})
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
const { registerFauxProvider } = await import('@main/lib/ai/kernel/faux')
const { errorHandler, presenceGate } =
  await import('@main/lib/server/middlewares')
const { getPresenceToken, PRESENCE_HEADER } = await import('@main/lib/presence')
const { pendingApprovalCount, resetApprovalsForTests } =
  await import('@main/lib/ai/kernel/pending-approvals')

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      memory: { lcmEnabled: true, autoCapture: true, useInChat: false }
    } as never)
    await next()
  })
  app.use('/api/*', presenceGate)
  app.route('/api/v1/chat', chat)
  app.onError(errorHandler)
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

function scriptSensitiveRead() {
  const faux = registerFauxProvider()
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('read_file', { path: '~/.ssh/id_rsa' }, { id: 'call_1' })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage([fauxText('Done.')])
  ])
  getModelFromProviderMock.mockReturnValue({
    model: faux.getModel(),
    apiKey: 'k'
  })
}

function send(app: Hono, signal?: AbortSignal) {
  return app.request('/api/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: CHAT_ID,
      messages: [
        { id: USER_ID, role: 'user', content: 'read my key', timestamp: 1 }
      ],
      advancedTools: []
    }),
    signal
  })
}

function approve(
  app: Hono,
  body: Record<string, unknown>,
  headers: Record<string, string> = { [PRESENCE_HEADER]: getPresenceToken() },
  env?: Record<string, unknown>
) {
  return app.request(
    '/api/v1/chat/approval',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    },
    env
  )
}

/** Reads SSE frames until one of `type` arrives. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  type: string
) {
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`stream ended before ${type}`)
    text += decoder.decode(value, { stream: true })
    const found = sseEvents(text).find((e) => e.type === type)
    if (found) return { found, text }
  }
}

async function readRest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string
) {
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return sseEvents(text)
    text += decoder.decode(value, { stream: true })
  }
}

beforeEach(() => {
  readFileExecute.mockClear()
  resetApprovalsForTests()
})

describe('the approval gate through the chat route', () => {
  it('streams approval_required; allowing it runs the tool and the run finishes', async () => {
    scriptSensitiveRead()
    const app = buildApp()
    const response = await send(app)
    const reader = response.body!.getReader()
    const { found, text } = await readUntil(reader, 'approval_required')
    expect(found).toMatchObject({
      runId: USER_ID,
      toolCallId: 'call_1',
      toolName: 'read_file',
      summary: '~/.ssh/id_rsa'
    })
    expect(typeof found.expiresAt).toBe('number')

    const res = await approve(app, {
      runId: USER_ID,
      toolCallId: 'call_1',
      decision: 'allow'
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: 'allowed' })

    const events = await readRest(reader, text)
    expect(events).toContainEqual({
      type: 'approval_resolved',
      runId: USER_ID,
      toolCallId: 'call_1',
      outcome: 'allowed'
    })
    expect(readFileExecute).toHaveBeenCalledOnce()
    expect(events.at(-1)?.type).toBe('done')

    // Idempotent: the same answer again gets the recorded outcome.
    const again = await approve(app, {
      runId: USER_ID,
      toolCallId: 'call_1',
      decision: 'deny'
    })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ outcome: 'allowed' })
  })

  it('a loopback POST without the presence token is refused (403) and the call stays paused', async () => {
    scriptSensitiveRead()
    const app = buildApp()
    const controller = new AbortController()
    const response = await send(app, controller.signal)
    const reader = response.body!.getReader()
    await readUntil(reader, 'approval_required')

    const body = { runId: USER_ID, toolCallId: 'call_1', decision: 'allow' }
    // What a `curl` from the model's terminal sends: no token, or a guess.
    for (const headers of [{}, { [PRESENCE_HEADER]: 'guess' }]) {
      const res = await approve(app, body, headers)
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('PRESENCE_REQUIRED')
    }
    expect(pendingApprovalCount()).toBe(1)
    expect(readFileExecute).not.toHaveBeenCalled()

    // The window closes: the run is stopped and the call declined.
    controller.abort()
    await reader.cancel().catch(() => {})
    await vi.waitFor(() => expect(pendingApprovalCount()).toBe(0))
    expect(readFileExecute).not.toHaveBeenCalled()
  })

  it('a paired device on the LAN listener can answer without the window token', async () => {
    scriptSensitiveRead()
    const app = buildApp()
    const response = await send(app)
    const reader = response.body!.getReader()
    const { text } = await readUntil(reader, 'approval_required')
    // authGate has already required the device token on this listener.
    const res = await approve(
      app,
      { runId: USER_ID, toolCallId: 'call_1', decision: 'deny' },
      {},
      { listener: 'lan' }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: 'denied' })
    const events = await readRest(reader, text)
    const done = events.find((e) => e.type === 'done') as {
      messages: Array<{ role: string; content: unknown }>
    }
    expect(done.messages[2].content).toEqual([
      { type: 'text', text: 'The user declined access to ~/.ssh/id_rsa.' }
    ])
    expect(readFileExecute).not.toHaveBeenCalled()
  })

  it('an unknown or expired approval is 404', async () => {
    const res = await approve(buildApp(), {
      runId: USER_ID,
      toolCallId: 'nope',
      decision: 'allow'
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('APPROVAL_NOT_FOUND')
  })

  it('a malformed decision is 400', async () => {
    const res = await approve(buildApp(), {
      runId: USER_ID,
      toolCallId: 'call_1',
      decision: 'always'
    })
    expect(res.status).toBe(400)
  })
})
