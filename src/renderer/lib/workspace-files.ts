import {
  WORKSPACE_FILE_CHANNELS,
  type WorkspaceFileFailure,
  type WorkspaceFileActionResult,
  type WorkspaceFileMenuResult,
  type WorkspaceFileReadResult,
  type WorkspaceFileStatResult,
  type WorkspaceRoots
} from '@actovia/shared/types/workspace-files'
import type { TFunction } from 'i18next'

import { toast } from '@/components/ui/toast'

/**
 * The page's side of the workspace file bridge
 * (`src/main/lib/workspace-file-actions.ts`): it names a path, main checks it
 * is a file inside the workspace and does the rest. A bridge that is missing
 * or throws reads as a failure, never as a file.
 */

function invoke<T>(channel: string, path: string | undefined, fallback: T) {
  const bridge = window.electron?.ipcRenderer
  if (!bridge) return Promise.resolve(fallback)
  return bridge
    .invoke(channel, path)
    .then((result) => (result ?? fallback) as T)
    .catch(() => fallback)
}

const FAILED = { ok: false, reason: 'failed' } as const

export function getWorkspaceRoots(): Promise<WorkspaceRoots | null> {
  return invoke<WorkspaceRoots | null>(
    WORKSPACE_FILE_CHANNELS.roots,
    undefined,
    null
  )
}

export function statWorkspaceFile(
  path: string
): Promise<WorkspaceFileStatResult> {
  return invoke<WorkspaceFileStatResult>(
    WORKSPACE_FILE_CHANNELS.stat,
    path,
    FAILED
  )
}

export function readWorkspaceFile(
  path: string
): Promise<WorkspaceFileReadResult> {
  return invoke<WorkspaceFileReadResult>(
    WORKSPACE_FILE_CHANNELS.read,
    path,
    FAILED
  )
}

export function openWorkspaceFile(
  path: string
): Promise<WorkspaceFileActionResult> {
  return invoke<WorkspaceFileActionResult>(
    WORKSPACE_FILE_CHANNELS.open,
    path,
    FAILED
  )
}

export function revealWorkspaceFile(
  path: string
): Promise<WorkspaceFileActionResult> {
  return invoke<WorkspaceFileActionResult>(
    WORKSPACE_FILE_CHANNELS.reveal,
    path,
    FAILED
  )
}

export function workspaceFileMenu(
  path: string
): Promise<WorkspaceFileMenuResult> {
  return invoke<WorkspaceFileMenuResult>(
    WORKSPACE_FILE_CHANNELS.contextMenu,
    path,
    { action: null }
  )
}

/** A size for a card's meta line: "612 B", "2.3 KB", "1.4 MB" in the UI's language. */
export function formatFileSize(bytes: number, locale?: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1
  }).format(value)
}

/** The last segment of a path, for a title. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

/** The `chat` namespace's `t` (a hook's; this module stays hook-free). */
export type ChatT = TFunction<'chat'>

function failureDescription(
  reason: WorkspaceFileFailure,
  t: ChatT
): string | undefined {
  if (reason === 'not-found' || reason === 'not-a-file') {
    return t('workspaceFile.missingDescription')
  }
  if (reason === 'outside-workspace' || reason === 'invalid-path') {
    return t('workspaceFile.outsideDescription')
  }
}

/**
 * Open in the default app — or, for a file that would run instead of open,
 * show it in its folder and say why. Failures are toasted here.
 */
export async function openWorkspaceFileWithFeedback(
  path: string,
  t: ChatT
): Promise<void> {
  const result = await openWorkspaceFile(path)
  if (result.ok) return
  if (result.reason === 'unsafe-to-open') {
    const shown = await revealWorkspaceFile(path)
    toast.add({
      type: 'info',
      title: t('workspaceFile.unsafeTitle'),
      description: t('workspaceFile.unsafeDescription')
    })
    if (shown.ok) return
  }
  toast.add({
    type: 'error',
    title: t('workspaceFile.openFailed'),
    description: failureDescription(result.reason, t)
  })
}

export async function revealWorkspaceFileWithFeedback(
  path: string,
  t: ChatT
): Promise<void> {
  const result = await revealWorkspaceFile(path)
  if (result.ok) return
  toast.add({
    type: 'error',
    title: t('workspaceFile.revealFailed'),
    description: failureDescription(result.reason, t)
  })
}

/**
 * The native right-click menu. Open / Reveal run in main; Quick look is
 * the caller's (`onPreview`), since the page draws it.
 */
export async function openWorkspaceFileMenu(
  path: string,
  t: ChatT,
  onPreview: () => void
): Promise<void> {
  const chosen = await workspaceFileMenu(path)
  if (chosen.action === 'preview') {
    onPreview()
  } else if (chosen.action === 'open' && !chosen.result.ok) {
    if (chosen.result.reason === 'unsafe-to-open') {
      await openWorkspaceFileWithFeedback(path, t)
    } else {
      toast.add({
        type: 'error',
        title: t('workspaceFile.openFailed'),
        description: failureDescription(chosen.result.reason, t)
      })
    }
  } else if (chosen.action === 'reveal' && !chosen.result.ok) {
    toast.add({
      type: 'error',
      title: t('workspaceFile.revealFailed'),
      description: failureDescription(chosen.result.reason, t)
    })
  }
}

/** Finder / Explorer / the file manager, by platform. */
export function revealLabelKey(
  platform: string = window.electron?.process?.platform ?? ''
):
  | 'workspaceFile.revealInFinder'
  | 'workspaceFile.showInExplorer'
  | 'workspaceFile.showInFolder' {
  if (platform === 'darwin') return 'workspaceFile.revealInFinder'
  if (platform === 'win32') return 'workspaceFile.showInExplorer'
  return 'workspaceFile.showInFolder'
}
