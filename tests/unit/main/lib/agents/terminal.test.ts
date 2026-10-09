import {
  appleScriptString,
  shellQuote,
  terminalCommand
} from '@main/lib/agents/terminal'
import { describe, expect, it } from 'vitest'

describe('Continue in Terminal', () => {
  it('single-quotes for the shell, escaping single quotes', () => {
    expect(shellQuote("/Users/o/it's here")).toBe(`'/Users/o/it'\\''s here'`)
    expect(shellQuote('$(rm -rf ~)')).toBe(`'$(rm -rf ~)'`)
  })

  it('quotes for AppleScript, escaping backslashes and double quotes', () => {
    expect(appleScriptString('say "hi" \\ bye')).toBe(`"say \\"hi\\" \\\\ bye"`)
  })

  it('builds cd && claude --resume with everything quoted', () => {
    expect(terminalCommand('/p/my "repo"', '/bin/claude', 'abc-123')).toBe(
      `cd '/p/my "repo"' && '/bin/claude' --resume 'abc-123'`
    )
  })
})
