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
 * A bundler can write a hidden source map beside every file it emits (Vite's
 * `build.sourcemap: 'hidden'`: a `.map`, and no `sourceMappingURL` comment,
 * so neither Node nor Chromium loads one by itself). A frame such as
 *
 *     at e (/…/app.asar/.vite/build/chat-Cw3ZonVn.js:1:91)
 *
 * becomes
 *
 *     at e (src/main/lib/usage.ts:7:27)
 *
 * — the function name is the built one (the maps carry no names), the
 * location is the original `source:line:column`, relative to the parent of
 * the build root. A frame that cannot be mapped (Node's own, a dev-server
 * URL, a file with no map) stays exactly as it was, and nothing here ever
 * throws.
 *
 * Nothing is read until a stack is mapped. A map is parsed once and held
 * while stacks keep coming, then dropped after `idleMs` without one — a
 * decoded map of a large chunk is tens of megabytes.
 *
 * Only files under `root` are looked at: a client may name the paths in the
 * stacks it reports, and a path in a request is no reason to read a file.
 */

export const SOURCE_MAP_IDLE_MS = 5 * 60_000

/** Files remembered at once, mapped or not, before the cache starts over. */
const MAX_REMEMBERED_FILES = 256

export interface StackMapOptions {
  /** The directory whose built files may be mapped; `null` maps nothing. */
  root?: string | null
}

export interface SourceMapperOptions {
  /**
   * The default root, or a function that answers it on each call (so it can
   * be found lazily, or swapped in tests). `null` maps nothing.
   */
  root: string | null | (() => string | null)
  /** Default `SOURCE_MAP_IDLE_MS`. */
  idleMs?: number
}

export interface SourceMapper {
  /**
   * `stack` with every frame that points into a built file rewritten to its
   * original position. Returns the string it was given — the same one, so
   * `mapped !== stack` tells whether anything changed — when nothing maps.
   */
  mapStackTrace(stack: string, options?: StackMapOptions): string
  /** Drops every held map and the idle timer. */
  reset(): void
}

/**
 * The nearest directory named `name` at or above `from` — where a build
 * writes its files (electron-forge's Vite plugin: `<app>/.vite/build`,
 * `<app>/.vite/renderer/<name>`). `null` when there is none within `depth`.
 */
export function findBuildRoot(
  from: string,
  name = '.vite',
  depth = 4
): string | null {
  let dir = from
  for (let i = 0; i < depth; i++) {
    if (basename(dir) === name) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
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
    // one ("My App (1).app"), a function name does not.
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

export function createSourceMapper({
  root: defaultRoot,
  idleMs = SOURCE_MAP_IDLE_MS
}: SourceMapperOptions): SourceMapper {
  const maps = new Map<string, TraceMap | null>()
  let idle: ReturnType<typeof setTimeout> | null = null

  function touch(): void {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      maps.clear()
      idle = null
    }, idleMs)
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

  return {
    mapStackTrace(stack, options) {
      try {
        if (typeof stack !== 'string' || stack === '') return stack
        const root =
          options?.root !== undefined
            ? options.root
            : typeof defaultRoot === 'function'
              ? defaultRoot()
              : defaultRoot
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
    },
    reset() {
      maps.clear()
      if (idle) clearTimeout(idle)
      idle = null
    }
  }
}
