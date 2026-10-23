// src/main/lib/server/routes/deep-research.ts — POST /api/v1/deep-research:
// when the research step throws (or the job is otherwise interrupted), the
// job must end 'failed' with a short, secret-scrubbed message instead of
// staying 'streaming' forever (the desktop card, and actovia-ios's 15-minute
// stall check, both key off jobStatus). Mounted in a bare Hono app with the
// real errorHandler; the settings variable is what app.ts injects per request.
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const error = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn() }
}))
vi.mock('@main/lib/logger/trace-context', () => ({
  bindTraceAttributes: vi.fn()
}))

const deepResearchAgent = vi.fn()
vi.mock('@main/lib/ai/deep-research/deep-research', () => ({
  deepResearch: (...args: unknown[]) => deepResearchAgent(...args)
}))
const writeFinalReport = vi.fn()
vi.mock('@main/lib/ai/deep-research/final-report', () => ({
  writeFinalReport: (...args: unknown[]) => writeFinalReport(...args)
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({
    model: { provider: 'anthropic', id: 'claude' },
    apiKey: 'sk-live-secret-key-0123456789'
  })
}))

interface FakeRow {
  id: string
  toolCallId: string
  title: string | null
  jobStatus: string
  finalReport: string | null
  webSources: unknown
  errorMessage: string | null
  startTime: Date
  endTime: Date | null
}

let row: FakeRow
const getDeepResearchById = vi.fn(async () => row)
const updateDeepResearch = vi.fn(async (payload: FakeRow) => {
  row = { ...row, ...payload }
  return row
})
const saveDeepResearchMessage = vi.fn(async () => {})
const getDeepResearchMessagesById = vi.fn(async () => [])
vi.mock('@main/lib/db/queries', () => ({
  getDeepResearchById: (...args: unknown[]) =>
    getDeepResearchById(...(args as [])),
  updateDeepResearch: (...args: unknown[]) =>
    updateDeepResearch(...(args as [FakeRow])),
  saveDeepResearchMessage: (...args: unknown[]) =>
    saveDeepResearchMessage(...args),
  getDeepResearchMessagesById: (...args: unknown[]) =>
    getDeepResearchMessagesById(...args)
}))

const {
  default: deepResearchRouter,
  runDeepResearchJob,
  summarizeDeepResearchError
} = await import('@main/lib/server/routes/deep-research')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const BRAVE_KEY = 'brave-secret-key-abcdefghijklmnop'
const API_KEY = 'sk-live-secret-key-0123456789'
const DEEP_RESEARCH_ID = '11111111-1111-4111-8111-111111111111'

function appWith() {
  const app = new Hono<{ Variables: { settings: unknown } }>()
  app.use('*', async (c, next) => {
    c.set('settings', {
      id: 'settings-1',
      webSearch: { braveApiKey: BRAVE_KEY },
      deepResearch: { breadth: 4, depth: 2 }
    })
    await next()
  })
  app.route('/api/v1/deep-research', deepResearchRouter as never)
  app.onError(errorHandler)
  return app
}

const post = (body: unknown) =>
  appWith().request('/api/v1/deep-research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(() => {
  row = {
    id: DEEP_RESEARCH_ID,
    toolCallId: 'call-1',
    title: 'A subject',
    jobStatus: 'streaming',
    finalReport: null,
    webSources: null,
    errorMessage: null,
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: null
  }
  deepResearchAgent.mockReset()
  writeFinalReport.mockReset()
  getDeepResearchById.mockClear()
  updateDeepResearch.mockClear()
  saveDeepResearchMessage.mockClear()
  error.mockClear()
})

