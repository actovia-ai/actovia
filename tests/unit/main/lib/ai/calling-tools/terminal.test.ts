import { existsSync, mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { terminal } from '@main/lib/ai/calling-tools/terminal'
import { afterAll, describe, expect, it } from 'vitest'

// realpath: macOS's tmpdir is a symlink, and `pwd` prints the real path.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'actovia-terminal-')))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('terminal', () => {
  it('runs in the bound default directory, creating it on first use', async () => {
    const workspace = join(base, 'chat-1')
    expect(existsSync(workspace)).toBe(false)
    const tool = terminal(workspace)
    const r = await tool.execute('t', { command: 'pwd' })
    expect(existsSync(workspace)).toBe(true)
    expect((r.details as { cwd: string; stdout: string }).stdout.trim()).toBe(
      workspace
    )
    expect((r.details as { cwd: string }).cwd).toBe(workspace)
  })

  it('an explicit cwd wins over the default', async () => {
    const tool = terminal(join(base, 'chat-2'))
    const r = await tool.execute('t', { command: 'pwd', cwd: base })
    expect((r.details as { stdout: string }).stdout.trim()).toBe(base)
  })

  it('defaults to the home directory when bound without one', async () => {
    const tool = terminal()
    const r = await tool.execute('t', { command: 'pwd' })
    expect((r.details as { stdout: string }).stdout.trim()).toBe(
      realpathSync(process.env.HOME!)
    )
  })
})
