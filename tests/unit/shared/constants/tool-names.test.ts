import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { describe, expect, it } from 'vitest'

describe('tool names', () => {
  it('are snake_case and unique', () => {
    const values = Object.values(TOOL_NAMES)
    // 24 built-ins + the two MCP toolbox tools.
    expect(values).toHaveLength(26)
    expect(new Set(values).size).toBe(26)
    for (const v of values) expect(v).toMatch(/^[a-z]+(_[a-z]+)*$/u)
  })
})
