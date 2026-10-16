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
let live:
  | { respond: typeof respond; interrupt: typeof interrupt; busy?: boolean }
  | undefined
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: {
    bySession: () => live,
    stopSession: (id: string) => stopSession(id)
  }
}))
const getCliStatus = vi.fn(async (id: string) => ({
  id,
  state: 'ready',
  path: id === 'codex' ? '/bin/codex' : '/bin/claude'
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: (id: string) => getCliStatus(id)
}))
vi.mock('@main/lib/agents/login-shell', () => ({ resetLoginShellEnv: vi.fn() }))
const openInTerminal = vi.fn(async (_path: string) => {})
const writeResumeScript = vi.fn(
  async (_cwd: string, _bin: string, _args: string[]) =>
    '/data/run/terminal/x.sh'
)
const stopSession = vi.fn(async (_id: string) => {})
vi.mock('@main/lib/agents/terminal', async (importActual) => ({
  ...(await importActual<typeof import('@main/lib/agents/terminal')>()),
  openInTerminal: (p: string) => openInTerminal(p),
  writeResumeScript: (cwd: string, bin: string, args: string[]) =>
    writeResumeScript(cwd, bin, args)
}))
const Q = {
  cli: 'claude-code',
  state: 'allowed',
  rejectedWindow: null,
  overage: false,
  asOf: 1,
  windows: [{ name: 'five_hour', usedPercent: 5, resetsAt: 10 }]
}
vi.mock('@main/lib/agents/quota', () => ({ listQuotas: () => [Q] }))
let cliSessionId = '3f2a9c1e-1111-4222-8333-444455556666'
let runtime = 'claude-code'
/** The session's current step's message. */
const CURRENT = '9b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff'
const OLDER = '1a1a1a1a-aaaa-4bbb-8ccc-ddddeeeeffff'
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
    runtime,
    cliSessionId,
    projectId: 'p',
    conversationId: 'c',
    messageId: CURRENT
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

const post = (path: string, body?: unknown, env?: object) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    },
    env
  )

describe('agents routes', () => {
  it('GET /quota lists what each CLI last said of the quota', async () => {
    const res = await app.request('/quota')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([Q])
  })

  it('passes an answer to the live run', async () => {
    live = { respond: respond.mockReturnValue(true), interrupt }
    const res = await post('/sessions/s1/respond', {
      requestId: 'r1',
      answer: { kind: 'deny', reason: 'no' }
    })
    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalledWith('r1', { kind: 'deny', reason: 'no' })
  })

  it('passes a Codex answer with several picks through as a list', async () => {
    live = { respond: respond.mockReturnValue(true), interrupt }
    const answer = { kind: 'answers', answers: { env: ['staging', 'prod'] } }
    const res = await post('/sessions/s1/respond', {
      requestId: 'n:0',
      answer
    })
    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalledWith('n:0', answer)
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

  it('bounds an answer set: key and value length, at most 20 keys, requestId', async () => {
    live = { respond: respond.mockReturnValue(true), interrupt }
    const bad = [
      { requestId: 'r'.repeat(201), answer: { kind: 'allow' } },
      {
        requestId: 'r',
        answer: { kind: 'answers', answers: { ['k'.repeat(501)]: 'v' } }
      },
      {
        requestId: 'r',
        answer: { kind: 'answers', answers: { k: 'v'.repeat(4001) } }
      },
      {
        requestId: 'r',
        answer: {
          kind: 'answers',
          answers: Object.fromEntries(
            Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])
          )
        }
      }
    ]
    for (const body of bad)
      expect((await post('/sessions/s1/respond', body)).status).toBe(400)
  })

  it('Continue in Terminal stops the run first, then runs the script by path', async () => {
    const order: string[] = []
    stopSession.mockImplementationOnce(async () => void order.push('stop'))
    writeResumeScript.mockImplementationOnce(async () => {
      order.push('write')
      return '/data/run/terminal/x.sh'
    })
    live = undefined
    const res = await post('/sessions/s1/terminal', { messageId: CURRENT })
    expect(res.status).toBe(200)
    expect(order).toEqual(['stop', 'write'])
    expect(writeResumeScript).toHaveBeenLastCalledWith('/p', '/bin/claude', [
      '--resume',
      '3f2a9c1e-1111-4222-8333-444455556666'
    ])
    expect(stopSession).toHaveBeenCalledWith('s1')
    expect(openInTerminal).toHaveBeenCalledWith('/data/run/terminal/x.sh')
  })

  it('Continue in Terminal resumes a Codex session with Codex', async () => {
    runtime = 'codex'
    cliSessionId = '01a1245d-2907-72f3-9b06-3dc67f153940'
    live = undefined
    getCliStatus.mockClear()
    writeResumeScript.mockClear()
    const res = await post('/sessions/s1/terminal', { messageId: CURRENT })
    expect(res.status).toBe(200)
    expect(getCliStatus).toHaveBeenCalledWith('codex')
    expect(writeResumeScript).toHaveBeenCalledWith('/p', '/bin/codex', [
      'resume',
      '01a1245d-2907-72f3-9b06-3dc67f153940'
    ])
    runtime = 'claude-code'
    cliSessionId = '3f2a9c1e-1111-4222-8333-444455556666'
  })

  it('Continue in Terminal refuses a session no CLI runs, writing nothing', async () => {
    runtime = 'exodus'
    stopSession.mockClear()
    writeResumeScript.mockClear()
    expect(
      (await post('/sessions/s1/terminal', { messageId: CURRENT })).status
    ).toBe(400)
    expect(stopSession).not.toHaveBeenCalled()
    expect(writeResumeScript).not.toHaveBeenCalled()
    runtime = 'claude-code'
  })

  it('refuses a session id that is not shaped like one', async () => {
    cliSessionId = "x'; rm -rf ~ #"
    openInTerminal.mockClear()
    expect(
      (await post('/sessions/s1/terminal', { messageId: CURRENT })).status
    ).toBe(400)
    expect(openInTerminal).not.toHaveBeenCalled()
    cliSessionId = '3f2a9c1e-1111-4222-8333-444455556666'
  })

  it('Continue in Terminal from an older card, or while the session works, is a conflict and stops nothing', async () => {
    stopSession.mockClear()
    openInTerminal.mockClear()
    live = undefined
    const stale = await post('/sessions/s1/terminal', { messageId: OLDER })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.message).toMatch(/newer step/)
    live = { respond, interrupt, busy: true }
    expect(
      (await post('/sessions/s1/terminal', { messageId: CURRENT })).status
    ).toBe(409)
    expect((await post('/sessions/s1/terminal')).status).toBe(400)
    expect(stopSession).not.toHaveBeenCalled()
    expect(openInTerminal).not.toHaveBeenCalled()
    live = undefined
  })

  it('the computer-side actions are 403 for a paired phone; answering is not', async () => {
    const lan = { listener: 'lan' }
    for (const path of [
      '/clis/claude-code/check',
      '/sessions/s1/terminal',
      '/sessions/s1/open-folder'
    ]) {
      const res = await post(path, undefined, lan)
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('FORBIDDEN')
    }
    live = { respond: respond.mockReturnValue(true), interrupt }
    expect(
      (
        await post(
          '/sessions/s1/respond',
          { requestId: 'r', answer: { kind: 'allow' } },
          lan
        )
      ).status
    ).toBe(200)
  })
})
