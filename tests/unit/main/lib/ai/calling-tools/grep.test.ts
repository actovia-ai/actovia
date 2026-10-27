import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { grep } from '@main/lib/ai/calling-tools/grep'
import { afterAll, describe, expect, it } from 'vitest'

const base = mkdtempSync(join(tmpdir(), 'actovia-grep-'))
writeFileSync(join(base, 'foobar.ts'), 'TARGET\n')
writeFileSync(join(base, 'nomatch.ts'), 'TARGET\n')
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('grep file_glob matching', () => {
  it('matches a file against a glob with more than one wildcard', async () => {
    const r = await grep().execute('t', {
      pattern: 'TARGET',
      path: base,
      file_glob: '*bar*'
    })
    const files = (r.details as { results: { file: string }[] }).results.map(
      (x) => x.file
    )
    expect(files).toContain(join(base, 'foobar.ts'))
    expect(files).not.toContain(join(base, 'nomatch.ts'))
  })
})

describe('grep and symlinks', () => {
  it('never follows a link out of its root (file or directory)', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'actovia-grep-outside-'))
    const root = mkdtempSync(join(tmpdir(), 'actovia-grep-root-'))
    try {
      writeFileSync(join(outside, 'id_rsa'), 'SECRET KEY\n')
      mkdirSync(join(outside, 'dir'))
      writeFileSync(join(outside, 'dir', 'x.txt'), 'SECRET KEY\n')
      writeFileSync(join(root, 'own.txt'), 'SECRET KEY\n')
      symlinkSync(join(outside, 'id_rsa'), join(root, 'link-file'))
      symlinkSync(join(outside, 'dir'), join(root, 'link-dir'))
      const r = await grep().execute('t', { pattern: 'SECRET', path: root })
      const files = (r.details as { results: { file: string }[] }).results.map(
        (x) => x.file
      )
      expect(files).toEqual([join(root, 'own.txt')])
    } finally {
      rmSync(outside, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})
