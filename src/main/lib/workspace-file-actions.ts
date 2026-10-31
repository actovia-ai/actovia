import { homedir } from 'os'

import {
  WORKSPACE_FILE_CHANNELS,
  type WorkspaceFileActionResult,
  type WorkspaceFileMenuResult,
  type WorkspaceRoots
} from '@actovia/shared/types/workspace-files'
import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  shell
} from 'electron'

import { mainT } from './i18n'
import { logger } from './logger'
import { getGroupsDir, getWorkspacesDir } from './paths'
import {
  opensSafely,
  expandWorkspacePath,
  isInsideDir,
  readWorkspaceFile,
  statWorkspaceFile
} from './workspace-files'

/**
 * Open / Reveal / Quick look for a file a chat's tools wrote (see
 * `WORKSPACE_FILE_CHANNELS`). The page names a path; every channel checks it
 * against the workspace root (`statWorkspaceFile`: a regular file whose real
 * path is inside `~/.actovia/workspace`) before it touches it, so the bridge
 * cannot open, reveal or read anything else on the machine.
 */

function roots(): WorkspaceRoots {
  return { root: getWorkspacesDir(), home: homedir() }
}

/** Select a known workspace root lexically; stat still resolves every symlink. */
function rootForPath(input: unknown): string {
  const absolute = expandWorkspacePath(input, {})
  const groups = getGroupsDir()
  return absolute && isInsideDir(absolute, groups) ? groups : getWorkspacesDir()
}

function options(input: unknown) {
  return { root: rootForPath(input) }
}

export interface WorkspaceShell {
  openPath: (path: string) => Promise<string>
  showItemInFolder: (path: string) => void
}

/** The system's default app — never for a file that would run instead. */
export async function openWorkspaceFile(
  input: unknown,
  deps: WorkspaceShell = shell,
  root = rootForPath(input)
): Promise<WorkspaceFileActionResult> {
  const found = await statWorkspaceFile(input, { root })
  if (!found.ok) return found
  if (!(await opensSafely(found.file.path))) {
    return { ok: false, reason: 'unsafe-to-open' }
  }
  const error = await deps.openPath(found.file.path)
  if (error) {
    logger.warn('app', 'Could not open a workspace file', { error })
    return { ok: false, reason: 'failed' }
  }
  return { ok: true }
}

/** Finder / Explorer, with the file selected. */
export async function revealWorkspaceFile(
  input: unknown,
  deps: WorkspaceShell = shell,
  root = rootForPath(input)
): Promise<WorkspaceFileActionResult> {
  const found = await statWorkspaceFile(input, { root })
  if (!found.ok) return found
  deps.showItemInFolder(found.file.path)
  return { ok: true }
}

/** "Reveal in Finder" in the platform's own words. */
function revealLabel(): string {
  if (process.platform === 'darwin') {
    return mainT('menu:workspaceFile.revealInFinder', 'Reveal in Finder')
  }
  if (process.platform === 'win32') {
    return mainT('menu:workspaceFile.showInExplorer', 'Show in Explorer')
  }
  return mainT('menu:workspaceFile.showInFolder', 'Show in Folder')
}

function popupMenu(
  path: unknown,
  window: BrowserWindow | null
): Promise<WorkspaceFileMenuResult> {
  return new Promise((resolveResult) => {
    let chosen = false
    const choose = (run: () => Promise<WorkspaceFileMenuResult>) => {
      chosen = true
      void run().then(resolveResult)
    }
    const menu = Menu.buildFromTemplate([
      {
        label: mainT('menu:workspaceFile.open', 'Open'),
        click: () =>
          choose(async () => ({
            action: 'open',
            result: await openWorkspaceFile(path)
          }))
      },
      {
        label: revealLabel(),
        click: () =>
          choose(async () => ({
            action: 'reveal',
            result: await revealWorkspaceFile(path)
          }))
      },
      {
        label: mainT('menu:workspaceFile.quickLook', 'Quick Look'),
        click: () => choose(() => Promise.resolve({ action: 'preview' }))
      }
    ])
    menu.popup({
      ...(window ? { window } : {}),
      // An item's click can arrive just after the menu reports it closed.
      callback: () =>
        setTimeout(() => {
          if (!chosen) resolveResult({ action: null })
        }, 250)
    })
  })
}

/** Only a window's own top frame — never a frame it embeds. */
function fromTopFrame(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame === event.sender.mainFrame
}

function handle<T>(
  channel: string,
  refused: T,
  run: (path: unknown, event: IpcMainInvokeEvent) => Promise<T> | T
) {
  ipcMain.handle(channel, async (event, path: unknown) => {
    if (!fromTopFrame(event)) {
      logger.warn(
        'app',
        'Refused a workspace file action from an embedded frame'
      )
      return refused
    }
    try {
      return await run(path, event)
    } catch (error) {
      logger.error('app', 'Workspace file action failed', { channel, error })
      return refused
    }
  })
}

export function setupWorkspaceFileIPC(): void {
  const failed = { ok: false, reason: 'failed' } as const
  handle(WORKSPACE_FILE_CHANNELS.roots, null, () => roots())
  handle(WORKSPACE_FILE_CHANNELS.stat, failed, (path) =>
    statWorkspaceFile(path, options(path))
  )
  handle(WORKSPACE_FILE_CHANNELS.read, failed, (path) =>
    readWorkspaceFile(path, options(path))
  )
  handle(WORKSPACE_FILE_CHANNELS.open, failed, (path) =>
    openWorkspaceFile(path)
  )
  handle(WORKSPACE_FILE_CHANNELS.reveal, failed, (path) =>
    revealWorkspaceFile(path)
  )
  handle(
    WORKSPACE_FILE_CHANNELS.contextMenu,
    { action: null } as WorkspaceFileMenuResult,
    (path, event) =>
      popupMenu(path, BrowserWindow.fromWebContents(event.sender))
  )
}
