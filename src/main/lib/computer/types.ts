// Computer Runtime — shared types.
//
// The block below is spec §2.1 ("The Runtime → Types") copied verbatim, with
// `export` added so the rest of the module can import it. `HelperCommand` and
// `InputHelper` (the `actovia-input` client contract) follow at the bottom.

import type { InstalledApp } from '@actovia/shared/types/computer-use'

export type { InstalledApp }

export type MouseButton = 'left' | 'right' | 'middle'

export type Action =
  // primitives
  | { kind: 'moveMouse'; to: [number, number]; durationMs?: number }
  | { kind: 'mouseDown'; button: MouseButton }
  | { kind: 'mouseUp'; button: MouseButton }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'keyDown'; key: string }
  | { kind: 'keyUp'; key: string }
  // atoms (decompose to primitives in hands.ts)
  | {
      kind: 'click'
      to: [number, number]
      button?: MouseButton
      count?: number
    }
  | { kind: 'type'; text: string }
  | { kind: 'drag'; from: [number, number]; to: [number, number] }
  | { kind: 'hotkey'; combo: string } // "cmd+c", "shift+tab"
  // control
  | { kind: 'wait'; ms: number }
  | { kind: 'askHuman'; question: string }
  | { kind: 'done'; success: boolean; summary: string }

export interface TargetWindow {
  cgWindowId: number
  app: string
  bundleId: string
  title: string
  bounds: [number, number, number, number] // x, y, w, h in screen coords
}

export interface ComputerState {
  step: number
  target: Pick<TargetWindow, 'app' | 'title'>
  viewport: { width: number; height: number } // window size
  cursor: [number, number] // screenshot-space (matches what the model sees and emits)
  screenshot: {
    data: string
    mimeType: 'image/png'
    width: number
    height: number
  }
  /**
   * The human's answer to the previous step's `askHuman` (model-emitted or the
   * synthetic "stuck" prompt). Set on the one state that immediately follows an
   * answered pause; the agent renders it into that turn's tool result instead
   * of the usual `step N · cursor` line.
   */
  humanNote?: string
  /**
   * A runtime notice for the model — its last action was rejected/skipped (an
   * out-of-bounds coordinate, or a forbidden key chord). Set on the one state
   * that follows the skipped step; rendered as an `isError` tool result so the
   * model sees it went wrong instead of silently repeating it.
   */
  systemNote?: string
}

export type SessionOutcome =
  | 'success'
  | 'failed'
  | 'aborted'
  | 'abandoned'
  | 'stuck'

export interface SessionResult {
  outcome: SessionOutcome
  summary: string
  steps: number
  finalScreenshot?: ComputerState['screenshot']
}

// --- actovia-input client contract -----------------------------------------

/**
 * The primitive-level JSON `actovia-input input` reads from stdin, one object
 * per line. `hands.ts` produces these; `helper.ts` serialises + sends them.
 */
export type HelperCommand =
  | { op: 'move'; x: number; y: number }
  | { op: 'down' | 'up'; button: MouseButton }
  | { op: 'wheel'; dx: number; dy: number }
  | { op: 'key'; code: number; down: boolean }

export interface InputHelper {
  listWindows(): Promise<TargetWindow[]>
  /** PNG bytes of the window crop. */
  screenshot(cgWindowId: number): Promise<Buffer>
  /**
   * Execute a batch of primitive commands. `clamp` (x, y, w, h screen rect) is
   * passed through as `--clamp` so the helper keeps mouse points in-window.
   */
  send(
    commands: HelperCommand[],
    clamp?: [number, number, number, number]
  ): Promise<void>
  /**
   * Launch `query` (an app name or bundle id) if it isn't running, or raise it
   * to the front if it is. Resolves to the running app's identity.
   */
  activate(query: string): Promise<{ bundleId: string; pid: number }>
  /** Every installed application, for the Settings allowlist picker. */
  listApps(): Promise<InstalledApp[]>
}
