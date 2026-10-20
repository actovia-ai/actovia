import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { findFiles } from '@main/lib/ai/calling-tools/find-files'
import { afterAll, describe, expect, it } from 'vitest'

const base = mkdtempSync(join(tmpdir(), 'actovia-find-files-'))
mkdirSync(join(base, 'ws', 'sub'), { recursive: true })
writeFileSync(join(base, 'ws', 'a.ts'), '')
writeFileSync(join(base, 'ws', 'sub', 'b.ts'), '')
writeFileSync(join(base, 'outside.ts'), '')
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('find_files', () => {
  it('searches the bound default root', async () => {
    const r = await findFiles(join(base, 'ws')).execute('t', {
      pattern: '*.ts'
    })
    const found = (r.details as { files: string[] }).files ?? r.details
    expect(JSON.stringify(found)).toContain('a.ts')
    expect(JSON.stringify(found)).toContain('b.ts')
    expect(JSON.stringify(found)).not.toContain('outside.ts')
  })

  it('an explicit searchPath wins over the default', async () => {
    const r = await findFiles(join(base, 'ws')).execute('t', {
      pattern: 'outside.ts',
      searchPath: base
    })
    expect(JSON.stringify(r.details)).toContain('outside.ts')
  })

  it('a missing default root finds nothing rather than failing', async () => {
    const r = await findFiles(join(base, 'nope')).execute('t', { pattern: '*' })
    expect(JSON.stringify(r.details)).not.toContain('a.ts')
  })
})
