// src/main/lib/ai/skills/skills-manager.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, describe, expect, it, vi } from 'vitest'

const skillsDir = mkdtempSync(join(tmpdir(), 'actovia-skills-manager-'))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/paths', () => ({ getSkillsDir: () => skillsDir }))

afterAll(() => rmSync(skillsDir, { recursive: true, force: true }))

function seed(slug: string, isActive: boolean, body: string) {
  const dir = join(skillsDir, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  return {
    displayName: slug,
    version: 'v',
    isActive,
    installPath: dir,
    installedAt: 1
  }
}

describe('skills-manager (seam)', () => {
  it('indexes active skills — one line each, description from the frontmatter — and inlines by slug', async () => {
    const lock = {
      skills: {
        alpha: seed(
          'alpha',
          true,
          '---\nname: Alpha\ndescription: Draw charts and diagrams\n---\nRun $SKILL_DIR/go.sh\n'
        ),
        folded: seed(
          'folded',
          true,
          '---\nname: Folded\ndescription: >\n  Book flights\n  and hotels\nlicense: MIT\n---\nBody\n'
        ),
        bare: seed(
          'bare',
          true,
          '---\nname: Bare\n---\n# Bare\n\nFirst paragraph of the body, used when the frontmatter has no description.\n\nSecond paragraph.\n'
        ),
        beta: seed('beta', false, '---\nname: Beta\n---\nBeta body\n'),
        empty: seed('empty', true, '---\nname: Empty\n---\n\n'),
        missing: {
          displayName: 'missing',
          version: 'v',
          isActive: true,
          installPath: join(skillsDir, 'nope'),
          installedAt: 1
        }
      }
    }
    writeFileSync(join(skillsDir, '.lock.json'), JSON.stringify(lock))

    const {
      getActiveSkillsContent,
      getActiveSkillsIndex,
      getSkillsContentBySlugs,
      listInstalledSkills
    } = await import('@main/lib/ai/skills/skills-manager')

    // Full bodies, $SKILL_DIR baked in — what Philharmonic still consumes.
    const active = await getActiveSkillsContent()
    expect(active.startsWith('\n\n<active_skills>\n')).toBe(true)
    expect(active).toContain(
      `<skill name="alpha">\nRun ${join(skillsDir, 'alpha')}/go.sh\n</skill>`
    )
    expect(active).not.toContain('name: Alpha') // frontmatter stripped
    expect(active).not.toContain('<skill name="beta">') // inactive

    const index = await getActiveSkillsIndex()
    const lines = index.split('\n')
    expect(lines).toContain(
      `- alpha: Draw charts and diagrams — ${join(skillsDir, 'alpha')}/SKILL.md`
    )
    // A folded (>) description is one line again.
    expect(lines).toContain(
      `- folded: Book flights and hotels — ${join(skillsDir, 'folded')}/SKILL.md`
    )
    // No description: the body's first paragraph stands in.
    expect(lines).toContain(
      `- bare: First paragraph of the body, used when the frontmatter has no description. — ${join(skillsDir, 'bare')}/SKILL.md`
    )
    expect(index).not.toContain('Run ') // bodies are not inlined
    expect(index).not.toContain('beta') // inactive
    expect(index).not.toContain('empty') // blank body skipped
    expect(index).not.toContain('missing') // no SKILL.md on disk
    expect(lines).toHaveLength(3)
    // By slug, whatever order the lockfile holds them in: the index is part
    // of the system prompt, which the provider caches by its exact bytes.
    expect(lines.map((l) => l.slice(2, l.indexOf(':')))).toEqual([
      'alpha',
      'bare',
      'folded'
    ])

    // By-slug ignores the active flag (a Philharmonic agent's explicit pick)
    // and preserves the requested order.
    const bySlug = await getSkillsContentBySlugs(['beta', 'alpha', 'ghost'])
    expect(bySlug.indexOf('<skill name="beta">')).toBeLessThan(
      bySlug.indexOf('<skill name="alpha">')
    )
    expect(bySlug).not.toContain('ghost')

    expect(await getSkillsContentBySlugs([])).toBe('')
    expect((await listInstalledSkills()).map((s) => s.slug).sort()).toEqual([
      'alpha',
      'bare',
      'beta',
      'empty',
      'folded',
      'missing'
    ])
  })

  it('the index is empty when no skill is active', async () => {
    writeFileSync(
      join(skillsDir, '.lock.json'),
      JSON.stringify({ skills: { beta: seed('beta', false, 'Beta') } })
    )
    const { getActiveSkillsIndex } =
      await import('@main/lib/ai/skills/skills-manager')
    expect(await getActiveSkillsIndex()).toBe('')
  })
})
