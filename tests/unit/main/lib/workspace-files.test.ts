// src/main/lib/workspace-files.ts — the check every workspace file action
// (desktop Open / Reveal / Quick look, the phone's View) goes through: a
// regular file whose real path is inside the root, nothing else.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const {
  decodeText,
  expandWorkspacePath,
  isInsideDir,
  opensSafely,
  readWorkspaceFile,
  statWorkspaceFile
} = await import('@main/lib/workspace-files')

// realpath: on macOS the tmp dir is itself behind a symlink (/var → /private/var).
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'actovia-ws-files-')))
const root = join(scratch, 'workspace')
const chat = join(root, 'chat-1')
const outside = join(scratch, 'outside')
mkdirSync(join(chat, 'notes'), { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(chat, 'rules.md'), '# Rules\n\n- buy low\n')
writeFileSync(join(chat, 'notes', 'a.txt'), 'plain')
writeFileSync(join(chat, 'image.png'), Buffer.from([0x89, 0x50, 0, 1, 2]))
writeFileSync(join(chat, 'latin1.txt'), Buffer.from([0x63, 0x61, 0xe9]))
writeFileSync(join(chat, 'big.txt'), 'x'.repeat(2048))
writeFileSync(join(outside, 'secret.txt'), 'secret')
// A symlink inside the workspace that points out of it, and one that stays in.
symlinkSync(join(outside, 'secret.txt'), join(chat, 'escape.txt'))
symlinkSync(outside, join(chat, 'escape-dir'))
symlinkSync(join(chat, 'rules.md'), join(chat, 'alias.md'))

const opts = { root, home: scratch }

describe('expandWorkspacePath', () => {
  it('expands ~/ and keeps an absolute path, resolved', () => {
    expect(expandWorkspacePath('~/workspace/x', opts)).toBe(
      join(scratch, 'workspace', 'x')
    )
    expect(expandWorkspacePath(`${chat}/notes/../rules.md`, opts)).toBe(
      join(chat, 'rules.md')
    )
  })

  it('resolves a relative path only against a base', () => {
    expect(expandWorkspacePath('rules.md', opts)).toBeNull()
    expect(expandWorkspacePath('rules.md', { ...opts, base: chat })).toBe(
      join(chat, 'rules.md')
    )
  })

  it.each([[''], ['   '], [42], [null], ['a\0b'], ['/'.repeat(5000)]])(
    'refuses %j',
    (input) => {
      expect(expandWorkspacePath(input, opts)).toBeNull()
    }
  )
})

describe('isInsideDir', () => {
  it('is strict, and not fooled by a shared prefix or a ..-named file', () => {
    expect(isInsideDir('/w/a/b', '/w/a')).toBe(true)
    expect(isInsideDir('/w/a', '/w/a')).toBe(false)
    expect(isInsideDir('/w/ab', '/w/a')).toBe(false)
    expect(isInsideDir('/w', '/w/a')).toBe(false)
    expect(isInsideDir('/w/a/..x', '/w/a')).toBe(true)
  })
})

describe('statWorkspaceFile', () => {
  it('finds a file inside, by absolute and by ~/ path', async () => {
    const byPath = await statWorkspaceFile(join(chat, 'rules.md'), opts)
    expect(byPath).toMatchObject({
      ok: true,
      file: { path: join(chat, 'rules.md'), name: 'rules.md' }
    })
    expect(
      await statWorkspaceFile('~/workspace/chat-1/rules.md', opts)
    ).toEqual(byPath)
  })

  it('follows a symlink that stays inside, to its real path', async () => {
    expect(await statWorkspaceFile(join(chat, 'alias.md'), opts)).toMatchObject(
      { ok: true, file: { path: join(chat, 'rules.md') } }
    )
  })

  it.each([
    ['a file outside', join(outside, 'secret.txt')],
    ['a traversal out of the root', `${chat}/../../outside/secret.txt`],
    ['a ~/ traversal', '~/workspace/../outside/secret.txt'],
    ['a symlink out of the workspace', join(chat, 'escape.txt')],
    ['a file under a symlinked dir', join(chat, 'escape-dir', 'secret.txt')],
    ['a missing file outside', join(outside, 'nope.txt')]
  ])('refuses %s as outside', async (_label, path) => {
    expect(await statWorkspaceFile(path, opts)).toEqual({
      ok: false,
      reason: 'outside-workspace'
    })
  })

  it('says not-found for a missing file inside, not-a-file for a directory or the root', async () => {
    expect(await statWorkspaceFile(join(chat, 'nope.md'), opts)).toEqual({
      ok: false,
      reason: 'not-found'
    })
    expect(await statWorkspaceFile(join(chat, 'notes'), opts)).toEqual({
      ok: false,
      reason: 'not-a-file'
    })
    expect((await statWorkspaceFile(root, opts)).ok).toBe(false)
  })

  it('confines a chat to its own workspace when that is the root', async () => {
    mkdirSync(join(root, 'chat-2'), { recursive: true })
    writeFileSync(join(root, 'chat-2', 'theirs.md'), 'x')
    expect(
      await statWorkspaceFile(join(root, 'chat-2', 'theirs.md'), {
        root: chat,
        base: chat
      })
    ).toEqual({ ok: false, reason: 'outside-workspace' })
  })

  it('says not-found when the workspace does not exist yet', async () => {
    expect(
      await statWorkspaceFile(join(scratch, 'none', 'x.md'), {
        root: join(scratch, 'none')
      })
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('readWorkspaceFile', () => {
  it('reads Markdown as markdown and anything else as text', async () => {
    expect(await readWorkspaceFile(join(chat, 'rules.md'), opts)).toMatchObject(
      { ok: true, kind: 'markdown', content: '# Rules\n\n- buy low\n' }
    )
    expect(
      await readWorkspaceFile(join(chat, 'notes', 'a.txt'), opts)
    ).toMatchObject({ ok: true, kind: 'text', content: 'plain' })
  })

  it('refuses a file past the cap, and a binary one', async () => {
    expect(
      await readWorkspaceFile(join(chat, 'big.txt'), opts, 1024)
    ).toMatchObject({ ok: false, reason: 'too-large', file: { size: 2048 } })
    expect(
      await readWorkspaceFile(join(chat, 'image.png'), opts)
    ).toMatchObject({ ok: false, reason: 'binary' })
    expect(
      await readWorkspaceFile(join(chat, 'latin1.txt'), opts)
    ).toMatchObject({ ok: false, reason: 'binary' })
  })

  it('never reads through a symlink out of the workspace', async () => {
    const read = await readWorkspaceFile(join(chat, 'escape.txt'), opts)
    expect(read).toEqual({ ok: false, reason: 'outside-workspace' })
  })
})

describe('decodeText', () => {
  it('takes UTF-8 and refuses NUL or invalid bytes', () => {
    expect(decodeText(Buffer.from('héllo · 你好'))).toBe('héllo · 你好')
    expect(decodeText(Buffer.from([0x61, 0, 0x62]))).toBeNull()
    expect(decodeText(Buffer.from([0xff, 0xfe]))).toBeNull()
  })
})

describe('opensSafely', () => {
  it('opens documents, never what would run', async () => {
    expect(await opensSafely(join(chat, 'rules.md'), 'darwin')).toBe(true)
    for (const name of ['run.command', 'x.app', 'tool.sh', 'a.py']) {
      writeFileSync(join(chat, name), '')
      expect(await opensSafely(join(chat, name), 'darwin'), name).toBe(false)
    }
    expect(await opensSafely(join(chat, 'setup.exe'), 'win32')).toBe(false)
  })

  it('refuses an executable file without an extension', async () => {
    const path = join(chat, 'runme')
    writeFileSync(path, '#!/bin/sh\n')
    chmodSync(path, 0o755)
    expect(await opensSafely(path, 'darwin')).toBe(false)
  })
})
