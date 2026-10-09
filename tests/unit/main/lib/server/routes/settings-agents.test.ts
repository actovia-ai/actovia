import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('electron', () => ({}))
const updateSettings = vi.fn(async () => ({}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({
    agents: {
      cliPaths: { 'claude-code': '/good/claude' },
      projectsDir: '/good'
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
const save = (headers: Record<string, string>, env?: object) =>
  app.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body
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
})
