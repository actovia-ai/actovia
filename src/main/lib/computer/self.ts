import { app, BrowserWindow } from 'electron'

/**
 * Exodus never drives itself with Computer Use, whatever the allowlist says:
 * a session pointed at Exodus's own window could press "Allow once" on a
 * paused tool call (the approval gate) or change its own settings, with no
 * human in the loop. Both allowlist checks — the tool's exact-name gate and
 * the session's re-check of the resolved window — refuse a target that is
 * Exodus, and the Settings app picker never offers it.
 *
 * Exodus is recognised by its bundle id (the packaged `app.yancey.exodus`;
 * in a dev run the prebuilt Electron.app, `com.github.Electron`) and by the
 * CGWindowIDs of its own windows. Not by name: "Exodus" is also the name of
 * unrelated apps. The helper does not report a window's owner pid, so the
 * window ids stand in for it.
 */
export const EXODUS_BUNDLE_ID = 'app.yancey.exodus'
const DEV_BUNDLE_ID = 'com.github.electron'

export interface SelfIdentity {
  /** Lower-cased. */
  bundleIds: string[]
  windowIds: number[]
}

function currentIdentity(): SelfIdentity {
  const bundleIds = [EXODUS_BUNDLE_ID]
  let windowIds: number[] = []
  try {
    if (!app.isPackaged) bundleIds.push(DEV_BUNDLE_ID)
  } catch {
    // No Electron `app` (a unit test): the packaged id alone.
  }
  try {
    windowIds = BrowserWindow.getAllWindows().flatMap((w) => {
      // macOS: "window:<CGWindowID>:0".
      const m = /^window:(\d+):/u.exec(w.getMediaSourceId())
      return m ? [Number(m[1])] : []
    })
  } catch {
    // No windows to know of.
  }
  return { bundleIds, windowIds }
}

let override: SelfIdentity | null = null

/** Tests only: pin who "self" is. */
export function setSelfIdentityForTests(identity: SelfIdentity | null): void {
  override = identity
}

export function selfIdentity(): SelfIdentity {
  return override ?? currentIdentity()
}

/** Whether a bundle id / window is Exodus itself. */
export function isSelfTarget(target: {
  bundleId?: string
  cgWindowId?: number
}): boolean {
  const id = selfIdentity()
  const bundleId = target.bundleId?.trim().toLowerCase()
  if (bundleId && id.bundleIds.includes(bundleId)) return true
  return (
    target.cgWindowId !== undefined && id.windowIds.includes(target.cgWindowId)
  )
}

export const SELF_TARGET_MESSAGE =
  'Actovia cannot control its own window with Computer Use.'
