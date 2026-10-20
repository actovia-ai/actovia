import { isAppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  REPORT,
  SNAPSHOT,
  SUMMARY
} from '../../../../shared/types/health-fixtures'

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
  (await buildApp()).request('/api/v1/health/summary', {
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
  manager.callLlm.mockResolvedValue(JSON.stringify(REPORT))
})

describe('POST /api/v1/health/summary', () => {
  it('returns the model report and passes the relevant memories in', async () => {
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.insights).toEqual(REPORT.insights)
    expect(body.headlineHighlight).toBe(REPORT.headlineHighlight)
    expect(body.nudge).toBe(REPORT.nudge)
    expect(body.summary).toContain('**6 小時 12 分**')
    expect(manager.loadRelevantMemories).toHaveBeenCalledWith(
      expect.stringContaining('Daily health report'),
      { id: 'm' },
      'k',
      'health:2026-10-01',
      'health:2026-10-01'
    )
    const userText = manager.callLlm.mock.calls[0][3] as string
    expect(userText).toContain('half-marathon')
    expect(userText).toContain('"steps":5840')
  })

  it('does not read memories when memory is off for chats', async () => {
    settings = { id: 's', memory: { useInChat: false } }
    await post(SNAPSHOT)
    expect(manager.loadRelevantMemories).not.toHaveBeenCalled()
  })

  it('accepts null categories', async () => {
    const res = await post({
      ...SNAPSHOT,
      sleep: null,
      activity: null,
      recovery: null,
      body: null,
      odyState: 'noData'
    })
    expect(res.status).toBe(200)
  })

  it('rejects a snapshot with raw samples', async () => {
    const res = await post({ ...SNAPSHOT, samples: [] })
    expect(res.status).toBe(400)
    expect(manager.callLlm).not.toHaveBeenCalled()
  })

  it('retries once on output that is not the schema, then succeeds', async () => {
    manager.callLlm.mockResolvedValueOnce(
      'Sure! Here is your report: you slept well.'
    )
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('keeps the report when only the suggestion is invalid', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({
        ...REPORT,
        memorySuggestion: { section: 'person', key: 'x y', summary: 'z' }
      })
    )
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.memorySuggestion).toBeNull()
    expect(body.headline).toBe(REPORT.headline)
    expect(manager.callLlm).toHaveBeenCalledTimes(1)
  })

  it('drops a highlight the model did not copy verbatim, keeps the report', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({
        ...REPORT,
        insights: [{ ...REPORT.insights[0], highlights: ['六小時'] }]
      })
    )
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    expect((await res.json()).insights[0].highlights).toEqual([])
    expect(manager.callLlm).toHaveBeenCalledTimes(1)
  })

  it('retries when no insight survives, then fails', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({
        ...REPORT,
        insights: [{ ...REPORT.insights[0], category: 'mood' }]
      })
    )
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('AI_GENERATION_FAILED')
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('treats an old-shape answer (no insights) as invalid and retries', async () => {
    manager.callLlm
      .mockResolvedValueOnce(JSON.stringify(SUMMARY))
      .mockResolvedValueOnce(JSON.stringify(REPORT))
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    expect((await res.json()).insights).toEqual(REPORT.insights)
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('accepts an old-shape answer on the second attempt, without insights', async () => {
    manager.callLlm.mockResolvedValue(
      JSON.stringify({ ...SUMMARY, insights: null })
    )
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toBe(SUMMARY.summary)
    expect('insights' in body).toBe(false)
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('asks for the structured report with one full example', async () => {
    await post(SNAPSHOT)
    const system = manager.callLlm.mock.calls[0][2] as string
    for (const key of [
      '"insights"',
      '"highlights"',
      '"headlineHighlight"',
      '"nudge"',
      '"stat"'
    ])
      expect(system).toContain(key)
    expect(system).toContain('verbatim')
  })

  it('asks for a headline of at most 60 characters', async () => {
    await post(SNAPSHOT)
    expect(manager.callLlm.mock.calls[0][2]).toContain('at most 60 characters')
  })

  it('fails with AI_GENERATION_FAILED after two bad outputs', async () => {
    manager.callLlm.mockResolvedValue('{"headline": ""}')
    const res = await post(SNAPSHOT)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('AI_GENERATION_FAILED')
    expect(manager.callLlm).toHaveBeenCalledTimes(2)
  })

  it('writes nothing and logs no health values', async () => {
    await post(SNAPSHOT)
    expect(memoryQueries.createMemory).not.toHaveBeenCalled()
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls
    ])
    for (const value of ['5840', '372', '61', '38'])
      expect(logged).not.toContain(value)
  })
})
