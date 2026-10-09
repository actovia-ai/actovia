import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgent = vi.fn(async () => ({}))
let existing: Array<{ runtime: string }> = []
let state = 'ready'
let agentsSettings: Record<string, unknown> | null = null
const updateSettingField = vi.fn(async (_field: string, value: unknown) => {
  agentsSettings = value as Record<string, unknown>
})
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createAgent: (...a: unknown[]) => createAgent(...(a as [])),
  getAllAgents: async () => existing
}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({ agents: agentsSettings }),
  updateSettingField: (f: string, v: unknown) => updateSettingField(f, v)
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: async () => ({ id: 'claude-code', state })
}))

const { ensureDefaultCliEmployees } =
  await import('@main/lib/agents/default-employees')

describe('ensureDefaultCliEmployees', () => {
  beforeEach(() => {
    createAgent.mockClear()
    updateSettingField.mockClear()
    existing = []
    state = 'ready'
    agentsSettings = { worktrees: false }
  })

  it('adds a Claude Code employee when the CLI is Ready and none exists, and records it', async () => {
    await ensureDefaultCliEmployees()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'claude-code', name: 'Claude Code' })
    )
    expect(updateSettingField).toHaveBeenCalledWith('agents', {
      worktrees: false,
      defaultEmployeeCreated: true
    })
  })

  it('never adds it again once recorded — not after the owner deleted it', async () => {
    await ensureDefaultCliEmployees()
    existing = []
    createAgent.mockClear()
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('adds nothing beside an employee the owner made, and records the default as settled', async () => {
    existing = [{ runtime: 'claude-code' }]
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(agentsSettings).toMatchObject({ defaultEmployeeCreated: true })
  })

  it('adds nothing and records nothing when the CLI is not Ready', async () => {
    state = 'missing'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(updateSettingField).not.toHaveBeenCalled()
  })

  it('two checks landing together add one employee', async () => {
    await Promise.all([
      ensureDefaultCliEmployees(),
      ensureDefaultCliEmployees()
    ])
    expect(createAgent).toHaveBeenCalledTimes(1)
  })
})
