import { app, BrowserWindow } from 'electron'

/**
 * Actovia never drives itself with Computer Use, whatever the allowlist says:
 * a session pointed at Actovia's own window could press "Allow once" on a
 * paused tool call (the approval gate) or change its own settings, with no
 * human in the loop. Both allowlist checks — the tool's exact-name gate and
 * the session's re-check of the resolved window — refuse a target that is
 * Actovia, and the Settings app picker never offers it.
 *
 * Actovia is recognised by its bundle id (the packaged `app.yancey.actovia`;
 * in a dev run the prebuilt Electron.app, `com.github.Electron`) and by the
 * CGWindowIDs of its own windows. Not by name: "Actovia" is also the name of
 * unrelated apps. The helper does not report a window's owner pid, so the
 * window ids stand in for it.
 */
export const ACTOVIA_BUNDLE_ID = 'app.yancey.actovia'
const DEV_BUNDLE_ID = 'com.github.electron'

export interface SelfIdentity {
  /** Lower-cased. */
  bundleIds: string[]
  windowIds: number[]
}

function currentIdentity(): SelfIdentity {
  const bundleIds = [ACTOVIA_BUNDLE_ID]
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

/** Whether a bundle id / window is Actovia itself. */
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

function intersects(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  )
}

/**
 * Whether one of Actovia's own windows could take input aimed at `bounds`
 * (screen points): a visible window over that rect that has the focus or
 * floats above other apps. The helper leaves Actovia's windows out of its
 * window list, so the session cannot see them in the stacking order; once
 * the target app is activated, these are the only ones still above it.
 */
export function selfWindowCovers(
  bounds: [number, number, number, number]
): boolean {
  try {
    return BrowserWindow.getAllWindows().some((w) => {
      if (!w.isVisible() || !(w.isFocused() || w.isAlwaysOnTop())) return false
      const r = w.getBounds()
      return intersects([r.x, r.y, r.width, r.height], bounds)
    })
  } catch {
    // No Electron windows (a unit test).
    return false
  }
}
