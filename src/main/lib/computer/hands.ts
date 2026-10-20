// Computer Runtime — the hands.
//
// Turns a high-level `Action` into the primitive-level `HelperCommand[]` the
// Swift `actovia-input` binary executes, mapping the Agent's screenshot-space
// coordinates back to the window's screen points along the way.
//
// Spec §2.4. `decompose` is pure (no I/O); `execute` is the thin async wrapper
// the session calls — it sleeps for `wait`, rejects the control actions the
// session handles itself, and otherwise hands one batch to the helper.

import type { Action, HelperCommand, InputHelper, TargetWindow } from './types'

/**
 * macOS virtual key codes — Apple's `kVK_ANSI_*` / `kVK_*` constants from
 * `<Carbon/HIToolbox/Events.h>`, the canonical ANSI-layout mapping. Covers the
 * letters and digits `type` needs plus the named keys and modifiers `hotkey` /
 * `keyDown` / `keyUp` reference (with the common aliases the model tends to
 * emit: `alt`/`option`, `ctrl`/`control`, `cmd`/`command`, `esc`, `enter`).
 */
export const KEYCODES: Record<string, number> = {
  // letters
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  o: 31,
  u: 32,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  k: 40,
  n: 45,
  m: 46,
  // digits
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '5': 23,
  '6': 22,
  '7': 26,
  '8': 28,
  '9': 25,
  '0': 29,
  // named keys
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  // modifiers
  cmd: 55,
  command: 55,
  meta: 55,
  super: 55,
  shift: 56,
  alt: 58,
  option: 58,
  opt: 58,
  ctrl: 59,
  control: 59,
  // arrows
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  arrowleft: 123,
  arrowright: 124,
  arrowdown: 125,
  arrowup: 126
}

/**
 * Printable characters that are not a bare `a`–`z` / `0`–`9` key, with whether
 * `shift` must be held. Anything outside this set (and the letter/digit ranges)
 * makes `type` throw rather than silently drop input.
 */
const CHAR_KEYS: Record<string, { code: number; shift?: boolean }> = {
  ' ': { code: KEYCODES.space },
  '\n': { code: KEYCODES.return },
  '\r': { code: KEYCODES.return },
  '\t': { code: KEYCODES.tab },
  '-': { code: 27 },
  _: { code: 27, shift: true },
  '=': { code: 24 },
  '+': { code: 24, shift: true },
  '[': { code: 33 },
  '{': { code: 33, shift: true },
  ']': { code: 30 },
  '}': { code: 30, shift: true },
  '\\': { code: 42 },
  '|': { code: 42, shift: true },
  ';': { code: 41 },
  ':': { code: 41, shift: true },
  "'": { code: 39 },
  '"': { code: 39, shift: true },
  ',': { code: 43 },
  '<': { code: 43, shift: true },
  '.': { code: 47 },
  '>': { code: 47, shift: true },
  '/': { code: 44 },
  '?': { code: 44, shift: true },
  '`': { code: 50 },
  '~': { code: 50, shift: true },
  '!': { code: KEYCODES['1'], shift: true },
  '@': { code: KEYCODES['2'], shift: true },
  '#': { code: KEYCODES['3'], shift: true },
  $: { code: KEYCODES['4'], shift: true },
  '%': { code: KEYCODES['5'], shift: true },
  '^': { code: KEYCODES['6'], shift: true },
  '&': { code: KEYCODES['7'], shift: true },
  '*': { code: KEYCODES['8'], shift: true },
  '(': { code: KEYCODES['9'], shift: true },
  ')': { code: KEYCODES['0'], shift: true }
}

/** Resolve a key name (`"cmd"`, `"Enter"`, `"a"`) to a macOS keycode. */
function keycode(name: string): number {
  const code = KEYCODES[name.trim().toLowerCase()]
  if (code === undefined) {
    throw new Error(`hands: unknown key name ${JSON.stringify(name)}`)
  }
  return code
}

/** Resolve a single character to a keycode + whether shift must be held. */
function charKeycode(ch: string): { code: number; shift: boolean } {
  if (ch >= 'a' && ch <= 'z') return { code: KEYCODES[ch], shift: false }
  if (ch >= 'A' && ch <= 'Z') {
    return { code: KEYCODES[ch.toLowerCase()], shift: true }
  }
  if (ch >= '0' && ch <= '9') return { code: KEYCODES[ch], shift: false }
  const entry = CHAR_KEYS[ch]
  if (entry) return { code: entry.code, shift: entry.shift ?? false }
  throw new Error(`hands: no keycode for character ${JSON.stringify(ch)}`)
}

/** Tap one key: down then up, wrapped in shift when the char needs it. */
function tapChar(ch: string): HelperCommand[] {
  const { code, shift } = charKeycode(ch)
  const cmds: HelperCommand[] = []
  if (shift) cmds.push({ op: 'key', code: KEYCODES.shift, down: true })
  cmds.push({ op: 'key', code, down: true }, { op: 'key', code, down: false })
  if (shift) cmds.push({ op: 'key', code: KEYCODES.shift, down: false })
  return cmds
}

