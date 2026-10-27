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
  createdAt: '2026-10-14T00:01:00.000Z'
}
vi.mock('@main/lib/db/queries', () => ({
  listAllArtifacts: vi.fn(async () => [item]),
  updateArtifactCodeByArtifactId: vi.fn()
}))

const { default: artifactsRouter } =
  await import('@main/lib/server/routes/artifacts')

describe('GET /api/v1/artifacts', () => {
  it('answers the list', async () => {
    const app = new Hono().route('/api/v1/artifacts', artifactsRouter)
    const res = await app.request('/api/v1/artifacts')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([item])
  })
})
