import {
  ComputerUseSchema,
  SettingsSchema
} from '@actovia/shared/schemas/settings-schema'
import { settings } from '@main/lib/db/schema'
import { describe, expect, it } from 'vitest'

describe('computer use schema', () => {
  it('ComputerUseSchema.parse({}) applies the three defaults', () => {
    expect(ComputerUseSchema.parse({})).toEqual({
      enabled: false,
      targetAllowlist: [],
      model: 'claude'
    })
  })

  it('ComputerUseSchema keeps provided enabled + maxSteps', () => {
    const parsed = ComputerUseSchema.parse({ enabled: true, maxSteps: 40 })
    expect(parsed.enabled).toBe(true)
    expect(parsed.maxSteps).toBe(40)
  })

  it('ComputerUseSchema rejects an out-of-range maxSteps', () => {
    expect(() => ComputerUseSchema.parse({ maxSteps: 101 })).toThrow()
  })

  it('SettingsSchema accepts a computerUse block', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'global',
        computerUse: { enabled: true },
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ).not.toThrow()
  })

  it('settings table has a computerUse column', () => {
    expect(Object.keys(settings)).toContain('computerUse')
  })
})