/**
 * `"cmd+shift+c"` → hold each modifier in listed order, tap the final key, then
 * release the modifiers in reverse order.
 */
function decomposeHotkey(combo: string): HelperCommand[] {
  const tokens = combo
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) {
    throw new Error(`hands: empty hotkey combo ${JSON.stringify(combo)}`)
  }
  const key = tokens[tokens.length - 1]
  const modifiers = tokens.slice(0, -1)
  return [
    ...modifiers.map((m): HelperCommand => ({
      op: 'key',
      code: keycode(m),
      down: true
    })),
    { op: 'key', code: keycode(key), down: true },
    { op: 'key', code: keycode(key), down: false },
    ...[...modifiers]
      .reverse()
      .map((m): HelperCommand => ({ op: 'key', code: keycode(m), down: false }))
  ]
}

/**
 * Map a point in *screenshot-pixel space* to a *screen point*:
 * `origin + round(coord / scaleFactor)`, where `scaleFactor` is screenshot
 * pixels per window point (from `capture`). On a Retina display with a small
 * window `scaleFactor > 1` (the divide shrinks); for a downscaled large window
 * `scaleFactor < 1` (the divide grows). `origin` is the window's top-left in
 * screen points.
 */
function toScreen(
  [x, y]: [number, number],
  scaleFactor: number,
  origin: [number, number]
): { x: number; y: number } {
  return {
    x: origin[0] + Math.round(x / scaleFactor),
    y: origin[1] + Math.round(y / scaleFactor)
  }
}

/**
 * Decompose one `Action` into the primitive `HelperCommand[]` `actovia-input`
 * executes. Pure. `scaleFactor` is screenshot pixels per window point (see
 * `capture.screenshotWindow`); `origin` is the target window's `[x, y]`
 * top-left in screen points (`target.bounds` sliced to two).
 *
 * `moveMouse` collapses to its single terminal `move` here — any eased
 * multi-point path is an `execute`-time concern. `wait` / `askHuman` / `done`
 * are not decomposable and throw.
 */
export function decompose(
  action: Action,
  scaleFactor: number,
  origin: [number, number]
): HelperCommand[] {
  switch (action.kind) {
    case 'moveMouse': {
      const { x, y } = toScreen(action.to, scaleFactor, origin)
      return [{ op: 'move', x, y }]
    }
    case 'mouseDown':
      return [{ op: 'down', button: action.button }]
    case 'mouseUp':
      return [{ op: 'up', button: action.button }]
    case 'wheel':
      return [{ op: 'wheel', dx: action.dx, dy: action.dy }]
    case 'keyDown':
      return [{ op: 'key', code: keycode(action.key), down: true }]
    case 'keyUp':
      return [{ op: 'key', code: keycode(action.key), down: false }]
    case 'click': {
      const { x, y } = toScreen(action.to, scaleFactor, origin)
      const button = action.button ?? 'left'
      const count = Math.max(1, action.count ?? 1)
      const cmds: HelperCommand[] = [{ op: 'move', x, y }]
      for (let i = 0; i < count; i++) {
        cmds.push({ op: 'down', button }, { op: 'up', button })
      }
      return cmds
    }
    case 'type':
      return [...action.text].flatMap(tapChar)
    case 'drag': {
      const from = toScreen(action.from, scaleFactor, origin)
      const to = toScreen(action.to, scaleFactor, origin)
      return [
        { op: 'move', x: from.x, y: from.y },
        { op: 'down', button: 'left' },
        { op: 'move', x: to.x, y: to.y },
        { op: 'up', button: 'left' }
      ]
    }
    case 'hotkey':
      return decomposeHotkey(action.combo)
    case 'wait':
    case 'askHuman':
    case 'done':
      throw new Error(`hands: cannot decompose ${JSON.stringify(action.kind)}`)
  }
}

export interface ExecuteContext {
  target: TargetWindow
  /** Screenshot pixels per window point (see `capture.screenshotWindow`). */
  scaleFactor: number
  helper: InputHelper
}

/**
 * Run one `Action`. `wait` sleeps (no helper call); `askHuman` / `done` are the
 * session's to handle and throw here; everything else decomposes and goes to the
 * helper in a single `send`, clamped to the target window's bounds.
 */
export async function execute(
  action: Action,
  ctx: ExecuteContext
): Promise<void> {
  switch (action.kind) {
    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, action.ms))
      return
    case 'askHuman':
    case 'done':
      throw new Error('not an executable action')
    default: {
      const { bounds } = ctx.target
      const commands = decompose(action, ctx.scaleFactor, [
        bounds[0],
        bounds[1]
      ])
      await ctx.helper.send(commands, bounds)
    }
  }
}