describe('POST /api/v1/deep-research', () => {
  it('ends the job archived on success', async () => {
    deepResearchAgent.mockResolvedValue({
      learnings: [],
      webSources: new Map()
    })
    writeFinalReport.mockResolvedValue('# Report')
    const res = await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as FakeRow
    expect(body.jobStatus).toBe('archived')
    expect(body.finalReport).toBe('# Report')
  })

  it('a research-step throw ends the job failed, with a short message', async () => {
    deepResearchAgent.mockRejectedValue(
      new TypeError('search backend unreachable')
    )
    const res = await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as FakeRow
    expect(body.jobStatus).toBe('failed')
    expect(body.errorMessage).toBe('TypeError: search backend unreachable')
    expect(writeFinalReport).not.toHaveBeenCalled()
    // The update that flips the row to 'failed' actually reached the DB
    // layer, not just the in-memory response.
    expect(updateDeepResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DEEP_RESEARCH_ID,
        jobStatus: 'failed',
        errorMessage: 'TypeError: search backend unreachable'
      })
    )
  })

  it('a throw during the final report also ends the job failed', async () => {
    deepResearchAgent.mockResolvedValue({
      learnings: [],
      webSources: new Map()
    })
    writeFinalReport.mockRejectedValue(new Error('rate limited'))
    const res = await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    const body = (await res.json()) as FakeRow
    expect(body.jobStatus).toBe('failed')
    expect(body.errorMessage).toBe('Error: rate limited')
  })

  it('never stores a secret the request held, even if the error quoted it', async () => {
    deepResearchAgent.mockRejectedValue(
      new Error(`upstream rejected key ${API_KEY} and brave key ${BRAVE_KEY}`)
    )
    const res = await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    const body = (await res.json()) as FakeRow
    expect(body.errorMessage).not.toContain(API_KEY)
    expect(body.errorMessage).not.toContain(BRAVE_KEY)
    expect(body.errorMessage).toContain('••••')
  })

  it('logs the failure at the deep-research scope', async () => {
    deepResearchAgent.mockRejectedValue(new Error('boom'))
    await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    expect(error).toHaveBeenCalledWith(
      'deep-research',
      'Deep research job failed',
      expect.objectContaining({ deepResearchId: DEEP_RESEARCH_ID })
    )
  })

  it('logs where it was thrown: the frames, under the scrubbed summary', async () => {
    deepResearchAgent.mockRejectedValue(
      new Error(`upstream rejected key ${API_KEY} and brave key ${BRAVE_KEY}`)
    )
    await post({ deepResearchId: DEEP_RESEARCH_ID, query: 'x' })
    const [, , detail] = error.mock.calls.find(
      ([, message]) => message === 'Deep research job failed'
    ) as [string, string, Record<string, string>]
    expect(detail.error).toContain('••••')
    expect(detail['exception.stacktrace']).toMatch(/^ {4}at /u)
    expect(detail['exception.stacktrace']).toContain('deep-research.test.ts')
    const written = JSON.stringify(detail)
    expect(written).not.toContain(API_KEY)
    expect(written).not.toContain(BRAVE_KEY)
    // The message is in the summary, scrubbed; the frames carry none of it.
    expect(detail['exception.stacktrace']).not.toContain('upstream rejected')
  })
})

describe('runDeepResearchJob', () => {
  it('a job without a Brave key ends failed instead of staying streaming', async () => {
    const ended = await runDeepResearchJob(DEEP_RESEARCH_ID, 'x', {
      id: 'settings-1',
      webSearch: {}
    } as never)
    expect(ended.jobStatus).toBe('failed')
    expect(row.jobStatus).toBe('failed')
    expect(deepResearchAgent).not.toHaveBeenCalled()
  })

  it('rejects only when the failure itself cannot be saved', async () => {
    deepResearchAgent.mockRejectedValue(new Error('search down'))
    updateDeepResearch.mockRejectedValueOnce(new Error('db gone'))
    await expect(
      runDeepResearchJob(DEEP_RESEARCH_ID, 'x', {
        id: 'settings-1',
        webSearch: { braveApiKey: BRAVE_KEY }
      } as never)
    ).rejects.toThrow('search down')
  })
})

describe('summarizeDeepResearchError', () => {
  it('is the error class + message, clipped and scrubbed — never a raw object dump', () => {
    const long = 'x'.repeat(500)
    const summary = summarizeDeepResearchError(new Error(long), [])
    expect(summary.startsWith('Error: ')).toBe(true)
    expect(summary.length).toBeLessThan(320)
  })

  it('scrubs a secret it is given', () => {
    const summary = summarizeDeepResearchError(
      new Error(`bad key: ${API_KEY}`),
      [API_KEY]
    )
    expect(summary).not.toContain(API_KEY)
  })

  it('handles a non-Error thrown value', () => {
    expect(summarizeDeepResearchError('plain string', [])).toContain(
      'plain string'
    )
  })
})
