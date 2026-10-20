// src/main/lib/server/routes/skills.ts
import { isAppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const client = vi.hoisted(() => ({
  listSkills: vi.fn(),
  searchSkills: vi.fn(),
  listCuratedSkills: vi.fn(),
  getSkillDetail: vi.fn(),
  getSkillAudit: vi.fn()
}))
vi.mock('@main/lib/ai/skills/skills-sh-client', async () => {
  const actual = await vi.importActual<
    typeof import('@main/lib/ai/skills/skills-sh-client')
  >('@main/lib/ai/skills/skills-sh-client')
  return { ...actual, ...client }
})

const store = vi.hoisted(() => ({
  installSkill: vi.fn(),
  listInstalledSkills: vi.fn(),
  toggleSkillActive: vi.fn(),
  uninstallSkill: vi.fn()
}))
vi.mock('@main/lib/ai/skills/skills-store', () => store)

async function buildApp() {
  const { default: skillsRouter } =
    await import('@main/lib/server/routes/skills')
  const app = new Hono()
  app.route('/api/v1/skills', skillsRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

describe('/api/v1/skills', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(client), ...Object.values(store)])
      fn.mockReset()
  })

  it('GET /registry validates the view and clamps per_page', async () => {
    client.listSkills.mockResolvedValue({ data: [], pagination: {} })
    const app = await buildApp()
    const res = await app.request(
      '/api/v1/skills/registry?view=bogus&page=3&per_page=999'
    )
    expect(res.status).toBe(200)
    expect(client.listSkills).toHaveBeenCalledWith({
      view: 'all-time',
      page: 3,
      perPage: 100
    })
  })

  it('GET /curated proxies the publishers list', async () => {
    client.listCuratedSkills.mockResolvedValue({
      data: [{ owner: 'vercel', totalInstalls: 1, skills: [] }],
      totalOwners: 1,
      totalSkills: 0,
      generatedAt: 'x'
    })
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/curated')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { totalOwners: number }
    expect(body.totalOwners).toBe(1)
  })

  it('GET /search requires q', async () => {
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/search?q=%20')
    expect(res.status).toBe(400)
    expect(client.searchSkills).not.toHaveBeenCalled()
  })

  it('GET /detail maps an upstream 404 to SKILL_NOT_FOUND', async () => {
    const { SkillsApiError } = await vi.importActual<
      typeof import('@main/lib/ai/skills/skills-sh-client')
    >('@main/lib/ai/skills/skills-sh-client')
    client.getSkillDetail.mockRejectedValue(
      new SkillsApiError(404, 'Not found')
    )
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/detail?id=a%2Fb%2Fc')
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('SKILL_NOT_FOUND')
    expect(client.getSkillDetail).toHaveBeenCalledWith('a/b/c')
  })

  it('maps 429 and other upstream failures to typed errors', async () => {
    const { SkillsApiError } = await vi.importActual<
      typeof import('@main/lib/ai/skills/skills-sh-client')
    >('@main/lib/ai/skills/skills-sh-client')
    const app = await buildApp()

    client.listSkills.mockRejectedValue(new SkillsApiError(429, 'slow down'))
    let res = await app.request('/api/v1/skills/registry')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMIT_SKILLS')

    client.listSkills.mockRejectedValue(new TypeError('fetch failed'))
    res = await app.request('/api/v1/skills/registry')
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('SERVICE_SKILLS_REGISTRY_FAILED')
  })

  it('GET /audit passes null through as JSON null', async () => {
    client.getSkillAudit.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/audit?id=a%2Fb%2Fc')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('POST /install fetches the detail then writes it through the store', async () => {
    const detail = { id: 'a/b/c', slug: 'c', files: [], hash: 'h' }
    client.getSkillDetail.mockResolvedValue(detail)
    store.installSkill.mockResolvedValue({ slug: 'c', version: 'h' })
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'a/b/c' })
    })
    expect(res.status).toBe(201)
    expect(store.installSkill).toHaveBeenCalledWith(detail)

    const bad = await app.request('/api/v1/skills/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(bad.status).toBe(400)
  })

  it('DELETE /:slug and PATCH /:slug/toggle hit the store', async () => {
    store.uninstallSkill.mockResolvedValue()
    store.toggleSkillActive.mockResolvedValue()
    const app = await buildApp()

    expect(
      (await app.request('/api/v1/skills/c', { method: 'DELETE' })).status
    ).toBe(200)
    expect(store.uninstallSkill).toHaveBeenCalledWith('c')

    const res = await app.request('/api/v1/skills/c/toggle', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false })
    })
    expect(res.status).toBe(200)
    expect(store.toggleSkillActive).toHaveBeenCalledWith('c', false)

    const bad = await app.request('/api/v1/skills/c/toggle', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: 'yes' })
    })
    expect(bad.status).toBe(400)
  })

  it('GET /installed returns the lockfile list', async () => {
    store.listInstalledSkills.mockResolvedValue([{ slug: 'c' }])
    const app = await buildApp()
    const res = await app.request('/api/v1/skills/installed')
    expect(await res.json()).toEqual([{ slug: 'c' }])
  })
})
