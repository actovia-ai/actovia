/**
 * The files a chat's tools write into its workspace (`~/.actovia/workspace/<chatId>/…`),
 * opened from the chat: a write_file / edit_file card, or a path the answer
 * mentions. The renderer names a path; the main process checks it is a file
 * inside the workspace root — through every symlink — before it opens,
 * reveals or reads anything (`src/main/lib/workspace-files.ts`). The phone
 * reads one through `GET /api/v1/workspace/:chatId/file?path=…`.
 */
export const WORKSPACE_FILE_CHANNELS = {
  /** → `WorkspaceRoots`: where the workspaces are, for the renderer's cheap pre-check. */
  roots: 'workspace-file:roots',
  /** path → `WorkspaceFileStatResult`. */
  stat: 'workspace-file:stat',
  /** path → `WorkspaceFileActionResult`: the system's default app. */
  open: 'workspace-file:open',
  /** path → `WorkspaceFileActionResult`: Finder / Explorer, the file selected. */
  reveal: 'workspace-file:reveal',
  /** path → `WorkspaceFileReadResult`: the text, for the in-app preview. */
  read: 'workspace-file:read',
  /** path → `WorkspaceFileMenuResult`: the native right-click menu. */
  contextMenu: 'workspace-file:context-menu'
} as const

/** Past this the preview (desktop and phone) says "too large" and offers Open only. */
export const WORKSPACE_FILE_MAX_BYTES = 1024 * 1024

export interface WorkspaceRoots {
  /** `~/.actovia/workspace`, as given (not resolved through symlinks). */
  root: string
  /** The user's home, what `~/` stands for. */
  home: string
}

export interface WorkspaceFileInfo {
  /** The real path (symlinks resolved). */
  path: string
  name: string
  size: number
  /** ms since the epoch. */
  modifiedAt: number
}

export type WorkspaceFileFailure =
  | 'invalid-path'
  | 'outside-workspace'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'binary'
  /** Open refused: the file would run rather than open (an app, a script, an executable). */
  | 'unsafe-to-open'
  | 'failed'

/** How the preview draws the text. */
export type WorkspaceFileKind = 'markdown' | 'text'

export type WorkspaceFileStatResult =
  | { ok: true; file: WorkspaceFileInfo }
  | { ok: false; reason: WorkspaceFileFailure }

export type WorkspaceFileActionResult =
  | { ok: true }
  | { ok: false; reason: WorkspaceFileFailure }

export type WorkspaceFileReadResult =
  | {
      ok: true
      file: WorkspaceFileInfo
      kind: WorkspaceFileKind
      content: string
    }
  | { ok: false; reason: WorkspaceFileFailure; file?: WorkspaceFileInfo }

/**
 * What the right-click menu did: main opens and reveals by itself; `preview`
 * is handed back, since the preview is drawn by the page.
 */
export type WorkspaceFileMenuResult =
  | { action: 'open' | 'reveal'; result: WorkspaceFileActionResult }
  | { action: 'preview' }
  | { action: null }

const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd|mdx)$/iu

/** Markdown by its extension; anything else is shown as plain text. */
export function workspaceFileKind(name: string): WorkspaceFileKind {
  return MARKDOWN_EXTENSIONS.test(name) ? 'markdown' : 'text'
}

/**
 * Whether a piece of an answer (an inline code span) names a file under the
 * workspace root, as an absolute or `~/` path: the absolute path when it
 * does, null otherwise. Lexical only — the caller still asks main whether the
 * file exists and really is inside (symlinks), and only then makes it a link.
 * POSIX separators: the workspace links are a macOS / Linux affordance; a
 * Windows path simply never matches.
 */
export function workspacePathCandidate(
  text: string,
  roots: WorkspaceRoots
): string | null {
  const value = text.trim()
  if (!value || value.length > 1024 || /[\n\r\t\0]/u.test(value)) return null
  let absolute: string
  if (value.startsWith('~/')) {
    absolute = `${roots.home.replace(/\/+$/u, '')}/${value.slice(2)}`
  } else if (value.startsWith('/')) {
    absolute = value
  } else {
    return null
  }
  const segments = absolute.split('/')
  // Lexically inside means no `.` / `..` segment can walk it back out.
  if (segments.some((s) => s === '..' || s === '.')) return null
  const root = roots.root.replace(/\/+$/u, '')
  if (!root || !absolute.startsWith(`${root}/`)) return null
  const rest = absolute.slice(root.length + 1).replace(/\/+$/u, '')
  // `<chatId>/<file…>`: the workspace dir itself, or a chat's, is not a file.
  if (rest.split('/').filter(Boolean).length < 2) return null
  return `${root}/${rest}`
}
