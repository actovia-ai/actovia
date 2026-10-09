import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgent = vi.fn(async () => ({}))
let existing: Array<{ runtime: string }> = []
let state = 'ready'
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createAgent: (...a: unknown[]) => createAgent(...(a as [])),
  getAllAgents: async () => existing
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: async () => ({ id: 'claude-code', state })
}))

const { ensureDefaultCliEmployees } =
  await import('@main/lib/agents/default-employees')

describe('ensureDefaultCliEmployees', () => {
  beforeEach(() => {
    createAgent.mockClear()
    existing = []
    state = 'ready'
  })

  it('adds a Claude Code employee when the CLI is Ready and none exists', async () => {
    await ensureDefaultCliEmployees()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'claude-code', name: 'Claude Code' })
    )
  })

  it('adds nothing when an employee already runs on it', async () => {
    existing = [{ runtime: 'claude-code' }]
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('adds nothing when the CLI is not Ready', async () => {
    state = 'missing'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
  })
})
