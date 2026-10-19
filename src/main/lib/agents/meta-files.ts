import { randomUUID } from 'crypto'
import { constants, openSync } from 'fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'fs/promises'
import { dirname, join } from 'path'

import type { Project } from '../db/schema'

/**
 * A new project's agents work inside the folder that holds `.exodus/`, so
 * anything under it may have been swapped for a symlink. Actovia' writes there
 * go through these helpers and never follow a link.
 */

async function assertRealDir(path: string): Promise<void> {
  const st = await lstat(path)
  if (st.isSymbolicLink() || !st.isDirectory())
    throw new Error(`Refusing to use ${path}: not a real directory`)
}

/** The meta dir (or a subdir of it), created if missing, proven free of symlinks. */
export async function assertMetaDir(
  project: Pick<Project, 'dir'>,
  ...subdirs: string[]
): Promise<string> {
  const root = join(project.dir, '.exodus')
  await mkdir(root, { recursive: true }).catch(() => {})
  await assertRealDir(root)
  if ((await realpath(root)) !== join(await realpath(project.dir), '.exodus'))
    throw new Error(`Refusing to use ${root}: it resolves elsewhere`)
  let current = root
  for (const part of subdirs.flatMap((s) => s.split('/').filter(Boolean))) {
    current = join(current, part)
    await mkdir(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EEXIST') throw e
    })
    await assertRealDir(current)
  }
  return current
}

/** Atomic write; a symlink at the target is replaced, never followed. */
export async function writeMetaFile(
  project: Pick<Project, 'dir'>,
  relPath: string,
  content: string
): Promise<void> {
  const parent = dirname(relPath)
  const dir = await assertMetaDir(project, ...(parent === '.' ? [] : [parent]))
  const target = join(dir, relPath.split('/').pop() as string)
  const tmp = `${target}.${randomUUID()}.tmp`
  const handle = await open(
    tmp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  )
  try {
    await handle.writeFile(content, 'utf8')
    await handle.close()
    await rename(tmp, target)
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw error
  }
}

/** An append-only fd for a log under the meta; fails on a symlink. */
export async function openMetaLog(
  project: Pick<Project, 'dir'>,
  relPath: string
): Promise<number> {
  const parent = dirname(relPath)
  const dir = await assertMetaDir(project, ...(parent === '.' ? [] : [parent]))
  return openSync(
    join(dir, relPath.split('/').pop() as string),
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW,
    0o600
  )
}
