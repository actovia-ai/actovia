// src/main/lib/ai/skills/skills-sh-client.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

describe('skills-sh-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    delete process.env.ACTOVIA_SKILLS_BFF_URL
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists skills against the BFF with view/page/per_page params', async () => {
    const { listSkills } = await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [],
        pagination: { page: 2, perPage: 10, total: 0, hasMore: false }
      })
    )
    const res = await listSkills({ view: 'hot', page: 2, perPage: 10 })
    expect(res.pagination.page).toBe(2)
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.origin).toBe('https://skills-sh.yancey.app')
    expect(url.pathname).toBe('/api/v1/skills')
    expect(url.searchParams.get('view')).toBe('hot')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('10')
  })

  it('lists the curated publishers from /api/v1/skills/curated', async () => {
    const { listCuratedSkills } =
      await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [],
        totalOwners: 0,
        totalSkills: 0,
        generatedAt: '2026-09-20T00:00:00.000Z'
      })
    )
    const res = await listCuratedSkills()
    expect(res.totalOwners).toBe(0)
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.pathname).toBe('/api/v1/skills/curated')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('honours ACTOVIA_SKILLS_BFF_URL', async () => {
    process.env.ACTOVIA_SKILLS_BFF_URL = 'http://localhost:9999'
    const { searchSkills } =
      await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [],
        query: 'x',
        searchType: 'fuzzy',
        count: 0,
        durationMs: 1
      })
    )
    await searchSkills('react', { limit: 5 })
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.origin).toBe('http://localhost:9999')
    expect(url.pathname).toBe('/api/v1/skills/search')
    expect(url.searchParams.get('q')).toBe('react')
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('fetches a detail by its three-segment id', async () => {
    const { getSkillDetail } =
      await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: 'a/b/c', files: [], hash: 'h', installs: 1 })
    )
    const detail = await getSkillDetail('a/b/c')
    expect(detail.id).toBe('a/b/c')
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe(
      '/api/v1/skills/a/b/c'
    )
  })

  it('throws a typed SkillsApiError carrying the upstream status', async () => {
    const { getSkillDetail, SkillsApiError } =
      await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'nope' }))
    await expect(getSkillDetail('a/b/missing')).rejects.toMatchObject({
      name: 'SkillsApiError',
      status: 404
    })
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'down' }))
    const err = await getSkillDetail('a/b/c').catch((e) => e)
    expect(err).toBeInstanceOf(SkillsApiError)
    expect(err.status).toBe(503)
    expect(err.message).toBe('down')
  })

  it('returns null for a skill without an audit, rethrows other failures', async () => {
    const { getSkillAudit } =
      await import('@main/lib/ai/skills/skills-sh-client')
    fetchMock.mockResolvedValue(jsonResponse(404, null))
    expect(await getSkillAudit('a/b/c')).toBeNull()
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe(
      '/api/v1/skills/audit/a/b/c'
    )
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }))
    await expect(getSkillAudit('a/b/c')).rejects.toMatchObject({ status: 500 })
  })
})
