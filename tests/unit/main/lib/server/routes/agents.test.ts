// tests/unit/main/lib/server/routes/agents.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
  dialog: {}
}))
const respond = vi.fn()
const interrupt = vi.fn()
let live: { respond: typeof respond; interrupt: typeof interrupt } | undefined
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: { bySession: () => live, stopSession: vi.fn(async () => {}) }
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: vi.fn(async () => ({ id: 'claude-code', state: 'ready' }))
}))
vi.mock('@main/lib/agents/login-shell', () => ({ resetLoginShellEnv: vi.fn() }))
vi.mock('@main/lib/agents/terminal', () => ({
  openInTerminal: vi.fn(async () => {})
}))
vi.mock('@main/lib/agents/default-employees', () => ({
  ensureDefaultCliEmployees: vi.fn(async () => {})
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationMessageById: async () => undefined,
  updateConversationMessageParts: vi.fn()
}))
vi.mock('@main/lib/db/agent-session-queries', () => ({
  getAgentSession: async () => ({
    id: 's1',
    cwd: '/p',
    cliSessionId: 'cli',
    conversationId: 'c'
  }),
  updateAgentSession: vi.fn(async () => ({}))
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn()
}))

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: agentsRouter } = await import('@main/lib/server/routes/agents')
const app = new Hono()
app.route('/', agentsRouter)
app.onError(errorHandler)

const post = (path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })

describe('agents routes', () => {
  it('passes an answer to the live run', async () => {
    live = { respond: respond.mockReturnValue(true), interrupt }
    const res = await post('/sessions/s1/respond', {
      requestId: 'r1',
      answer: { kind: 'deny', reason: 'no' }
    })
    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalledWith('r1', { kind: 'deny', reason: 'no' })
  })

  it('409s when the prompt was already answered or the run moved on', async () => {
    live = { respond: respond.mockReturnValue(false), interrupt }
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'allow' }
        })
      ).status
    ).toBe(409)
  })

  it('409s when nothing runs for the session', async () => {
    live = undefined
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'allow' }
        })
      ).status
    ).toBe(409)
    expect((await post('/sessions/s1/interrupt')).status).toBe(409)
  })

  it('rejects an answer of an unknown shape', async () => {
    live = { respond, interrupt }
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'yolo' }
        })
      ).status
    ).toBe(400)
  })
})
