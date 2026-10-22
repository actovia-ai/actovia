// Computer Runtime — the target in front before any input.
//
// Input goes out as screen-coordinate HID events: a click lands on whatever
// window is on top at that point and a key goes to the frontmost app. The
// screenshot is of the target window alone, so the model never sees what is
// in front of it. Until 2026-10-22 nothing made sure the target was in front:
// with Actovia's own window over Chess, a click meant for the board could
// land on Actovia, and keys could go to whatever app had the focus.

import { selfWindowCovers } from './self'
import type { InputHelper, TargetWindow } from './types'

export type FrontCheck =
  | { ok: true; target: TargetWindow }
  | { ok: false; reason: string }

type Rect = [number, number, number, number]

function intersects(a: Rect, b: Rect): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  )
}

/**
 * Raises the target's app (switching to its Space) and says whether input
 * may be sent: the target window is on screen, its app is frontmost, and no
 * window of another app — nor one of Actovia's own — overlaps it. Returns the
 * window with its current bounds, which the input is mapped through.
 */
export async function bringToFront(
  target: TargetWindow,
  helper: InputHelper,
  opts: { settleMs?: number; selfCovers?: (bounds: Rect) => boolean } = {}
): Promise<FrontCheck> {
  await helper.activate(target.bundleId || target.app)
  if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs))

  // Front to back (the helper keeps CGWindowList's order).
  const wins = await helper.listWindows()
  const at = wins.findIndex((w) => w.cgWindowId === target.cgWindowId)
  if (at === -1) {
    return { ok: false, reason: `the ${target.app} window is not on screen` }
  }
  const current = { ...target, bounds: wins[at].bounds, title: wins[at].title }

  const cover = wins
    .slice(0, at)
    .find(
      (w) =>
        w.bundleId !== target.bundleId && intersects(w.bounds, current.bounds)
    )
  if (cover) {
    return {
      ok: false,
      reason: `a window of "${cover.app}" is in front of the ${target.app} window`
    }
  }
  if (wins[0].bundleId !== target.bundleId) {
    return { ok: false, reason: `${target.app} is not the frontmost app` }
  }
  if ((opts.selfCovers ?? selfWindowCovers)(current.bounds)) {
    return {
      ok: false,
      reason: `an Actovia window is in front of the ${target.app} window`
    }
  }
  return { ok: true, target: current }
}
