import { readFileSync } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from 'node:path'
import { fileURLToPath } from 'node:url'

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'

/**
 * Stack frames in a built file, rewritten to the source line they came from.
 *
 * The build emits a hidden source map beside every file it writes
 * (`build.sourcemap: 'hidden'` in the three Vite configs: a `.map`, and no
 * `sourceMappingURL` comment, so neither Node nor Chromium loads one by
 * itself). A frame such as
 *
 *     at e (/…/app.asar/.vite/build/chat-Cw3ZonVn.js:1:91)
 *
 * becomes
 *
 *     at e (src/main/lib/ai/utils/cost.ts:7:27)
 *
 * — the function name is the built one (the maps carry no names), the
 * location is the original `source:line:column`, relative to the app's root.
 * A frame that cannot be mapped (Node's own, a dev-server URL, a file with no
 * map) stays exactly as it was, and nothing here ever throws.
 *
 * Nothing is read until an error is being logged. A map is parsed once and
 * held while errors keep coming, then dropped after `SOURCE_MAP_IDLE_MS`
 * without one — a decoded map of a large chunk is tens of megabytes.
 *
 * Only files under the running build's own `.vite` directory are looked at:
 * the renderer names the paths in the stacks it reports, and a path in a
 * request is no reason to read a file. Inside `app.asar` the read goes
 * through Electron's patched `fs`.
 */

export const SOURCE_MAP_IDLE_MS = 5 * 60_000

/** Files remembered at once, mapped or not, before the cache starts over. */
const MAX_REMEMBERED_FILES = 256

export interface StackMapOptions {
  /**
   * The directory whose built files may be mapped. Defaults to the running
   * build's `.vite`; `null` maps nothing.
   */
  root?: string | null
}

const maps = new Map<string, TraceMap | null>()
let idle: ReturnType<typeof setTimeout> | null = null
let runningRoot: string | null | undefined
let rootOverride: string | null | undefined

/**
 * Every chunk of main is written to `<app>/.vite/build` and the renderer to
 * `<app>/.vite/renderer/<name>`, in a dev run and inside `app.asar` alike.
 */
function runningBuildRoot(): string | null {
  if (runningRoot !== undefined) return runningRoot
  runningRoot = null
  if (typeof __dirname !== 'string') return null
  let dir = __dirname
  for (let depth = 0; depth < 4; depth++) {
    if (basename(dir) === '.vite') {
      runningRoot = dir
      break
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return runningRoot
}

interface Frame {
  /** Everything before the location: `    at fn (`. */
  head: string
  location: string
  line: number
  column: number
  /** `)` or nothing. */
  tail: string
}

const FRAME_START = /^\s*at /u
const POSITION = /^\d{1,9}$/u

function parseFrame(text: string): Frame | null {
  const at = FRAME_START.exec(text)
  if (!at) return null
  const closed = text.endsWith(')')
  const end = closed ? text.length - 1 : text.length
  const columnAt = text.lastIndexOf(':', end - 1)
  if (columnAt <= 0) return null
  const lineAt = text.lastIndexOf(':', columnAt - 1)
  if (lineAt <= 0) return null
  const line = text.slice(lineAt + 1, columnAt)
  const column = text.slice(columnAt + 1, end)
  if (!POSITION.test(line) || !POSITION.test(column)) return null

  let start = at[0].length
  if (closed) {
    // `at name (location)`. The first ` (`, not the last: a path can hold
    // one ("Actovia (1).app"), a function name does not.
    const open = text.indexOf(' (', start - 1)
    if (open < 0 || open >= lineAt) return null
    start = open + 2
  } else if (text.startsWith('async ', start)) {
    start += 'async '.length
  }
  return {
    head: text.slice(0, start),
    location: text.slice(start, lineAt),
    line: Number(line),
    column: Number(column),
    tail: closed ? ')' : ''
  }
}

function toPath(location: string): string | null {
  if (location.startsWith('file://')) {
    try {
      return fileURLToPath(location)
    } catch {
      return null
    }
  }
  return isAbsolute(location) ? location : null
}

function isUnder(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function touch(): void {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => {
    maps.clear()
    idle = null
  }, SOURCE_MAP_IDLE_MS)
  // Never the reason the process stays up.
  idle.unref?.()
}

function loadMap(file: string): TraceMap | null {
  const held = maps.get(file)
  if (held !== undefined) return held
  let map: TraceMap | null = null
  try {
    const raw = JSON.parse(readFileSync(`${file}.map`, 'utf8')) as {
      sourcesContent?: unknown
    }
    // Only positions are looked up; the sources' text is most of a map.
    delete raw.sourcesContent
    map = new TraceMap(raw as ConstructorParameters<typeof TraceMap>[0])
  } catch {
    map = null
  }
  if (maps.size >= MAX_REMEMBERED_FILES) maps.clear()
  maps.set(file, map)
  return map
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/iu

/** A map's `sources` entry, as a path from the app's root where it is one. */
function displaySource(source: string, file: string, root: string): string {
  if (URL_SCHEME.test(source)) return source
  const absolute = resolve(dirname(file), source)
  const fromApp = relative(dirname(root), absolute)
  const shown =
    fromApp !== '' && !fromApp.startsWith('..') && !isAbsolute(fromApp)
      ? fromApp
      : absolute
  return sep === '/' ? shown : shown.split(sep).join('/')
}

function mapFrame(text: string, root: string): string {
  const frame = parseFrame(text)
  if (!frame) return text
  const path = toPath(frame.location)
  if (!path) return text
  const file = resolve(path)
  if (!isUnder(root, file)) return text
  const map = loadMap(file)
  touch()
  if (!map) return text
  // V8 counts columns from 1, a source map from 0.
  const found = originalPositionFor(map, {
    line: frame.line,
    column: frame.column - 1
  })
  if (found.source === null || found.line === null) return text
  const source = displaySource(found.source, file, root)
  return `${frame.head}${source}:${found.line}:${(found.column ?? 0) + 1}${frame.tail}`
}

function rootFor(options: StackMapOptions | undefined): string | null {
  if (options?.root === undefined) {
    return rootOverride === undefined ? runningBuildRoot() : rootOverride
  }
  return options.root
}

/**
 * `stack` with every frame that points into a built file rewritten to its
 * original position. Returns the string it was given — the same one, so
 * `mapped !== stack` tells whether anything changed — when nothing maps.
 */
export function mapStackTrace(
  stack: string,
  options?: StackMapOptions
): string {
  try {
    if (typeof stack !== 'string' || stack === '') return stack
    const root = rootFor(options)
    if (!root) return stack
    let changed = false
    const lines = stack.split('\n').map((text) => {
      let mapped = text
      try {
        mapped = mapFrame(text, root)
      } catch {
        // A map that parsed and still cannot be read: the frame stays.
      }
      if (mapped !== text) changed = true
      return mapped
    })
    return changed ? lines.join('\n') : stack
  } catch {
    return stack
  }
}

/** Tests only: the root `mapStackTrace` uses when a call names none. */
export function setSourceMapRootForTests(root: string | null): void {
  rootOverride = root
}

/** Tests only. */
export function resetSourceMapsForTests(): void {
  maps.clear()
  if (idle) clearTimeout(idle)
  idle = null
  rootOverride = undefined
}
