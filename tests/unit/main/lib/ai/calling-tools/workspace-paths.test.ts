// ISSUE-113: the file tools resolve a relative path against the chat's
// workspace (the base they are bound to), never the main process's cwd.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

import { editFile } from '@main/lib/ai/calling-tools/edit-file'
import { grep } from '@main/lib/ai/calling-tools/grep'
import { listDirectory } from '@main/lib/ai/calling-tools/list-directory'
import { readFile } from '@main/lib/ai/calling-tools/read-file'
import { resolveToolPath } from '@main/lib/ai/calling-tools/tool-path'
import { writeFile } from '@main/lib/ai/calling-tools/write-file'
import { describe, expect, it } from 'vitest'

const base = () => mkdtempSync(join(tmpdir(), 'ws-'))
const NAME = `issue-113-${process.pid}.md`

describe('resolveToolPath', () => {
  it('resolves relative against the base, keeps absolute, expands ~', () => {
    expect(resolveToolPath('a/b.txt', '/ws')).toBe('/ws/a/b.txt')
    expect(resolveToolPath('/etc/hosts', '/ws')).toBe('/etc/hosts')
    expect(resolveToolPath('~', '/ws')).toBe(homedir())
    expect(resolveToolPath('~/x.md', '/ws')).toBe(join(homedir(), 'x.md'))
  })
})

describe('file tools bound to a workspace', () => {
  it('write_file writes a relative path into the workspace', async () => {
    const ws = base()
    const result = await writeFile(ws).execute('c1', {
      path: NAME,
      content: 'hello'
    })
    expect(readFileSync(join(ws, NAME), 'utf-8')).toBe('hello')
    expect(existsSync(join(process.cwd(), NAME))).toBe(false)
    expect(result.details.path).toBe(join(ws, NAME))
  })

  it('read_file, edit_file, list_directory and grep read it there', async () => {
    const ws = base()
    writeFileSync(join(ws, NAME), 'one two')
    const read = await readFile(ws).execute('c2', { path: NAME })
    expect(read.details.content).toBe('one two')
    await editFile(ws).execute('c3', {
      path: NAME,
      old_string: 'two',
      new_string: 'three'
    })
    expect(readFileSync(join(ws, NAME), 'utf-8')).toBe('one three')
    const list = await listDirectory(ws).execute('c4', { path: '.' })
    expect(list.details.entries.map((e: { name: string }) => e.name)).toContain(
      NAME
    )
    const found = await grep(ws).execute('c5', { pattern: 'three', path: '.' })
    expect(JSON.stringify(found.details)).toContain(NAME)
  })
})
