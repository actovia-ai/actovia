import { readFile } from 'fs/promises'
import { join } from 'path'

import type { InstalledSkill } from '@actovia/shared/types/skills'

import {
  listInstalledSkills as listFromStore,
  readLockfile
} from './skills-store'

/**
 * Skills integration seam — what the chat route, Philharmonic's employee loop
 * and the agent CRUD route consume. Backed by the skills.sh install store
 * (`skills-store.ts`); the marketplace itself lives behind `/api/v1/skills`.
 */

/** Skills the user has installed, for pickers such as the agent editor. */
export function listInstalledSkills(): Promise<InstalledSkill[]> {
  return listFromStore()
}

/**
 * Reads a skill's SKILL.md into a `<skill>` block: frontmatter stripped, and
 * `$SKILL_DIR` / `${SKILL_DIR}` replaced with the absolute install path —
 * skills reference bundled scripts through that variable, but the terminal
 * tool runs raw shell with nothing pre-set, so the model needs ready-to-run
 * absolute paths. Missing or empty SKILL.md → `null` (the skill is skipped).
 */
async function renderSkillBlock(
  slug: string,
  installPath: string
): Promise<string | null> {
  try {
    const content = await readFile(join(installPath, 'SKILL.md'), 'utf-8')
    const body = content
      .replace(/^---[\s\S]*?---\n?/, '')
      .replace(/\$\{SKILL_DIR\}|\$SKILL_DIR/g, installPath)
      .trim()
    return body ? `<skill name="${slug}">\n${body}\n</skill>` : null
  } catch {
    return null
  }
}

async function renderSkillsSection(
  entries: Array<{ slug: string; installPath: string }>
): Promise<string> {
  const blocks: string[] = []
  for (const { slug, installPath } of entries) {
    const block = await renderSkillBlock(slug, installPath)
    if (block) blocks.push(block)
  }
  return blocks.length > 0
    ? `\n\n<active_skills>\n${blocks.join('\n\n')}\n</active_skills>`
    : ''
}

/**
 * Prompt block for the given skill slugs (a Philharmonic agent's picks),
 * regardless of their active flag. An empty string means "nothing to
 * inject"; a real block is `\n\n<active_skills>…</active_skills>`.
 */
export async function getSkillsContentBySlugs(
  slugs: string[]
): Promise<string> {
  const lock = await readLockfile()
  const entries = slugs.flatMap((slug) => {
    const info = lock.skills[slug]
    return info ? [{ slug, installPath: info.installPath }] : []
  })
  return renderSkillsSection(entries)
}

/**
 * Prompt block for every currently-active skill, bodies inline — what a
 * Philharmonic employee without picks of its own gets. Chat uses the index
 * below instead.
 */
export async function getActiveSkillsContent(): Promise<string> {
  const lock = await readLockfile()
  const entries = Object.entries(lock.skills)
    .filter(([, info]) => info.isActive)
    .map(([slug, info]) => ({ slug, installPath: info.installPath }))
  return renderSkillsSection(entries)
}

/** The longest a skill's one-line description gets in the prompt. */
const MAX_DESCRIPTION_CHARS = 500

/**
 * A skill's `description` from its SKILL.md frontmatter — the Agent Skills
 * spec's "when to use this" field — folded onto one line. Handles the plain
 * `description: text`, quoted, and the `>` / `|` block forms. Without one,
 * the body's first paragraph (after any heading) stands in.
 */
export function skillDescription(content: string): string {
  const fm = /^---\n([\s\S]*?)\n---/u.exec(content)
  if (fm) {
    const m = /^description:[ \t]*(.*)$/mu.exec(fm[1])
    if (m) {
      let text = m[1].trim()
      if (text === '>' || text === '|' || text === '>-' || text === '|-') {
        const rest = fm[1].slice(m.index + m[0].length).split('\n')
        const block: string[] = []
        for (const line of rest) {
          if (/^[ \t]+\S/u.test(line)) block.push(line.trim())
          else if (line.trim() === '') continue
          else break
        }
        text = block.join(' ')
      }
      text = text.replace(/^(["'])(.*)\1$/u, '$2')
      if (text) return clip(text)
    }
  }
  const body = content.replace(/^---[\s\S]*?---\n?/u, '')
  const paragraph = body
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#'))
  return clip((paragraph ?? '').replace(/\s+/gu, ' '))
}

function clip(text: string): string {
  return text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    : text
}

/**
 * The index the chat prompt carries: one line per active skill — slug,
 * description, the absolute path of its SKILL.md — so the model knows what
 * is installed and reads a skill's body only when a task matches. Constant
 * prompt cost however many skills are installed (the Agent Skills spec's
 * own model). Empty string when nothing is active. A skill whose SKILL.md is
 * missing or blank is left out.
 */
export async function getActiveSkillsIndex(): Promise<string> {
  const lock = await readLockfile()
  const lines: string[] = []
  // By slug: the index is part of the system prompt, which the provider
  // caches by its exact bytes — the lockfile's order is install order.
  const entries = Object.entries(lock.skills).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  for (const [slug, info] of entries) {
    if (!info.isActive) continue
    const file = join(info.installPath, 'SKILL.md')
    let content: string
    try {
      content = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    if (!content.replace(/^---[\s\S]*?---\n?/u, '').trim()) continue
    lines.push(`- ${slug}: ${skillDescription(content)} — ${file}`)
  }
  return lines.join('\n')
}
