import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('@main/lib/db/conversation-queries', () => ({}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({}))
vi.mock('@main/lib/db/plan-queries', () => ({}))
vi.mock('@main/lib/media/store', () => ({ removeGroupMedia: vi.fn() }))
vi.mock('@main/lib/ai/philharmonic/pm-coordinator', () => ({
  runPmCoordinator: vi.fn()
}))
vi.mock('@main/lib/ai/philharmonic/ask-user-registry', () => ({
  askUserRegistry: { resolve: vi.fn(), cancel: vi.fn() }
}))
vi.mock('@main/lib/ai/philharmonic/pm-run-registry', () => ({
  pmRunRegistry: { abort: vi.fn() }
}))
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: { stopConversation: vi.fn() }
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn()
}))

const listRoundEvents = vi.fn(async (conversationId: string, roundId: string) =>
  conversationId === 'c1' && roundId === 'r1'
    ? [
        {
          id: 'e1',
          conversationId: 'c1',
          roundId: 'r1',
          seq: 0,
          kind: 'input',
          payload: { trigger: 'user', text: 'hi' },
          createdAt: new Date('2026-10-17T10:00:00.000Z')
        },
        {
          id: 'e2',
          conversationId: 'c1',
          roundId: 'r1',
          seq: 1,
          kind: 'text',
          payload: { text: 'Done.' },
          createdAt: new Date('2026-10-17T10:00:01.000Z')
        }
      ]
    : []
)
const pmContext = {
  takenAt: '2026-11-02T10:00:00.000Z',
  roundId: 'r1',
  model: 'gpt-test',
  contextWindow: 128000,
  compactAt: 96000,
  lcmTokens: 700,
  total: 1000,
  estimated: false,
  parts: [
    { key: 'system', tokens: 200 },
    { key: 'skills', tokens: 0 },
    { key: 'mcp', tokens: 100 },
    { key: 'tools', tokens: 200 },
    { key: 'memory', tokens: 0 },
    { key: 'summaries', tokens: 100 },
    { key: 'messages', tokens: 400 }
  ]
}
const getLatestPmContextSnapshot = vi.fn(async (conversationId: string) =>
  conversationId === 'c1' ? pmContext : null
)
vi.mock('@main/lib/db/pm-round-queries', () => ({
  listRoundEvents,
  getLatestPmContextSnapshot
}))

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: router } =
  await import('@main/lib/server/routes/philharmonic-conversations')
const app = new Hono()
app.route('/', router)
app.onError(errorHandler)

describe('GET /conversations/:id/rounds/:roundId', () => {
  it('answers the round’s events in order, without their ids', async () => {
    const res = await app.request('/conversations/c1/rounds/r1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        seq: 0,
        kind: 'input',
        payload: { trigger: 'user', text: 'hi' },
        createdAt: '2026-10-17T10:00:00.000Z'
      },
      {
        seq: 1,
        kind: 'text',
        payload: { text: 'Done.' },
        createdAt: '2026-10-17T10:00:01.000Z'
      }
    ])
    expect(listRoundEvents).toHaveBeenCalledWith('c1', 'r1')
  })

  describe('GET /conversations/:id/context', () => {
    it('returns the last measured PM context snapshot', async () => {
      const res = await app.request('/conversations/c1/context')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(pmContext)
      expect(getLatestPmContextSnapshot).toHaveBeenCalledWith('c1')
    })

    it('returns null before a round has measured context', async () => {
      const res = await app.request('/conversations/c2/context')
      expect(res.status).toBe(200)
      expect(await res.json()).toBeNull()
    })
  })

  it('is a 404 for a round with no record', async () => {
    const res = await app.request('/conversations/c2/rounds/r1')
    expect(res.status).toBe(404)
  })
})
