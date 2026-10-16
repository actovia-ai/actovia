import { employeeLabel } from '@main/lib/ai/philharmonic/lcm/labels'
import { describe, expect, it } from 'vitest'

describe('employeeLabel', () => {
  it('names the author of a report', () => {
    expect(
      employeeLabel({ name: 'Writer', runtime: 'exodus', model: 'gpt-5.5' })
    ).toBe('[Writer]')
    expect(
      employeeLabel({ name: 'CC', runtime: 'claude-code', model: 'opus' })
    ).toBe('[CC · Claude Code · opus]')
    expect(employeeLabel({ name: 'Cx', runtime: 'codex', model: null })).toBe(
      '[Cx · Codex · CLI default]'
    )
    expect(employeeLabel(undefined)).toBe('[former employee]')
  })
})
