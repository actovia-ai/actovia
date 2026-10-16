import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgent = vi.fn(async () => ({}))
let existing: Array<{ runtime: string }> = []
let state = 'ready'
let codexState = 'ready'
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
  getCliStatus: async (id: string) => ({
    id,
    state: id === 'codex' ? codexState : state
  })
}))

const { ensureDefaultCliEmployees } =
  await import('@main/lib/agents/default-employees')

describe('ensureDefaultCliEmployees', () => {
  beforeEach(() => {
    createAgent.mockClear()
    updateSettingField.mockClear()
    existing = []
    state = 'ready'
    codexState = 'ready'
    agentsSettings = { worktrees: false }
  })

  it('adds a Claude Code employee when the CLI is Ready and none exists, and records it', async () => {
    codexState = 'not_installed'
    await ensureDefaultCliEmployees()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'claude-code', name: 'Claude Code' })
    )
    expect(updateSettingField).toHaveBeenCalledWith('agents', {
      worktrees: false,
      defaultEmployeesCreated: { 'claude-code': true }
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
    codexState = 'not_installed'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(agentsSettings).toMatchObject({
      defaultEmployeesCreated: { 'claude-code': true }
    })
  })

  it('adds nothing and records nothing when no CLI is Ready', async () => {
    state = 'missing'
    codexState = 'missing'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(updateSettingField).not.toHaveBeenCalled()
  })

  it('two checks landing together add each employee once', async () => {
    await Promise.all([
      ensureDefaultCliEmployees(),
      ensureDefaultCliEmployees()
    ])
    expect(createAgent).toHaveBeenCalledTimes(2)
  })

  it('adds only Codex once Claude Code was settled earlier', async () => {
    agentsSettings = { defaultEmployeesCreated: { 'claude-code': true } }
    await ensureDefaultCliEmployees()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'codex', name: 'Codex' })
    )
    expect(agentsSettings).toEqual({
      defaultEmployeesCreated: { 'claude-code': true, codex: true }
    })
  })

  it('leaves the Codex flag unset while Codex is not Ready', async () => {
    agentsSettings = { defaultEmployeesCreated: { 'claude-code': true } }
    codexState = 'not_installed'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(updateSettingField).not.toHaveBeenCalled()
    expect(agentsSettings).toEqual({
      defaultEmployeesCreated: { 'claude-code': true }
    })
  })

  it('flags Codex without a second employee when the owner made one', async () => {
    existing = [{ runtime: 'codex' }]
    state = 'missing'
    await ensureDefaultCliEmployees()
    expect(createAgent).not.toHaveBeenCalled()
    expect(agentsSettings).toMatchObject({
      defaultEmployeesCreated: { codex: true }
    })
  })

  it('merges the flags into the settings as they are when written', async () => {
    createAgent.mockImplementationOnce(async () => {
      agentsSettings = { worktrees: true, maxRunning: 5 }
      return {}
    })
    await ensureDefaultCliEmployees()
    expect(agentsSettings).toMatchObject({
      worktrees: true,
      maxRunning: 5,
      defaultEmployeesCreated: { 'claude-code': true, codex: true }
    })
  })
})
