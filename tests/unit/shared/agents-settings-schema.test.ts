import {
  AgentsSettingsSchema,
  SettingsSchema
} from '@actovia/shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

describe('agents settings schema', () => {
  it('parses an empty block to its defaults', () => {
    expect(AgentsSettingsSchema.parse({})).toEqual({
      worktrees: true,
      cliPaths: {}
    })
  })

  it('rejects a running limit outside 1–8 and a keep-alive outside 0–120', () => {
    expect(() => AgentsSettingsSchema.parse({ maxRunning: 0 })).toThrow()
    expect(() => AgentsSettingsSchema.parse({ maxRunning: 9 })).toThrow()
    expect(() =>
      AgentsSettingsSchema.parse({ keepAliveMinutes: 121 })
    ).toThrow()
  })

  it('is part of SettingsSchema', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'global',
        agents: {
          maxRunning: 3,
          cliPaths: { 'claude-code': '/opt/bin/claude' }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ).not.toThrow()
  })

  it('records default employees per CLI', () => {
    const parsed = AgentsSettingsSchema.parse({
      defaultEmployeesCreated: { 'claude-code': true }
    })
    expect(parsed.defaultEmployeesCreated).toEqual({ 'claude-code': true })
  })
})
