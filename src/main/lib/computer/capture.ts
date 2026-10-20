// Computer Runtime — capture + downscale.
//
// Screenshots the target window through the `actovia-input` helper and shrinks
// the PNG so the model's per-frame token cost stays bounded. Alongside the image
// travels `scaleFactor` — screenshot pixels per window POINT — which
// `hands.decompose` uses to map the model's screenshot-space coordinates back to
// the window's screen points.
//
// `computeScale` and `hashPng` are pure and unit-tested directly;
// `screenshotWindow` is the thin `nativeImage` glue.

import { nativeImage } from 'electron'

import type { ComputerState, InputHelper, TargetWindow } from './types'

/**
 * Longest edge (px) a screenshot may have before it is downscaled. A window
 * whose longer side is at or below this is sent to the model as-is.
 */
export const MAX_EDGE = 1400

/**
 * Given an original capture size (backing pixels), return the dimensions the
 * screenshot should be resized to so its longer edge is at most `MAX_EDGE`.
 *
 * When a resize is needed the LONGER side becomes exactly `MAX_EDGE` and the
 * shorter side scales proportionally (rounded to a whole pixel); a capture
 * already within `MAX_EDGE` is returned unchanged. The screenshot→screen
 * coordinate mapping lives in `screenshotWindow`'s `scaleFactor`, not here.
 */
export function computeScale(
  width: number,
  height: number
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= MAX_EDGE) {
    return { width, height }
  }

  const ratio = MAX_EDGE / longEdge
  return {
    width: width === longEdge ? MAX_EDGE : Math.round(width * ratio),
    height: height === longEdge ? MAX_EDGE : Math.round(height * ratio)
  }
}

/**
 * Cheap FNV-1a (32-bit) hash of a base64 string, returned as zero-padded hex.
 * Stable for a given input and sensitive to any change; `Guard.noteFrame` uses
 * it to notice a session that has stopped making progress (screen not changing).
 */
export function hashPng(base64: string): string {
  let hash = 2166136261
  for (let i = 0; i < base64.length; i++) {
    hash ^= base64.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Capture the target window and downscale it to fit `MAX_EDGE`. Returns the
 * screenshot in `ComputerState['screenshot']` shape plus `scaleFactor` —
 * screenshot pixels per window point — which the runtime threads into
 * `hands.decompose` / `hands.execute`.
 *
 * `scaleFactor > 1` on a Retina display with a small window (the 2× backing
 * capture outweighs any downscale); `< 1` for a large window downscaled well
 * below its point size; `== 1` when the screenshot pixel grid happens to line
 * up with the window's point grid.
 */
export async function screenshotWindow(
  t: TargetWindow,
  helper: InputHelper
): Promise<{ shot: ComputerState['screenshot']; scaleFactor: number }> {
  const buf = await helper.screenshot(t.cgWindowId)
  const img = nativeImage.createFromBuffer(buf)
  const size = img.getSize()
  const { width, height } = computeScale(size.width, size.height)
  const resized = width !== size.width || height !== size.height
  const png = resized ? img.resize({ width, height }).toPNG() : img.toPNG()

  // scaleFactor = screenshot pixels per window POINT. `bounds` is in points
  // (CGWindow global space, the space CGEvent mouse posts consume); the capture
  // is backing pixels (2× on a Retina display) then downscaled to MAX_EDGE.
  // hands.toScreen maps a model coordinate back with
  //   origin + round(coord / scaleFactor)   (origin and result are points)
  const scaleFactor = t.bounds[2] > 0 ? width / t.bounds[2] : 1

  return {
    shot: {
      data: png.toString('base64'),
      mimeType: 'image/png',
      width,
      height
    },
    scaleFactor
  }
}
