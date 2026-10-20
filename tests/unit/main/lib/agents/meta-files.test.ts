import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  assertMetaDir,
  openMetaLog,
  writeMetaFile
} from '@main/lib/agents/meta-files'
import { describe, expect, it } from 'vitest'

const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)))
function setup() {
  const dir = tmp('meta-')
  const outside = tmp('outside-')
  mkdirSync(join(dir, '.actovia'))
  return { project: { dir }, dir, outside }
}

describe('meta files', () => {
  it('writes inside a real meta dir', async () => {
    const { project, dir } = setup()
    await writeMetaFile(project, 'sessions/a.json', '{}')
    expect(readFileSync(join(dir, '.actovia/sessions/a.json'), 'utf8')).toBe(
      '{}'
    )
  })

  it('refuses a .actovia that is a symlink and writes nothing through it', async () => {
    const { project, dir, outside } = setup()
    await import('fs').then((fs) =>
      fs.rmSync(join(dir, '.actovia'), { recursive: true })
    )
    symlinkSync(outside, join(dir, '.actovia'))
    await expect(writeMetaFile(project, 'project.json', 'x')).rejects.toThrow()
    await expect(assertMetaDir(project, 'logs')).rejects.toThrow()
    expect(existsSync(join(outside, 'project.json'))).toBe(false)
    expect(existsSync(join(outside, 'logs'))).toBe(false)
  })

  it('refuses a subdir that is a symlink', async () => {
    const { project, dir, outside } = setup()
    symlinkSync(outside, join(dir, '.actovia/sessions'))
    await expect(
      writeMetaFile(project, 'sessions/a.json', 'x')
    ).rejects.toThrow()
    expect(existsSync(join(outside, 'a.json'))).toBe(false)
  })

  it('replaces a planted symlink at the target, leaving the link target alone', async () => {
    const { project, dir, outside } = setup()
    const victim = join(outside, 'rc')
    writeFileSync(victim, 'keep')
    symlinkSync(victim, join(dir, '.actovia/plan.md'))
    await writeMetaFile(project, 'plan.md', 'plan')
    expect(readFileSync(victim, 'utf8')).toBe('keep')
    expect(lstatSync(join(dir, '.actovia/plan.md')).isSymbolicLink()).toBe(
      false
    )
    expect(readFileSync(join(dir, '.actovia/plan.md'), 'utf8')).toBe('plan')
  })

  it('refuses to open a log that is a symlink', async () => {
    const { project, dir, outside } = setup()
    mkdirSync(join(dir, '.actovia/logs'))
    symlinkSync(join(outside, 'rc'), join(dir, '.actovia/logs/a.jsonl'))
    await expect(openMetaLog(project, 'logs/a.jsonl')).rejects.toThrow()
    expect(existsSync(join(outside, 'rc'))).toBe(false)
  })
})
