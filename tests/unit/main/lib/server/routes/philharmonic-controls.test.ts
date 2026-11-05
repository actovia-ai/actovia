import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() }
}))
const brief = {
  content: '# Goal',
  revision: 'v1',
  path: '/group/AGENTS.md',
  exists: true
}
const read = vi.fn(async () => brief)
const save = vi.fn(async () => brief)
const compact = vi.fn(async (_signal?: AbortSignal) => ({
  compacted: true,
  beforeTokens: 800,
  afterTokens: 200,
  absorbedMessages: 12
}))
vi.mock('@main/lib/ai/philharmonic/group-brief', () => ({
  readGroupBrief: read,
  saveGroupBrief: save
}))
vi.mock('@main/lib/ai/philharmonic/lcm', () => ({
  PhilharmonicLcm: class {
    compactNow = compact
  }
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async (id: string) =>
    id === 'missing' ? undefined : { id }
}))
vi.mock('@main/lib/db/queries', () => ({ getSettings: async () => ({}) }))
vi.mock('@main/lib/ai/providers/resolve-model', () => ({
  trustedContextWindow: () => 128000
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ model: {}, apiKey: 'test' })
}))
const { default: router } =
  await import('@main/lib/server/routes/philharmonic-controls')
const { pmRunRegistry } =
  await import('@main/lib/ai/philharmonic/pm-run-registry')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')
const app = new Hono().route('/', router)
app.onError(errorHandler)
beforeEach(() => {
  vi.clearAllMocks()
  pmRunRegistry.clear('g1')
})

describe('Group control endpoints', () => {
  it('returns the brief and refuses a missing Group', async () => {
    expect(await (await app.request('/conversations/g1/brief')).json()).toEqual(
      brief
    )
    expect((await app.request('/conversations/missing/brief')).status).toBe(404)
  })
  it('checks the version and surfaces conflicting edits', async () => {
    save.mockRejectedValueOnce(new Error('BRIEF_CONFLICT'))
    const response = await app.request('/conversations/g1/brief', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'New', revision: 'stale' })
    })
    expect(response.status).toBe(409)
    expect(save).toHaveBeenCalledWith('g1', 'New', 'stale')
  })
  it('never compacts an active PM round', async () => {
    pmRunRegistry.set('g1', new AbortController())
    expect(
      (await app.request('/conversations/g1/compact', { method: 'POST' }))
        .status
    ).toBe(409)
    expect(compact).not.toHaveBeenCalled()
  })
  it('serializes an idle compaction as a Group job and returns its actual token counts', async () => {
    const response = await app.request('/conversations/g1/compact', {
      method: 'POST'
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      compacted: true,
      beforeTokens: 800,
      afterTokens: 200
    })
    expect(compact.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
    expect(pmRunRegistry.has('g1')).toBe(false)
  })
})
