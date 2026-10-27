import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'

/**
 * Where a file tool's `path` points: `~` is the user's home, an absolute path
 * is itself, and anything else is relative to `baseDir` — the chat's
 * workspace (the Group's in Philharmonic), never the main process's cwd,
 * which is the repo in a dev build and `/` once packaged (ISSUE-113). The
 * approval gate resolves a relative path against the same base.
 */
export function resolveToolPath(path: string, baseDir: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(baseDir, path)
}
