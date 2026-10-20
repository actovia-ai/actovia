// tests/unit/main/lib/agents/projects.test.ts
import { execFileSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// macOS' tmpdir is a symlink (/var → /private/var); the code works on real paths.
const tmp = (prefix: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)))
const projectsDir = tmp('actovia-projects-')
const settings = { projectsDir }
vi.mock('@main/lib/agents/settings', () => ({
  agentSettings: async () => ({
    projectsDir: settings.projectsDir,
    maxRunning: 2,
    keepAliveMinutes: 10,
    worktrees: true,
    cliPaths: {}
  })
}))

// In-memory project + conversation rows.
const rows = new Map<string, Record<string, unknown>>()
const convs = new Map<string, Record<string, unknown>>()
let n = 0
vi.mock('@main/lib/db/project-queries', () => ({
  createProject: async (d: Record<string, unknown>) => {
    const row = {
      id: `p${++n}`,
      useWorktrees: true,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      ...d
    }
    rows.set(row.id as string, row)
    return row
  },
  getProjectById: async (id: string) => rows.get(id),
  getProjectByDir: async (dir: string) =>
    [...rows.values()].find((r) => r.dir === dir),
  updateProject: async (id: string, d: Record<string, unknown>) =>
    Object.assign(rows.get(id)!, d),
  listRecentProjects: async () => [...rows.values()]
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async (id: string) => convs.get(id),
  updateConversation: async (id: string, d: Record<string, unknown>) =>
    Object.assign(convs.get(id)!, d)
}))
const findByWorkDir = () => [...rows.values()]

const P = await import('@main/lib/agents/projects')

