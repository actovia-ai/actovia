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
  askUserRegistry: { resolve: vi.fn() }
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
vi.mock('@main/lib/db/pm-round-queries', () => ({ listRoundEvents }))

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

  it('is a 404 for a round with no record', async () => {
    const res = await app.request('/conversations/c2/rounds/r1')
    expect(res.status).toBe(404)
  })
})
