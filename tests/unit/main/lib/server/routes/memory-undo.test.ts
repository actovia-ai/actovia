// src/main/lib/server/routes/memory.ts
import { isAppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const manager = vi.hoisted(() => ({
  LOCAL_USER_ID: '00000000-0000-0000-0000-000000000001',
  runMemoryInstruction: vi.fn()
}))
vi.mock('@main/lib/ai/memory/manager', () => manager)

vi.mock('@main/lib/ai/utils/model-util', () => ({
  getModelFromProvider: vi.fn()
}))

const queries = vi.hoisted(() => ({
  createMemory: vi.fn(),
  getAllMemories: vi.fn(),
  getMemoryById: vi.fn(),
  getMemoryUsageByChat: vi.fn(),
  hardDeleteMemory: vi.fn(),
  softDeleteMemory: vi.fn(),
  updateMemory: vi.fn()
}))
vi.mock('@main/lib/db/memory-queries', () => queries)

const undo = vi.hoisted(() => ({ undoMemoryChanges: vi.fn() }))
vi.mock('@main/lib/ai/memory/undo', () => undo)

async function buildApp() {
  const { default: memoryRouter } =
    await import('@main/lib/server/routes/memory')
  const app = new Hono()
  app.route('/api/v1/memory', memoryRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

const ID_A = '11111111-1111-4111-8111-111111111111'
const CHAT_ID = '22222222-2222-4222-8222-222222222222'

const snap = (summary: string) => ({
  section: 'profile' as const,
  key: 'k',
  summary,
  details: [],
  isActive: true
})

async function postUndo(changes: unknown[]) {
  const app = await buildApp()
  return app.request('/api/v1/memory/undo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes })
  })
}

describe('POST /api/v1/memory/undo', () => {
  beforeEach(() => {
    undo.undoMemoryChanges.mockReset()
  })

  it('400s when the body has no changes array', async () => {
    const app = await buildApp()
    const res = await app.request('/api/v1/memory/undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(400)
    expect(undo.undoMemoryChanges).not.toHaveBeenCalled()
  })

  it('returns { undone, skipped } for a valid body', async () => {
    undo.undoMemoryChanges.mockResolvedValue({ undone: ['a'], skipped: ['b'] })
    const app = await buildApp()
    const change = {
      op: 'update',
      id: ID_A,
      before: {
        section: 'profile',
        key: 'k',
        summary: 's',
        details: [],
        isActive: true
      },
      after: {
        section: 'profile',
        key: 'k',
        summary: 's2',
        details: [],
        isActive: true
      }
    }

    const res = await app.request('/api/v1/memory/undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: [change] })
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ undone: ['a'], skipped: ['b'] })
    expect(undo.undoMemoryChanges).toHaveBeenCalledWith([change])
  })

  it('accepts a well-formed create and delete', async () => {
    undo.undoMemoryChanges.mockResolvedValue({ undone: [], skipped: [] })
    const res = await postUndo([
      { op: 'create', id: ID_A, before: null, after: snap('s') },
      { op: 'delete', id: ID_A, before: snap('s'), after: null }
    ])
    expect(res.status).toBe(200)
  })

  it.each([
    [
      'an update without before',
      { op: 'update', id: ID_A, before: null, after: snap('s') }
    ],
    [
      'an update without after',
      { op: 'update', id: ID_A, before: snap('s'), after: null }
    ],
    [
      'a delete without before',
      { op: 'delete', id: ID_A, before: null, after: null }
    ],
    [
      'a delete whose after is not null',
      { op: 'delete', id: ID_A, before: snap('s'), after: snap('s') }
    ],
    [
      'a create without after',
      { op: 'create', id: ID_A, before: null, after: null }
    ],
    [
      'a create whose before is not null',
      { op: 'create', id: ID_A, before: snap('s'), after: snap('s') }
    ],
    [
      'a non-uuid id',
      { op: 'update', id: 'not-a-uuid', before: snap('a'), after: snap('b') }
    ]
  ])('400s on %s, and never reaches undo', async (_label, change) => {
    const res = await postUndo([change])
    expect(res.status).toBe(400)
    expect(undo.undoMemoryChanges).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/memory/usage', () => {
  beforeEach(() => {
    queries.getMemoryUsageByChat.mockReset()
  })

  it('400s without a chatId query param, and never reaches the query', async () => {
    const app = await buildApp()
    const res = await app.request('/api/v1/memory/usage')
    expect(res.status).toBe(400)
    expect(queries.getMemoryUsageByChat).not.toHaveBeenCalled()
  })

  it('400s on a non-uuid chatId, and never reaches the query', async () => {
    const app = await buildApp()
    const res = await app.request('/api/v1/memory/usage?chatId=chat-1')
    expect(res.status).toBe(400)
    expect(queries.getMemoryUsageByChat).not.toHaveBeenCalled()
  })

  it('returns runId -> UsedMemory[] for a valid chatId, ahead of the /:id route', async () => {
    queries.getMemoryUsageByChat.mockResolvedValue({
      'run-1': [{ id: 'mem-1', key: 'Classical Music', section: 'topic' }]
    })
    const app = await buildApp()
    const res = await app.request(`/api/v1/memory/usage?chatId=${CHAT_ID}`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      'run-1': [{ id: 'mem-1', key: 'Classical Music', section: 'topic' }]
    })
    expect(queries.getMemoryUsageByChat).toHaveBeenCalledWith(CHAT_ID)
    // Proves route ordering: "usage" was not swallowed by GET /:id, which
    // would have called getMemoryById instead.
    expect(queries.getMemoryById).not.toHaveBeenCalled()
  })
})
