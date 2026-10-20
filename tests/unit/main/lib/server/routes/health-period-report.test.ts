import { isAppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PERIOD_REPORT,
  PERIOD_REQUEST
} from '../../../../shared/types/health-period-fixtures'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger }))

const manager = vi.hoisted(() => ({
  callLlm: vi.fn(),
  loadRelevantMemories: vi.fn(),
  runMemoryConsolidation: vi.fn(),
  runMemoryInstruction: vi.fn(),
  parseJsonFromResponse: (t: string) => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
}))
vi.mock('@main/lib/ai/memory/manager', () => manager)

const modelUtil = vi.hoisted(() => ({
  getModelFromProvider: vi.fn(() => ({ model: { id: 'm' }, apiKey: 'k' }))
}))
vi.mock('@main/lib/ai/utils/model-util', () => modelUtil)

const memoryQueries = vi.hoisted(() => ({ createMemory: vi.fn() }))
vi.mock('@main/lib/db/memory-queries', () => memoryQueries)

// Every query module writes through this drizzle handle, so a route that
// stored anything would reach one of these spies.
const dbWrites = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
}))
vi.mock('@main/lib/db/db', () => ({ db: dbWrites, pglite: {} }))

let settings: Record<string, unknown> = {
  id: 's',
  memory: { useInChat: true }
}

async function buildApp() {
  const { default: healthRouter } =
    await import('@main/lib/server/routes/health')
  const app = new Hono<{ Variables: { settings: unknown } }>()
  app.use('*', async (c, next) => {
    c.set('settings', settings)
    await next()
  })
  app.route('/api/v1/health', healthRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

const post = async (body: unknown) =>
  (await buildApp()).request('/api/v1/health/period-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(() => {
  vi.clearAllMocks()
  settings = { id: 's', memory: { useInChat: true } }
  manager.loadRelevantMemories.mockResolvedValue([
    {
      id: 'm1',
      section: 'profile',
      key: 'half-marathon',
      summary: 'Training for a half marathon',
      details: []
    }
  ])
  manager.callLlm.mockResolvedValue(JSON.stringify(PERIOD_REPORT))
})

describe('POST /api/v1/health/period-report', () => {
  it('returns the report for the period asked, with the relevant memories passed in', async () => {
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toEqual(PERIOD_REQUEST.period)
    expect(body.headline).toBe(PERIOD_REPORT.headline)
    expect(body.insights).toEqual(PERIOD_REPORT.insights)
    expect(
      body.comparisons.map((c: { direction: string }) => c.direction)
    ).toEqual(['up', 'down', 'flat', 'down'])
    expect(manager.loadRelevantMemories).toHaveBeenCalledWith(
      expect.stringContaining('Health report for a month'),
      { id: 'm' },
      'k',
      'health:month:2026-09-01',
      'health:month:2026-09-01'
    )
    const userText = manager.callLlm.mock.calls[0][3] as string
    expect(userText).toContain('half-marathon')
    expect(userText).toContain('"daysWithData":28')
    expect(userText).toContain('A little under-slept')
  })

  it('does not read memories when memory is off for chats', async () => {
    settings = { id: 's', memory: { useInChat: false } }
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(200)
    expect(manager.loadRelevantMemories).not.toHaveBeenCalled()
  })

  it('rejects a request with fields it does not know, before any model call', async () => {
    const res = await post({ ...PERIOD_REQUEST, samples: [] })
    expect(res.status).toBe(400)
    expect(manager.callLlm).not.toHaveBeenCalled()
  })

  it('rejects an N-day window', async () => {
    const res = await post({
      ...PERIOD_REQUEST,
      period: { ...PERIOD_REQUEST.period, kind: 'days' }
    })
    expect(res.status).toBe(400)
  })

  it('retries once on output that is not JSON, then succeeds', async () => {
    manager.callLlm.mockResolvedValueOnce('Sure! Your month went well.')
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(200)
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries when no insight survives, then keeps the headline alone', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({
        ...PERIOD_REPORT,
        insights: [{ category: 'mood', title: 'x', highlights: [] }]
      })
    )
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.headline).toBe(PERIOD_REPORT.headline)
    expect(body.insights).toEqual([])
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('keeps a first answer whose directions are wrong, putting them right', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({
        ...PERIOD_REPORT,
        comparisons: PERIOD_REPORT.comparisons.map((c) => ({
          ...c,
          direction: 'up'
        }))
      })
    )
    const res = await post(PERIOD_REQUEST)
    expect(
      (await res.json()).comparisons.map(
        (c: { direction: string }) => c.direction
      )
    ).toEqual(['up', 'down', 'flat', 'down'])
    expect(manager.callLlm).toHaveBeenCalledTimes(1)
  })

  it('fails with AI_GENERATION_FAILED after two answers without a headline', async () => {
    manager.callLlm.mockResolvedValue('{"headline": ""}')
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('AI_GENERATION_FAILED')
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('asks for the direction against the period before, with one full example', async () => {
    await post(PERIOD_REQUEST)
    const system = manager.callLlm.mock.calls[0][2] as string
    for (const phrase of [
      '"comparisons"',
      '"previous"',
      'under 3 %',
      'verbatim',
      'daysWithData',
      'at most 60 characters'
    ])
      expect(system).toContain(phrase)
  })

  it('writes nothing and logs no health values', async () => {
    const res = await post(PERIOD_REQUEST)
    expect(res.status).toBe(200)
    expect(memoryQueries.createMemory).not.toHaveBeenCalled()
    expect(manager.runMemoryConsolidation).not.toHaveBeenCalled()
    expect(manager.runMemoryInstruction).not.toHaveBeenCalled()
    expect(dbWrites.insert).not.toHaveBeenCalled()
    expect(dbWrites.update).not.toHaveBeenCalled()
    expect(dbWrites.delete).not.toHaveBeenCalled()
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls
    ])
    for (const value of ['7040', '432', 'under-slept', 'More sleep'])
      expect(logged).not.toContain(value)
  })
})
