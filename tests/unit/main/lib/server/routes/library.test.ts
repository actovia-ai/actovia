// src/main/lib/server/routes/library.ts — GET /api/v1/library: every
// artifact the chats made (ISSUE-237), as listLibraryItems() reads them.
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
  listLibraryItems: vi.fn(async () => [item]),
  getLibraryItemCode: vi.fn(async (chatId: string, artifactId: string) =>
    chatId === 'c1' && artifactId === 'art-1'
      ? { title: 'Kyoto itinerary', code: 'export default () => null' }
      : null
  ),
  updateArtifactCodeByArtifactId: vi.fn()
}))

const { default: libraryRouter } =
  await import('@main/lib/server/routes/library')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const app = new Hono().route('/api/v1/library', libraryRouter)
app.onError(errorHandler)

describe('GET /api/v1/library', () => {
  it('answers the list', async () => {
    const res = await app.request('/api/v1/library')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([item])
  })
})

// ISSUE-265: the Library page draws each card's page, from the code the
// chat's card renders (the row, not the file a hand edit may have changed).
describe('GET /api/v1/library/:chatId/:artifactId/code', () => {
  it('answers the artifact’s code and title', async () => {
    const res = await app.request('/api/v1/library/c1/art-1/code')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: 'Kyoto itinerary',
      code: 'export default () => null'
    })
  })

  it('is a 404 for an artifact the chat did not make', async () => {
    const res = await app.request('/api/v1/library/c2/art-1/code')
    expect(res.status).toBe(404)
  })
})