beforeEach(() => {
  rows.clear()
  convs.clear()
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
function repo(): string {
  const dir = tmp('repo-')
  git(dir, 'init', '-q', '-b', 'main')
  git(
    dir,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
  return dir
}

describe('projects', () => {
  it('slugifies a name for a folder', () => {
    expect(P.slugify('Notes Prototype!')).toBe('notes-prototype')
    expect(P.slugify('笔记 原型')).toBe('笔记-原型')
    expect(P.slugify('  ')).toBe('project')
  })

  it('creates a new project folder with its hidden meta and works in it', async () => {
    const p = await P.createNewProject('Notes Prototype')
    expect(p.dir).toBe(join(projectsDir, 'notes-prototype'))
    expect(p.workDir).toBe(p.dir)
    expect(existsSync(join(p.dir, '.actovia/sessions'))).toBe(true)
    expect(existsSync(join(p.dir, '.actovia/logs'))).toBe(true)
    const meta = JSON.parse(
      readFileSync(join(p.dir, '.actovia/project.json'), 'utf8')
    )
    expect(meta).toMatchObject({
      id: p.id,
      name: 'Notes Prototype',
      workDir: p.dir
    })
  })

  it('never reuses a folder name', async () => {
    const a = await P.createNewProject('x')
    const b = await P.createNewProject('x')
    expect(b.dir).toBe(join(projectsDir, 'x-2'))
    expect(a.dir).not.toBe(b.dir)
  })

  it('opens an existing folder: meta in the projects folder, an alias to it, nothing written into it', async () => {
    const folder = tmp('tax-pdfs-')
    writeFileSync(join(folder, 'a.pdf'), '')
    const p = await P.openFolderAsProject(folder)
    expect(p.workDir).toBe(folder)
    expect(p.dir.startsWith(projectsDir)).toBe(true)
    const alias = join(p.dir, p.name)
    expect(lstatSync(alias).isSymbolicLink()).toBe(true)
    expect(readlinkSync(alias)).toBe(folder)
    expect(existsSync(join(folder, '.actovia'))).toBe(false)
  })

  it('opening the same folder twice returns the same project', async () => {
    const folder = tmp('same-')
    rows.clear()
    const a = await P.openFolderAsProject(folder)
    const b = await P.openFolderAsProject(folder)
    expect(b.id).toBe(a.id)
    expect(findByWorkDir()).toHaveLength(1)
  })

  it.each([
    ['home', homedir(), /home folder/],
    ['root', '/', /root folder/],
    ["Actovia' data", process.env.ACTOVIA_HOME!, /data folder/]
  ])('refuses %s', async (_label, folder, message) => {
    await expect(P.assertWorkableFolder(folder)).rejects.toThrow(message)
  })

  it('refuses anything inside Actovia’ data and a file', async () => {
    const inside = join(process.env.ACTOVIA_HOME!, 'groups', 'g')
    mkdirSync(inside, { recursive: true })
    await expect(P.assertWorkableFolder(inside)).rejects.toThrow(/data folder/)
    const file = join(tmp('f-'), 'x.txt')
    writeFileSync(file, '')
    await expect(P.assertWorkableFolder(file)).rejects.toThrow(/Not a folder/)
  })

  it('binds a group to a project and back to none', async () => {
    convs.set('c1', { id: 'c1', projectId: null })
    const p = await P.createNewProject('bound')
    await P.bindConversation('c1', p.id)
    expect(convs.get('c1')!.projectId).toBe(p.id)
    expect(
      JSON.parse(readFileSync(join(p.dir, '.actovia/project.json'), 'utf8'))
        .conversationId
    ).toBe('c1')
    expect((await P.planDirFor('c1')).dir).toBe(join(p.dir, '.actovia'))
    await P.bindConversation('c1', null)
    expect(convs.get('c1')!.projectId).toBeNull()
  })

  it('works in the folder itself when nobody else is running', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    const w = await P.prepareWorkDir(p, '12345678-aaaa', false)
    expect(w).toEqual({ cwd: dir, branch: 'main', note: null })
  })

  it('gives a second agent its own worktree on its own branch', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    const w = await P.prepareWorkDir(p, 'abcdef12-3456', true)
    expect(w.branch).toBe('actovia/abcdef12')
    expect(w.cwd).toBe(join(p.dir, '.actovia/worktrees/abcdef12-3456'))
    expect(git(w.cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'actovia/abcdef12'
    )
  })

  it('shares a folder that is not a git repo, and says so', async () => {
    const folder = tmp('plain-')
    const p = await P.openFolderAsProject(folder)
    expect(await P.prepareWorkDir(p, 'abcdef12-3456', true)).toEqual({
      cwd: folder,
      branch: null,
      note: 'not-git'
    })
  })

  it('keeps the meta out of a new project that is its own repo', async () => {
    const p = await P.createNewProject('own-repo')
    git(p.dir, 'init', '-q', '-b', 'main')
    git(
      p.dir,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'i'
    )
    await P.prepareWorkDir(p, 'ffffffff-0000', true)
    expect(readFileSync(join(p.dir, '.actovia/.gitignore'), 'utf8')).toBe('*\n')
    expect(git(p.dir, 'status', '--porcelain')).toBe('')
  })

  it('falls back to the shared folder when the worktree cannot be made', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    git(dir, 'branch', 'actovia/deadbeef') // the branch it would create already exists
    const w = await P.prepareWorkDir(p, 'deadbeef-0000', true)
    expect(w.cwd).toBe(dir)
    expect(w.note).toMatch(/^worktree-failed/)
  })

  it('refuses a folder that contains the home folder or the data folder', async () => {
    await expect(P.assertWorkableFolder(dirname(homedir()))).rejects.toThrow(
      /contains your home folder/
    )
    await expect(
      P.assertWorkableFolder(dirname(process.env.ACTOVIA_HOME!))
    ).rejects.toThrow(/contains your home folder/)
  })

  it('works in the same subfolder of the worktree for an opened subfolder of a repo', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'packages/app'), { recursive: true })
    writeFileSync(join(dir, 'packages/app/a.txt'), 'x')
    git(dir, 'add', '.')
    git(
      dir,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-q',
      '-m',
      'a'
    )
    const p = await P.openFolderAsProject(join(dir, 'packages/app'))
    const w = await P.prepareWorkDir(p, 'abcdef99-0000', true)
    expect(w.cwd).toBe(
      join(p.dir, '.actovia/worktrees/abcdef99-0000', 'packages/app')
    )
    expect(existsSync(join(w.cwd, 'a.txt'))).toBe(true)
  })

  it('does not treat a new project nested in an outer repo as a repo', async () => {
    const outer = repo()
    const saved = projectsDir
    const nested = join(outer, 'projects')
    mkdirSync(nested)
    settings.projectsDir = nested
    try {
      const p = await P.createNewProject('inner')
      expect(await P.prepareWorkDir(p, 'abcdef00-0000', true)).toEqual({
        cwd: p.dir,
        branch: null,
        note: 'not-git'
      })
      expect(existsSync(join(p.dir, '.actovia/worktrees'))).toBe(false)
    } finally {
      settings.projectsDir = saved
    }
  })
})
