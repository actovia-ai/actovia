import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('electron', () => ({ dialog: {}, shell: {} }))
vi.mock('@main/lib/window', () => ({ getMainWindow: () => null }))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async () => {}
}))
vi.mock('@main/lib/db/project-queries', () => ({
  getProjectById: async () => {},
  listRecentProjects: async () => [],
  updateProject: vi.fn()
}))
vi.mock('@main/lib/agents/projects', async () => {
  const { ErrorCode, ValidationError } = await import('@actovia/shared')
  return {
    bindConversation: vi.fn(),
    createNewProject: vi.fn(),
    gitBranch: vi.fn(),
    openFolderAsProject: vi.fn(async () => {
      throw new ValidationError(
        ErrorCode.VALIDATION_FAILED,
        'Your home folder is too broad — choose a folder inside it'
      )
    })
  }
})

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: router } = await import('@main/lib/server/routes/projects')
const app = new Hono()
app.route('/', router)
app.onError(errorHandler)

const send = (method: string, path: string, body?: unknown, env?: object) =>
  app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    },
    env
  )

describe('projects routes', () => {
  it('a refused folder is a 400 carrying the validation message', async () => {
    const res = await send('POST', '/open', { folder: '/Users/o' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe(
      'Your home folder is too broad — choose a folder inside it'
    )
  })

  it('a paired phone may read but not change folders', async () => {
    const lan = { listener: 'lan' }
    expect((await send('GET', '/', undefined, lan)).status).toBe(200)
    for (const [method, path, body] of [
      ['POST', '/', { name: 'x' }],
      ['POST', '/pick', undefined],
      ['POST', '/open', { folder: '/x' }],
      ['PUT', '/conversations/c1', { projectId: null }],
      ['PATCH', '/p1', { useWorktrees: false }]
    ] as const) {
      const res = await send(method, path, body, lan)
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('FORBIDDEN')
    }
  })
})
