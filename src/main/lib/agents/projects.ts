// src/main/lib/agents/projects.ts
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import {
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile
} from 'fs/promises'
import { homedir } from 'os'
import { basename, join, relative, sep } from 'path'

import { ErrorCode, ValidationError } from '@actovia/shared'

import {
  getConversationById,
  updateConversation
} from '../db/conversation-queries'
import {
  createProject,
  getProjectByDir,
  getProjectById,
  listRecentProjects,
  updateProject
} from '../db/project-queries'
import type { AgentSession, Project } from '../db/schema'
import { getActoviaHome, getGroupDir } from '../paths'
import { assertMetaDir, writeMetaFile } from './meta-files'
import { agentSettings } from './settings'

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'project'
}

const fail = (message: string): never => {
  throw new ValidationError(ErrorCode.VALIDATION_FAILED, message)
}

/** Spec §4 / §7.3: a real folder, never `~`, `/`, or Actovia' own data. */
export async function assertWorkableFolder(folder: string): Promise<string> {
  let real: string
  try {
    real = await realpath(folder)
  } catch {
    return fail('Not a folder')
  }
  if (!(await stat(real)).isDirectory()) fail('Not a folder')
  if (real === '/') fail('The root folder cannot be used')
  if (real === (await realpath(homedir())))
    fail('Your home folder is too broad — choose a folder inside it')
  const data = await realpath(getActoviaHome()).catch(() => getActoviaHome())
  if (real === data || real.startsWith(data + sep))
    fail("Actovia's own data folder cannot be used")
  const home = await realpath(homedir())
  if (home.startsWith(real + sep) || data.startsWith(real + sep))
    fail(
      "This folder contains your home folder or Actovia's data — choose a folder inside it"
    )
  return real
}

export const metaDir = (project: Pick<Project, 'dir'>) =>
  join(project.dir, '.actovia')
/** Open the log with `openMetaLog`/O_NOFOLLOW after `assertMetaDir(project, 'logs')`; never follow a link. */
export const sessionLogPath = (
  project: Pick<Project, 'dir'>,
  sessionId: string
) => join(metaDir(project), 'logs', `${sessionId}.jsonl`)

async function uniqueDir(parent: string, name: string): Promise<string> {
  const base = slugify(name)
  for (let i = 1; ; i++) {
    const dir = join(parent, i === 1 ? base : `${base}-${i}`)
    if (!existsSync(dir) && !(await getProjectByDir(dir))) return dir
  }
}

async function writeProjectJson(
  project: Project,
  conversationId: string | null = null
) {
  const file = join(metaDir(project), 'project.json')
  const previous = await readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  await writeMetaFile(
    project,
    'project.json',
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        workDir: project.workDir,
        createdAt: project.createdAt,
        conversationId: conversationId ?? previous.conversationId ?? null
      },
      null,
      2
    ) + '\n'
  )
}

async function makeMeta(dir: string) {
  await mkdir(join(dir, '.actovia', 'sessions'), { recursive: true })
  await mkdir(join(dir, '.actovia', 'logs'), { recursive: true })
  // Git ignores the whole meta in any repo, whenever the repo is created.
  await writeFile(join(dir, '.actovia', '.gitignore'), '*\n')
}

export async function createNewProject(name: string): Promise<Project> {
  const { projectsDir } = await agentSettings()
  await mkdir(projectsDir, { recursive: true })
  const dir = await uniqueDir(projectsDir, name)
  await makeMeta(dir)
  const project = await createProject({
    name: name.trim() || basename(dir),
    dir,
    workDir: dir
  })
  await writeProjectJson(project)
  return project
}

export async function openFolderAsProject(folder: string): Promise<Project> {
  const workDir = await assertWorkableFolder(folder)
  const { projectsDir } = await agentSettings()
  const existing = (await listRecentProjects(1000)).find(
    (p) => p.workDir === workDir
  )
  if (existing) return updateProject(existing.id, { lastUsedAt: new Date() })
  await mkdir(projectsDir, { recursive: true })
  const name = basename(workDir)
  const dir = await uniqueDir(projectsDir, name)
  await makeMeta(dir)
  await symlink(workDir, join(dir, name))
  const project = await createProject({ name, dir, workDir })
  await writeProjectJson(project)
  return project
}

export async function bindConversation(
  conversationId: string,
  projectId: string | null
): Promise<void> {
  await updateConversation(conversationId, { projectId })
  if (!projectId) return
  const project = await getProjectById(projectId)
  if (!project) return
  await updateProject(projectId, { lastUsedAt: new Date() })
  await writeProjectJson(project, conversationId)
}

export async function writeSessionMeta(
  project: Pick<Project, 'dir'>,
  session: AgentSession
): Promise<void> {
  await writeMetaFile(
    project,
    `sessions/${session.id}.json`,
    JSON.stringify(session, null, 2) + '\n'
  )
}

function git(
  cwd: string,
  args: string[]
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 15_000 }, (err, stdout, stderr) =>
      resolve({
        ok: !err,
        out: String(err ? stderr || err.message : stdout).trim()
      })
    )
  })
}

export async function gitBranch(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok && r.out !== 'HEAD' ? r.out : null
}

/** Spec §4: the folder itself, or — a second agent in a git repo — a worktree of its own. */
export async function prepareWorkDir(
  project: Project,
  sessionId: string,
  othersRunning: boolean
): Promise<{ cwd: string; branch: string | null; note: string | null }> {
  const top = await git(project.workDir, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { cwd: project.workDir, branch: null, note: 'not-git' }
  const toplevel = await realpath(top.out).catch(() => top.out)
  const workReal = await realpath(project.workDir).catch(() => project.workDir)
  // A new project is its own repo or nothing: never the outer repo it sits in.
  if (project.workDir === project.dir && toplevel !== workReal)
    return { cwd: project.workDir, branch: null, note: 'not-git' }
  const current = await gitBranch(project.workDir)
  if (!project.useWorktrees || !othersRunning)
    return { cwd: project.workDir, branch: current, note: null }

  const branch = `actovia/${sessionId.slice(0, 8)}`
  let worktree: string
  try {
    worktree = join(await assertMetaDir(project, 'worktrees'), sessionId)
  } catch (error) {
    return {
      cwd: project.workDir,
      branch: current,
      note: `worktree-failed: ${(error as Error).message}`
    }
  }
  const added = await git(toplevel, ['worktree', 'add', '-b', branch, worktree])
  if (!added.ok)
    return {
      cwd: project.workDir,
      branch: current,
      note: `worktree-failed: ${added.out}`
    }
  return {
    cwd: join(worktree, relative(toplevel, workReal)),
    branch,
    note: null
  }
}

/** Where a group's `plan.md` lives: its project's meta (spec §4), else the group dir as before. */
export async function planDirFor(
  conversationId: string
): Promise<{ dir: string; project?: Project }> {
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  if (!project) return { dir: getGroupDir(conversationId) }
  return { dir: await assertMetaDir(project), project }
}
