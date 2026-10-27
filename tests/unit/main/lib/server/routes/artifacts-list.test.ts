// src/main/lib/server/routes/artifacts.ts — GET /api/v1/artifacts: every
// artifact the chats made (ISSUE-237), as listAllArtifacts() reads them.
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const item = {
  artifactId: 'art-1',
  title: 'Kyoto itinerary',
  chatId: 'c1',
  chatTitle: 'Trip',
  runId: 'r1',
  toolCallId: 'call-1',
  createdAt: '2026-10-14T00:01:00.000Z'
}
vi.mock('@main/lib/db/queries', () => ({
  listAllArtifacts: vi.fn(async () => [item]),
  getArtifactCode: vi.fn(async (chatId: string, artifactId: string) =>
    chatId === 'c1' && artifactId === 'art-1'
      ? { title: 'Kyoto itinerary', code: 'export default () => null' }
      : null
  ),
  updateArtifactCodeByArtifactId: vi.fn()
}))

const { default: artifactsRouter } =
  await import('@main/lib/server/routes/artifacts')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const app = new Hono().route('/api/v1/artifacts', artifactsRouter)
app.onError(errorHandler)

describe('GET /api/v1/artifacts', () => {
  it('answers the list', async () => {
    const res = await app.request('/api/v1/artifacts')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([item])
  })
})

// ISSUE-265: the Artifacts page draws each card's page, from the code the
// chat's card renders (the row, not the file a hand edit may have changed).
describe('GET /api/v1/artifacts/:chatId/:artifactId/code', () => {
  it('answers the artifact’s code and title', async () => {
    const res = await app.request('/api/v1/artifacts/c1/art-1/code')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: 'Kyoto itinerary',
      code: 'export default () => null'
    })
  })

  it('is a 404 for an artifact the chat did not make', async () => {
    const res = await app.request('/api/v1/artifacts/c2/art-1/code')
    expect(res.status).toBe(404)
  })
})
