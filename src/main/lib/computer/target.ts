// Computer Runtime — target-window resolution.
//
// Turns a user-supplied app name ("Chess", "Chrome") into a concrete
// `TargetWindow` (CGWindowID + screen bounds) via `helper.listWindows()`, and
// re-reads a tracked window's bounds/title each session step (windows move and
// get retitled while a session runs).
//
// Pure apart from the injected `InputHelper`; unit-tested with an inline stub.

import type { InputHelper, TargetWindow } from './types'

/** Thrown by `resolveTarget` when no open window matches the query. */
export class TargetNotFound extends Error {
  constructor(query: string, message?: string) {
    super(message ?? `No window found for "${query}"`)
    this.name = 'TargetNotFound'
  }
}

/** Thrown by `refreshBounds` when the tracked app has no window open. */
export class WindowGone extends Error {
  constructor(cgWindowId: number) {
    super(`Window ${cgWindowId} is gone`)
    this.name = 'WindowGone'
  }
}

/**
 * Resolve `appQuery` to the single best-matching open window.
 *
 * A window is a candidate when its `app` OR `bundleId` contains `appQuery`
 * case-insensitively. Among candidates the best is chosen by: a non-empty
 * `title` first, then the larger screen area (`bounds[2] * bounds[3]`). Throws
 * `TargetNotFound` when nothing matches.
 */
export async function resolveTarget(
  appQuery: string,
  helper: InputHelper
): Promise<TargetWindow> {
  const needle = appQuery.toLowerCase()
  const wins = await helper.listWindows()
  const candidates = wins.filter(
    (w) =>
      w.app.toLowerCase().includes(needle) ||
      w.bundleId.toLowerCase().includes(needle)
  )
  if (candidates.length === 0) throw new TargetNotFound(appQuery)
  return best(candidates)
}

/** A titled window first, then the largest. */
function best(candidates: TargetWindow[]): TargetWindow {
  return [...candidates].sort((a, b) => {
    const byTitle = titleRank(a) - titleRank(b)
    if (byTitle !== 0) return byTitle
    return area(b) - area(a)
  })[0]
}

/**
 * `resolveTarget`, but when nothing matches and `launch` is set, ask the helper
 * to open (`activate`) the app, then poll for its window to appear.
 *
 * `launch` MUST only be true for an app the caller is authorised to drive — the
 * session passes `true` only when `appQuery` exactly matches an allowlist entry.
 * The window that eventually resolves is still re-checked against the allowlist
 * by the session before any action runs.
 */
export async function resolveOrLaunch(
  appQuery: string,
  helper: InputHelper,
  opts: { launch: boolean; retries?: number; retryDelayMs?: number }
): Promise<TargetWindow> {
  try {
    return await resolveTarget(appQuery, helper)
  } catch (err) {
    if (!(err instanceof TargetNotFound) || !opts.launch) throw err
  }

  await helper.activate(appQuery)

  const retries = opts.retries ?? 5
  const delayMs = opts.retryDelayMs ?? 1000
  for (let i = 0; i < retries; i++) {
    await sleep(delayMs)
    try {
      return await resolveTarget(appQuery, helper)
    } catch (err) {
      if (!(err instanceof TargetNotFound)) throw err
    }
  }
  throw new TargetNotFound(
    appQuery,
    `Opened "${appQuery}" but its window did not appear`
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Re-read the live `bounds` and `title` of a tracked window — it may have moved,
 * resized, or been retitled since `resolveTarget`. Returns a fresh
 * `TargetWindow` that keeps `cgWindowId` / `app` / `bundleId` from `t`.
 *
 * When the window has closed, the session follows the same app (the exact
 * bundle id, so the allowlist and self checks made on `t` still hold) to its
 * best remaining window: Chess replaces its window for a new game, and the
 * session used to end there with "Window … is gone" (2026-10-22). The caller
 * re-checks a window it is handed with a new id. Throws `WindowGone` only
 * when the app has no window on screen.
 */
export async function refreshBounds(
  t: TargetWindow,
  helper: InputHelper
): Promise<TargetWindow> {
  const wins = await helper.listWindows()
  const w = wins.find((x) => x.cgWindowId === t.cgWindowId)
  if (w) return { ...t, bounds: w.bounds, title: w.title }
  // A window with no bundle id names no app: nothing to follow.
  const same = t.bundleId
    ? wins.filter((x) => x.bundleId === t.bundleId && x.app === t.app)
    : []
  if (same.length === 0) throw new WindowGone(t.cgWindowId)
  const next = best(same)
  return {
    ...t,
    cgWindowId: next.cgWindowId,
    bounds: next.bounds,
    title: next.title
  }
}

/** Windows with a non-empty title sort ahead of those without. */
function titleRank(w: TargetWindow): number {
  return w.title !== '' ? 0 : 1
}

function area(w: TargetWindow): number {
  return w.bounds[2] * w.bounds[3]
}

/**
 * `refreshBounds`, raising the app once when none of its windows is on
 * screen: the helper lists the current Space only, and a window on another
 * Space (or behind a switch the user made) read as gone.
 */
export async function refreshOrRaise(
  t: TargetWindow,
  helper: InputHelper,
  settleMs: number
): Promise<TargetWindow> {
  try {
    return await refreshBounds(t, helper)
  } catch (err) {
    if (!(err instanceof WindowGone)) throw err
  }
  await helper.activate(t.bundleId || t.app)
  await sleep(settleMs)
  return refreshBounds(t, helper)
}
