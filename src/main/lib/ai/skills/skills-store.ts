import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

import type {
  InstalledSkill,
  SkillDetail,
  SkillFile,
  SkillsLockfile
} from '@actovia/shared/types/skills'

import { getSkillsDir } from '../../paths'

/**
 * On-disk skill store: `<skillsDir>/<slug>/…` plus `<skillsDir>/.lock.json`.
 * Same layout and lockfile shape as actovia-cli's `skills-store.ts`, so a
 * skill installed by either is visible to both. `skillsDir` is a parameter
 * (defaulting to `~/.actovia/skills`) so tests run against a temp dir.
 */

const LOCK_FILE = '.lock.json'

function lockfilePath(skillsDir: string): string {
  return join(skillsDir, LOCK_FILE)
}

/** A registry payload could name `../../etc/x` — never write outside the slug dir. */
function resolveSafeFilePath(skillDir: string, filePath: string): string {
  const root = resolve(skillDir)
  const target = resolve(skillDir, filePath)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(
      `Refusing to write outside the skill directory: ${filePath}`
    )
  }
  return target
}

export async function readLockfile(
  skillsDir = getSkillsDir()
): Promise<SkillsLockfile> {
  try {
    const raw = await readFile(lockfilePath(skillsDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SkillsLockfile>
    return { skills: parsed.skills ?? {} }
  } catch {
    return { skills: {} }
  }
}

export async function writeLockfile(
  lock: SkillsLockfile,
  skillsDir = getSkillsDir()
): Promise<void> {
  await mkdir(skillsDir, { recursive: true })
  await writeFile(
    lockfilePath(skillsDir),
    JSON.stringify(lock, null, 2),
    'utf-8'
  )
}

/** `name:` from SKILL.md's frontmatter, else the slug. */
export function parseDisplayName(files: SkillFile[], fallback: string): string {
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  if (!skillMd) return fallback
  const match = skillMd.contents.match(/^---[\s\S]*?name:\s*(.+)/m)
  return match?.[1]?.trim() || fallback
}

/**
 * Writes the skill's files, then records it in the lockfile — files first so
 * a crash mid-install never leaves a lockfile entry pointing at a partial
 * directory. Re-installing replaces the directory wholesale.
 */
export async function installSkill(
  detail: SkillDetail,
  skillsDir = getSkillsDir()
): Promise<InstalledSkill> {
  const skillDir = join(skillsDir, detail.slug)
  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })

  for (const file of detail.files) {
    const target = resolveSafeFilePath(skillDir, file.path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, file.contents, 'utf-8')
  }

  const lock = await readLockfile(skillsDir)
  const entry: Omit<InstalledSkill, 'slug'> = {
    displayName: parseDisplayName(detail.files, detail.slug),
    // skills.sh has no semver per skill; its content hash is the version.
    version: detail.hash.slice(0, 12),
    isActive: true,
    installPath: skillDir,
    installedAt: Date.now(),
    source: 'skills.sh',
    registryId: detail.id
  }
  lock.skills[detail.slug] = entry
  await writeLockfile(lock, skillsDir)
  return { slug: detail.slug, ...entry }
}

export async function uninstallSkill(
  slug: string,
  skillsDir = getSkillsDir()
): Promise<void> {
  const lock = await readLockfile(skillsDir)
  const entry = lock.skills[slug]
  if (!entry) return
  if (existsSync(entry.installPath)) {
    await rm(entry.installPath, { recursive: true, force: true })
  }
  delete lock.skills[slug]
  await writeLockfile(lock, skillsDir)
}

export async function toggleSkillActive(
  slug: string,
  isActive: boolean,
  skillsDir = getSkillsDir()
): Promise<void> {
  const lock = await readLockfile(skillsDir)
  const entry = lock.skills[slug]
  if (!entry) return
  entry.isActive = isActive
  await writeLockfile(lock, skillsDir)
}

export async function listInstalledSkills(
  skillsDir = getSkillsDir()
): Promise<InstalledSkill[]> {
  const lock = await readLockfile(skillsDir)
  return Object.entries(lock.skills).map(([slug, info]) => ({ slug, ...info }))
}
