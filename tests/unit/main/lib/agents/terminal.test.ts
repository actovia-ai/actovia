import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  appleScriptString,
  shellQuote,
  isCliSessionId,
  resumeScript,
  shellEscapePath
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

  it('writes a script whose /bin/sh parse is exact, whatever the cwd holds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resume-'))
    const cwd = join(dir, `it's "a" \\ $(x) \`y\``)
    mkdirSync(cwd)
    const script = resumeScript(cwd, "/bin/it's", 'abc-12345')
    expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    expect(execFileSync('sh', ['-n'], { input: script }).length).toBe(0)
    expect(script).toContain(
      `exec ${shellQuote("/bin/it's")} --resume 'abc-12345'`
    )
    // Run only the cd: sh must land in exactly that directory.
    const cdOnly = script.split(' && exec')[0].split('\n')[1] + ' && pwd'
    const out = execFileSync('sh', ['-c', cdOnly]).toString().trim()
    expect(realpathSync(out)).toBe(realpathSync(cwd))
  })

  it('escapes a path so one word reaches any shell', () => {
    expect(shellEscapePath('/Users/o/Exodus Projects/x-1/.exodus/s.sh')).toBe(
      '/Users/o/Exodus\\ Projects/x-1/.exodus/s.sh'
    )
  })

  it('accepts only an id shaped like a session id', () => {
    expect(isCliSessionId('3f2a9c1e-1111-4222-8333-444455556666')).toBe(true)
    expect(isCliSessionId("x'; rm -rf ~ #")).toBe(false)
    expect(isCliSessionId('abc')).toBe(false)
  })
})
