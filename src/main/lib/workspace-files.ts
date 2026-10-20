import { readFile, realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'path'

import {
  WORKSPACE_FILE_MAX_BYTES,
  workspaceFileKind,
  type WorkspaceFileInfo,
  type WorkspaceFileReadResult,
  type WorkspaceFileStatResult
} from '@actovia/shared/types/workspace-files'

/**
 * A file the chat's tools wrote, checked before anything is done with it
 * (spec: the desktop file card, clickable paths, the phone's View). The path
 * is the page's or the phone's, so nothing is trusted: it must name an
 * existing regular file whose real path — every symlink resolved, the root's
 * own included — lies inside the workspace root. A `..`, a symlink out of
 * the workspace, the root itself or a directory is refused before any open,
 * reveal or read.
 */

export interface WorkspacePathOptions {
  /** The directory the file must be inside: every chat's workspaces, or one chat's. */
  root: string
  /** What a relative path is resolved against; without it a relative path is refused. */
  base?: string
  /** What `~/` stands for. */
  home?: string
}

const MAX_PATH_LENGTH = 4096

/** The path made absolute (`~/`, or against `base`), or null when it is not a usable path. */
export function expandWorkspacePath(
  input: unknown,
  { base, home = homedir() }: Omit<WorkspacePathOptions, 'root'>
): string | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text || text.length > MAX_PATH_LENGTH || text.includes('\0')) {
    return null
  }
  if (text.startsWith('~/')) return resolve(join(home, text.slice(2)))
  if (isAbsolute(text)) return resolve(text)
  return base ? resolve(base, text) : null
}

/** Strictly inside: the root itself is not inside itself. */
export function isInsideDir(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..'
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

/** The file, once it is known to be a regular file inside the root. */
export async function statWorkspaceFile(
  input: unknown,
  options: WorkspacePathOptions
): Promise<WorkspaceFileStatResult> {
  const absolute = expandWorkspacePath(input, options)
  if (!absolute) return { ok: false, reason: 'invalid-path' }
  let realRoot: string
  try {
    realRoot = await realpath(options.root)
  } catch {
    // No workspace yet: nothing can be inside it.
    return { ok: false, reason: 'not-found' }
  }
  let real: string
  try {
    real = await realpath(absolute)
  } catch (error) {
    const code = codeOf(error)
    // A missing file outside the root is still "outside": say no more than that.
    if (
      !isInsideDir(absolute, resolve(options.root)) &&
      !isInsideDir(absolute, realRoot)
    ) {
      return { ok: false, reason: 'outside-workspace' }
    }
    return {
      ok: false,
      reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'not-found' : 'failed'
    }
  }
  if (!isInsideDir(real, realRoot)) {
    return { ok: false, reason: 'outside-workspace' }
  }
  try {
    const info = await stat(real)
    if (!info.isFile()) return { ok: false, reason: 'not-a-file' }
    const file: WorkspaceFileInfo = {
      path: real,
      name: basename(real),
      size: info.size,
      modifiedAt: info.mtimeMs
    }
    return { ok: true, file }
  } catch {
    return { ok: false, reason: 'not-found' }
  }
}

/** Text when every byte is valid UTF-8 and none is NUL; null for anything binary. */
export function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** The file's text for a preview: refused past `maxBytes`, or when it is not text. */
export async function readWorkspaceFile(
  input: unknown,
  options: WorkspacePathOptions,
  maxBytes = WORKSPACE_FILE_MAX_BYTES
): Promise<WorkspaceFileReadResult> {
  const found = await statWorkspaceFile(input, options)
  if (!found.ok) return found
  const { file } = found
  if (file.size > maxBytes) return { ok: false, reason: 'too-large', file }
  let bytes: Buffer
  try {
    bytes = await readFile(file.path)
  } catch {
    return { ok: false, reason: 'not-found', file }
  }
  // It may have grown between the stat and the read.
  if (bytes.length > maxBytes) return { ok: false, reason: 'too-large', file }
  const content = decodeText(bytes)
  if (content === null) return { ok: false, reason: 'binary', file }
  return {
    ok: true,
    file: { ...file, size: bytes.length },
    kind: workspaceFileKind(file.name),
    content
  }
}

/**
 * Extensions a double-click runs instead of opening: an app bundle, a script
 * Terminal executes, an installer, a shortcut that points elsewhere. The model
 * wrote the file, so "Open" must never become "run".
 */
const RUNS_WHEN_OPENED = new Set([
  '.app',
  '.command',
  '.tool',
  '.terminal',
  '.sh',
  '.bash',
  '.zsh',
  '.csh',
  '.fish',
  '.py',
  '.pyw',
  '.scpt',
  '.scptd',
  '.applescript',
  '.workflow',
  '.action',
  '.pkg',
  '.mpkg',
  '.dmg',
  '.jar',
  '.webloc',
  '.inetloc',
  '.fileloc',
  '.url',
  '.desktop',
  '.appimage',
  '.run',
  '.prefpane',
  '.saver',
  '.kext',
  '.plugin',
  '.mobileconfig',
  '.configprofile'
])

/** What Windows runs on a double-click besides. */
const RUNS_WHEN_OPENED_WINDOWS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.lnk',
  '.scr',
  '.cpl'
])

/** Whether Open may hand this file to the system: not executable, not something that runs. */
export async function opensSafely(
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  const ext = extname(path).toLowerCase()
  if (RUNS_WHEN_OPENED.has(ext)) return false
  if (platform === 'win32') return !RUNS_WHEN_OPENED_WINDOWS.has(ext)
  try {
    const info = await stat(path)
    // An executable bit with no extension opens in Terminal on macOS.
    return (info.mode & 0o111) === 0
  } catch {
    return false
  }
}
