// src/main/lib/ai/skills/skills-store.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { SkillDetail } from '@actovia/shared/types/skills'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const root = mkdtempSync(join(tmpdir(), 'actovia-skills-store-'))
let skillsDir: string

const detail: SkillDetail = {
  id: 'acme/tools/hello',
  source: 'acme/tools',
  slug: 'hello',
  installs: 42,
  hash: 'abcdef0123456789abcdef',
  files: [
    { path: 'SKILL.md', contents: '---\nname: Hello World\n---\n# Hi\n' },
    { path: 'scripts/run.sh', contents: 'echo hi\n' }
  ]
}

afterAll(() => rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  skillsDir = mkdtempSync(join(root, 'dir-'))
})

describe('skills-store', () => {
  it('installs files under <skillsDir>/<slug> and records the lockfile last', async () => {
    const { installSkill, readLockfile } =
      await import('@main/lib/ai/skills/skills-store')
    const installed = await installSkill(detail, skillsDir)

    expect(installed).toMatchObject({
      slug: 'hello',
      displayName: 'Hello World',
      version: 'abcdef012345',
      isActive: true,
      source: 'skills.sh',
      registryId: 'acme/tools/hello',
      installPath: join(skillsDir, 'hello')
    })
    expect(
      readFileSync(join(skillsDir, 'hello', 'SKILL.md'), 'utf8')
    ).toContain('# Hi')
    expect(existsSync(join(skillsDir, 'hello', 'scripts', 'run.sh'))).toBe(true)

    const lock = await readLockfile(skillsDir)
    expect(lock.skills.hello.displayName).toBe('Hello World')
  })

  it('refuses a file path that escapes the skill directory', async () => {
    const { installSkill } = await import('@main/lib/ai/skills/skills-store')
    await expect(
      installSkill(
        {
          ...detail,
          files: [{ path: '../../evil.txt', contents: 'x' }]
        },
        skillsDir
      )
    ).rejects.toThrow(/outside the skill directory/)
    expect(existsSync(join(skillsDir, '..', 'evil.txt'))).toBe(false)
  })

  it('lists, toggles and uninstalls through the lockfile', async () => {
    const {
      installSkill,
      listInstalledSkills,
      toggleSkillActive,
      uninstallSkill
    } = await import('@main/lib/ai/skills/skills-store')
    await installSkill(detail, skillsDir)

    expect(await listInstalledSkills(skillsDir)).toHaveLength(1)

    await toggleSkillActive('hello', false, skillsDir)
    expect((await listInstalledSkills(skillsDir))[0].isActive).toBe(false)

    await uninstallSkill('hello', skillsDir)
    expect(await listInstalledSkills(skillsDir)).toEqual([])
    expect(existsSync(join(skillsDir, 'hello'))).toBe(false)

    // Unknown slugs are a no-op, not an error.
    await expect(uninstallSkill('ghost', skillsDir)).resolves.toBeUndefined()
  })

  it('tolerates a missing or malformed lockfile', async () => {
    const { readLockfile } = await import('@main/lib/ai/skills/skills-store')
    expect(await readLockfile(skillsDir)).toEqual({ skills: {} })
  })
})
