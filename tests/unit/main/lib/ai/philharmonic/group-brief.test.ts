import { mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
vi.mock('@main/lib/paths', () => ({
  getGroupDir: (id: string) => {
    const dir = join(root, id)
    mkdirSync(dir, { recursive: true })
    return dir
  }
}))
const {
  readGroupBrief,
  initializeGroupBrief,
  saveGroupBrief,
  groupBriefPrompt
} = await import('@main/lib/ai/philharmonic/group-brief')
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'actovia-brief-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Group-owned AGENTS.md', () => {
  it('seeds the first objective once and keeps later owner edits', async () => {
    const first = await initializeGroupBrief('g1', 'Ship a report')
    expect(first.content).toContain('Ship a report')
    const saved = await saveGroupBrief(
      'g1',
      '# New objective\nKeep my constraints',
      first.revision
    )
    expect(
      (await initializeGroupBrief('g1', 'Different request')).content
    ).toBe(saved.content)
    expect(await readFile(saved.path, 'utf8')).toBe(saved.content)
    expect(await groupBriefPrompt('g1')).toContain(saved.revision)
    expect((await readGroupBrief('g2')).exists).toBe(false)
  })
  it('serializes concurrent saves and refuses the stale writer', async () => {
    const first = await initializeGroupBrief('g1', 'First')
    const results = await Promise.allSettled([
      saveGroupBrief('g1', 'A', first.revision),
      saveGroupBrief('g1', 'B', first.revision)
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect((await readGroupBrief('g1')).content).toBe('A')
    await expect(saveGroupBrief('g1', 'stale', first.revision)).rejects.toThrow(
      'BRIEF_CONFLICT'
    )
  })
  it('rejects traversal, oversized briefs and symlinked files', async () => {
    await expect(readGroupBrief('../outside')).rejects.toThrow(
      'Invalid Group ID'
    )
    await expect(
      saveGroupBrief('g1', 'x'.repeat(16001), 'missing')
    ).rejects.toThrow('16000')
    await initializeGroupBrief('g1', 'Owner goal')
    const other = await readGroupBrief('g2')
    await symlink(join(root, 'g1', 'AGENTS.md'), other.path)
    await expect(readGroupBrief('g2')).rejects.toThrow()
  })
})
