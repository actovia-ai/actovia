// src/main/lib/server/routes/philharmonic-conversations.test.ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/server/utils', () => ({
  getRequiredParam: (_c: unknown, _k: string) => 'id',
  handleDatabaseOperation: (fn: () => unknown) => fn(),
  successResponse: (_c: unknown, data: unknown) => data,
  deletionSuccessResponse: (c: { json: (d: unknown) => unknown }) =>
    c.json({ success: true }),
  validateSchema: (_s: unknown, d: unknown) => d
}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getPhilharmonicCostRows: getPhilharmonicCostRows
}))
const getPhilharmonicCostRows = vi.fn()
const deleteConversation = vi.fn(async () => {
  order.push('delete')
})
vi.mock('@main/lib/db/conversation-queries', () => ({ deleteConversation }))
const removeGroupMedia = vi.fn(async () => {})
vi.mock('@main/lib/media/store', () => ({ removeGroupMedia }))
vi.mock('@main/lib/ai/philharmonic/pm-coordinator', () => ({
  runPmCoordinator: vi.fn()
}))
vi.mock('@main/lib/ai/philharmonic/ask-user-registry', () => ({
  askUserRegistry: { resolve: vi.fn() }
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn()
}))
const order: string[] = []
const abort = vi.fn((_id: string) => {
  order.push('abort')
  return true
})
vi.mock('@main/lib/ai/philharmonic/pm-run-registry', () => ({
  pmRunRegistry: { abort: (id: string) => abort(id) }
}))
const stopConversation = vi.fn(async (_id: string) => {
  order.push('stop agents')
})
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: { stopConversation: (id: string) => stopConversation(id) }
}))

const { aggregateCosts, default: conversationsRouter } =
  await import('@main/lib/server/routes/philharmonic-conversations')

describe('aggregateCosts', () => {
  it('sums tokens and cost by conversation and agent', () => {
    const rows = [
      {
        conversationId: 'c1',
        agentId: 'a1',
        tokenUsage: { inputTokens: 100, outputTokens: 50, cost: 0.5 },
        startedAt: new Date('2026-05-01')
      },
      {
        conversationId: 'c1',
        agentId: 'a2',
        tokenUsage: { inputTokens: 200, outputTokens: 80, cost: 0.7 },
        startedAt: new Date('2026-05-01')
      }
    ]
    const summary = aggregateCosts(rows as never)
    expect(summary.totalCost).toBeCloseTo(1.2)
    expect(summary.totalTokens).toBe(430)
    expect(
      summary.byConversation.find((c) => c.conversationId === 'c1')!.cost
    ).toBeCloseTo(1.2)
    expect(summary.byAgent).toHaveLength(2)
  })
})

describe('DELETE /conversations/:id', () => {
  it('removes the Group’s generated media with it', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)

    const res = await app.request('/conversations/id', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(deleteConversation).toHaveBeenCalledWith('id')
    expect(removeGroupMedia).toHaveBeenCalledWith('id')
  })

  it('stops the PM and every agent working for the group before deleting it', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.route('/', conversationsRouter)
    order.length = 0

    await app.request('/conversations/id', { method: 'DELETE' })

    expect(abort).toHaveBeenCalledWith('id')
    expect(stopConversation).toHaveBeenCalledWith('id')
    expect(order).toEqual(['abort', 'stop agents', 'delete'])
  })
})
