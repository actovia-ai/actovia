import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('electron', () => ({}))
vi.mock('@main/lib/paths', () => ({ getExodusHome: () => '/data/exodus' }))
const updateSettings = vi.fn(async () => ({}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({
    agents: {
      cliPaths: { 'claude-code': '/good/claude' },
      projectsDir: '/good',
      maxRunning: 3,
      keepAliveMinutes: 7,
      worktrees: true,
      defaultEmployeesCreated: { 'claude-code': true }
    }
  }),
  getAllSearchableMessages: vi.fn(),
  updateSettings: (p: unknown) => updateSettings(p)
}))
vi.mock('@main/lib/db/mcp-queries', () => ({ getAllMcpServers: vi.fn() }))
vi.mock('@main/lib/ai/providers/list-models', () => ({
  listModelsByProvider: vi.fn()
}))
vi.mock('@main/lib/search/resolve-search-provider', () => ({
  resolveSearchProvider: vi.fn()
}))

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: router } = await import('@main/lib/server/routes/settings')
const { getPresenceToken, PRESENCE_HEADER } = await import('@main/lib/presence')
const app = new Hono()
app.route('/', router)
app.onError(errorHandler)

const body = JSON.stringify({
  id: 1,
  agents: {
    maxRunning: 5,
    cliPaths: { 'claude-code': '/evil/claude' },
    projectsDir: '/evil'
  }
})
const save = (headers: Record<string, string>, env?: object, text = body) =>
  app.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: text
    },
    env
  )
const written = () =>
  (
    updateSettings.mock.calls.at(-1) as unknown as [
      { agents: Record<string, unknown> }
    ]
  )[0].agents

describe('settings write keeps the CLI path and projects folder', () => {
  beforeEach(() => updateSettings.mockClear())

  it('from a process on loopback without the token', async () => {
    await save({})
    expect(written()).toMatchObject({
      maxRunning: 5,
      cliPaths: { 'claude-code': '/good/claude' },
      projectsDir: '/good'
    })
  })

  it('agents: null keeps the stored block as it is', async () => {
    await save({}, undefined, JSON.stringify({ id: 1, agents: null }))
    expect(written()).toEqual({
      cliPaths: { 'claude-code': '/good/claude' },
      projectsDir: '/good',
      maxRunning: 3,
      keepAliveMinutes: 7,
      worktrees: true,
      defaultEmployeesCreated: { 'claude-code': true }
    })
  })

  it('no agents key leaves the column untouched', async () => {
    await save({}, undefined, JSON.stringify({ id: 1 }))
    const payload = updateSettings.mock.calls.at(-1) as unknown as [
      Record<string, unknown>
    ]
    expect('agents' in payload[0]).toBe(false)
  })

  it('an object keeps its own numbers but the stored path and folder', async () => {
    await save({})
    expect(written()).toMatchObject({
      maxRunning: 5,
      cliPaths: { 'claude-code': '/good/claude' },
      projectsDir: '/good'
    })
  })

  it('the window may not point projectsDir at Exodus data, home or root', async () => {
    const headers = { [PRESENCE_HEADER]: getPresenceToken() }
    for (const dir of ['/', '/data/exodus', '/data/exodus/projects', '/data']) {
      const res = await save(
        headers,
        undefined,
        JSON.stringify({ id: 1, agents: { worktrees: true, projectsDir: dir } })
      )
      expect(res.status, dir).toBe(400)
    }
    const ok = await save(
      headers,
      undefined,
      JSON.stringify({
        id: 1,
        agents: {
          worktrees: true,
          projectsDir: '/Volumes/work/Exodus Projects'
        }
      })
    )
    expect(ok.status).toBe(200)
  })

  it('from a paired phone', async () => {
    await save({}, { listener: 'lan' })
    expect(written().projectsDir).toBe('/good')
  })

  it('but the Exodus window changes them', async () => {
    await save({ [PRESENCE_HEADER]: getPresenceToken() })
    expect(written()).toMatchObject({
      cliPaths: { 'claude-code': '/evil/claude' },
      projectsDir: '/evil'
    })
  })

  it('no one, not even the window, changes whether the default employee was added', async () => {
    for (const headers of [{}, { [PRESENCE_HEADER]: getPresenceToken() }]) {
      await save(
        headers,
        undefined,
        JSON.stringify({
          id: 1,
          agents: {
            worktrees: true,
            defaultEmployeesCreated: { 'claude-code': false }
          }
        })
      )
      expect(written().defaultEmployeesCreated).toEqual({
        'claude-code': true
      })
      await save(
        headers,
        undefined,
        JSON.stringify({ id: 1, agents: { worktrees: true } })
      )
      expect(written().defaultEmployeesCreated).toEqual({
        'claude-code': true
      })
    }
  })
})
