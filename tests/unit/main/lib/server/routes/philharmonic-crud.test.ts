import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('electron', () => ({}))
const createAgent = vi.fn(async (d: unknown) => d)
const updateAgent = vi.fn(async (_id: string, d: unknown) => d)
let stored = { runtime: 'claude-code' }
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createAgent: (d: unknown) => createAgent(d),
  updateAgent: (id: string, d: unknown) => updateAgent(id, d),
  deleteAgent: vi.fn(),
  getAgentById: async () => stored,
  getAgentMemories: vi.fn(),
  getAllAgents: vi.fn()
}))
vi.mock('@main/lib/db/team-queries', () => ({
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
  getAllTeams: vi.fn(),
  updateTeam: vi.fn()
}))
vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  listInstalledSkills: vi.fn()
}))

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: philharmonicCrud } =
  await import('@main/lib/server/routes/philharmonic-crud')
const app = new Hono()
app.route('/', philharmonicCrud)
app.onError(errorHandler)

const send = (method: string, path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('a CLI employee’s model', () => {
  beforeEach(() => {
    createAgent.mockClear()
    updateAgent.mockClear()
    stored = { runtime: 'claude-code' }
  })

  it('takes model names as the CLI knows them', async () => {
    for (const model of [
      'opus',
      'claude-opus-4-1',
      'opus[1m]',
      'us.anthropic.claude:1'
    ])
      expect(
        (
          await send('POST', '/agents', {
            name: 'CC',
            runtime: 'claude-code',
            model
          })
        ).status,
        model
      ).toBe(201)
  })

  it('refuses anything the CLI could read as a flag or that is not a name, on create and on edit', async () => {
    for (const model of [
      '--dangerously-skip-permissions',
      '-p',
      'opus x',
      'a;b',
      ''
    ])
      expect(
        (
          await send('POST', '/agents', {
            name: 'CC',
            runtime: 'claude-code',
            model
          })
        ).status,
        model
      ).toBe(400)
    expect(createAgent).not.toHaveBeenCalled()
    // An edit without a runtime is checked against the stored one.
    expect((await send('PUT', '/agents/a1', { model: '--yolo' })).status).toBe(
      400
    )
    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('leaves an Exodus employee’s model to Exodus', async () => {
    stored = { runtime: 'exodus' }
    expect(
      (await send('PUT', '/agents/a1', { model: 'gpt 5 / mini' })).status
    ).toBe(200)
    expect(
      (await send('POST', '/agents', { name: 'E', model: '-anything-' })).status
    ).toBe(201)
  })
})
