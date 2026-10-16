import { execFileSync } from 'child_process'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  appleScriptString,
  shellQuote,
  isCliSessionId,
  resumeScript,
  shellEscapePath
} from '@main/lib/agents/terminal'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'exodus-home-'))
vi.mock('@main/lib/paths', () => ({ getExodusHome: () => home }))

const { writeResumeScript, sweepResumeScripts, terminalDir } =
  await import('@main/lib/agents/terminal')

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
    const script = resumeScript(cwd, "/bin/it's", ['--resume', 'abc-12345'])
    expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    expect(execFileSync('sh', ['-n'], { input: script }).length).toBe(0)
    expect(script).toContain(
      `exec ${shellQuote("/bin/it's")} '--resume' 'abc-12345'`
    )
    // Run only the cd: sh must land in exactly that directory.
    const cdOnly =
      script
        .split('\n')
        .find((l) => l.startsWith('cd '))!
        .split(' && exec')[0] + ' && pwd'
    const out = execFileSync('sh', ['-c', cdOnly]).toString().trim()
    expect(realpathSync(out)).toBe(realpathSync(cwd))
  })

  it('resumes Codex with its own arguments, every word quoted', () => {
    const script = resumeScript('/p', '/bin/codex', ['resume', 'abc'])
    expect(script).toContain(`exec '/bin/codex' 'resume' 'abc'`)
    expect(execFileSync('sh', ['-n'], { input: script }).length).toBe(0)
  })

  it('escapes a path so one word reaches any shell', () => {
    expect(shellEscapePath('/Users/o/Exodus Projects/x-1/.exodus/s.sh')).toBe(
      '/Users/o/Exodus\\ Projects/x-1/.exodus/s.sh'
    )
  })

  it('accepts only an id shaped like a session id', () => {
    expect(isCliSessionId('3f2a9c1e-1111-4222-8333-444455556666')).toBe(true)
    // A Codex thread id (recorded 2026-10-10).
    expect(isCliSessionId('01a1245d-2907-72f3-9b06-3dc67f153940')).toBe(true)
    expect(isCliSessionId("x'; rm -rf ~ #")).toBe(false)
    expect(isCliSessionId('abc')).toBe(false)
  })

  it('writes the hand-off script under Exodus data, 0700, deleting itself first', async () => {
    const path = await writeResumeScript('/p', '/bin/claude', [
      '--resume',
      'abc-12345'
    ])
    expect(path.startsWith(join(home, 'run', 'terminal'))).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o700)
    const text = readFileSync(path, 'utf8')
    expect(text.split('\n').slice(0, 2)).toEqual(['#!/bin/sh', 'rm -f -- "$0"'])
    execFileSync('sh', ['-n', path])
  })

  it('refuses a symlinked run/terminal directory', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'))
    rmSync(terminalDir(), { recursive: true })
    symlinkSync(elsewhere, terminalDir())
    await expect(
      writeResumeScript('/p', '/bin/claude', ['--resume', 'abc-12345'])
    ).rejects.toThrow()
    rmSync(terminalDir())
  })

  it('sweeps only scripts older than an hour', async () => {
    mkdirSync(terminalDir(), { recursive: true })
    const old = join(terminalDir(), 'old.sh')
    const fresh = join(terminalDir(), 'fresh.sh')
    writeFileSync(old, 'x')
    writeFileSync(fresh, 'x')
    const past = new Date(Date.now() - 2 * 3_600_000)
    utimesSync(old, past, past)
    await sweepResumeScripts()
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })
})
