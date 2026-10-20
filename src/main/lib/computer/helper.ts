import { spawn } from 'child_process'
import { join } from 'path'

import { getResourcePath } from '../paths'
import type {
  HelperCommand,
  InputHelper,
  InstalledApp,
  TargetWindow
} from './types'

const BINARY_NAME = 'actovia-input'

/**
 * Where the prebuilt Swift binary lives — `getResourcePath()` resolves both:
 * - dev: `<repo-root>/resources/bin/actovia-input` (committed)
 * - packaged: `Contents/Resources/resources/bin/actovia-input`
 *   (`packagerConfig.extraResource: ['./resources']` in forge.config.ts)
 */
function resolveBinaryPath(): string {
  return getResourcePath(join('bin', BINARY_NAME))
}

/**
 * Newline-delimited JSON, one command per line, exactly as `actovia-input input`
 * reads it from stdin. Pure — unit-tested directly.
 */
export function serialize(commands: HelperCommand[]): string {
  return commands.map((c) => `${JSON.stringify(c)}\n`).join('')
}

interface RunOptions {
  /** Written to the child's stdin, which is then closed. */
  stdin?: string
}

/** Spawn `actovia-input <args>`, resolve stdout on exit 0, reject otherwise. */
function run(args: string[], options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinaryPath(), args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    // A short-lived helper that exits before we finish writing stdin makes the
    // pipe emit EPIPE; the `close`/`error` handlers already carry the outcome.
    child.stdin.on('error', () => {})
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout))
        return
      }
      const message = Buffer.concat(stderr).toString('utf8').trim()
      reject(
        new Error(
          `actovia-input ${args.join(' ')} exited with code ${code}${
            message ? `: ${message}` : ''
          }`
        )
      )
    })

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin)
    } else {
      child.stdin.end()
    }
  })
}

interface RawWindow {
  id: number
  app: string
  bundleId: string
  title: string
  bounds: [number, number, number, number]
}

/** Talks to the real `actovia-input` binary. macOS only. */
export const realHelper: InputHelper = {
  async listWindows() {
    const out = await run(['list-windows'])
    const raw = JSON.parse(out.toString('utf8')) as RawWindow[]
    return raw.map((w) => ({
      cgWindowId: w.id,
      app: w.app,
      bundleId: w.bundleId,
      title: w.title,
      bounds: w.bounds
    }))
  },

  async screenshot(cgWindowId) {
    return run(['screenshot', '--window', String(cgWindowId)])
  },

  async send(commands, clamp) {
    const args = ['input']
    if (clamp) args.push('--clamp', clamp.join(','))
    await run(args, { stdin: serialize(commands) })
  },

  async activate(query) {
    const out = await run(['activate', '--app', query])
    return JSON.parse(out.toString('utf8')) as { bundleId: string; pid: number }
  },

  async listApps() {
    const out = await run(['list-apps'])
    return JSON.parse(out.toString('utf8')) as InstalledApp[]
  }
}

/**
 * In-memory `InputHelper` for tests: records every `send()` call, returns canned
 * `listWindows()` / `screenshot()` values. Selected by `getHelper()` when
 * `ACTOVIA_INPUT_MOCK` is set.
 */
export interface MockHelper extends InputHelper {
  /** One entry per `send()` call, in order. */
  sent: HelperCommand[][]
  /** The `clamp` arg of each `send()` call, index-aligned with `sent`. */
  sentClamps: Array<[number, number, number, number] | undefined>
  /** One entry per `activate()` call, in order. */
  activated: string[]
  __setWindows(windows: TargetWindow[]): void
  __setScreenshot(buffer: Buffer): void
  __setApps(apps: InstalledApp[]): void
  /** Runs inside the next `activate()` call — e.g. to make a window appear. */
  __onActivate(fn: () => void): void
  /** Clear recorded calls and canned values. */
  __reset(): void
}

let cannedWindows: TargetWindow[] = []
let cannedScreenshot: Buffer = Buffer.alloc(0)
let cannedApps: InstalledApp[] = []
let onActivate: (() => void) | undefined

export const mockHelper: MockHelper = {
  sent: [],
  sentClamps: [],
  activated: [],

  async listWindows() {
    return cannedWindows
  },

  async screenshot() {
    return cannedScreenshot
  },

  async send(commands, clamp) {
    mockHelper.sent.push([...commands])
    mockHelper.sentClamps.push(clamp)
  },

  async activate(query) {
    mockHelper.activated.push(query)
    onActivate?.()
    return { bundleId: query, pid: 1 }
  },

  async listApps() {
    return cannedApps
  },

  __setWindows(windows) {
    cannedWindows = windows
  },

  __setScreenshot(buffer) {
    cannedScreenshot = buffer
  },

  __setApps(apps) {
    cannedApps = apps
  },

  __onActivate(fn) {
    onActivate = fn
  },

  __reset() {
    mockHelper.sent = []
    mockHelper.sentClamps = []
    mockHelper.activated = []
    cannedWindows = []
    cannedScreenshot = Buffer.alloc(0)
    cannedApps = []
    onActivate = undefined
  }
}

/**
 * The `InputHelper` the Runtime should use: `mockHelper` when
 * `ACTOVIA_INPUT_MOCK` is set to any truthy value, else the real binary client.
 */
export function getHelper(): InputHelper {
  return process.env.ACTOVIA_INPUT_MOCK ? mockHelper : realHelper
}
