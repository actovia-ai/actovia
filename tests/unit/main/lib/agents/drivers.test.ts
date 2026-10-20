// tests/unit/main/lib/agents/drivers.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
const { DRIVERS, cliOf } = await import('@main/lib/agents/drivers')

describe('drivers', () => {
  it('has one for every CLI, each with its own resume arguments', () => {
    expect(DRIVERS['claude-code'].resumeArgs('abc')).toEqual([
      '--resume',
      'abc'
    ])
    expect(DRIVERS.codex.resumeArgs('abc')).toEqual(['resume', 'abc'])
  })
  it('maps a CLI runtime and refuses Actovia’ own', () => {
    expect(cliOf('codex')).toBe('codex')
    expect(cliOf('claude-code')).toBe('claude-code')
    expect(() => cliOf('actovia')).toThrow()
    expect(() => cliOf('nope')).toThrow()
  })
})
