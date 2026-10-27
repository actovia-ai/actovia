import { lstat, readFile, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { GREP_SKIP_DIRS } from './grep-skip-dirs'
import { resolveToolPath } from './tool-path'

const MAX_RESULTS = 100
interface GrepMatch {
  lineNumber: number
  line: string
  context: { before: string[]; after: string[] }
}

interface GrepResult {
  file: string
  matches: GrepMatch[]
}

async function grepDir(
  dir: string,
  regex: RegExp,
  fileGlob: string | undefined,
  contextLines: number,
  results: GrepResult[],
  depth: number,
  signal: AbortSignal | undefined
): Promise<void> {
  if (depth > 8 || results.length >= MAX_RESULTS || signal?.aborted) return

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS || signal?.aborted) break
    const fullPath = path.join(dir, entry)

    // lstat: a symlink is neither a directory nor a file here, so it is
    // never followed — a link inside the tree cannot pull in a file from
    // outside it (a key the approval gate would have asked about).
    let entryStat
    try {
      entryStat = await lstat(fullPath)
    } catch {
      continue
    }

    if (entryStat.isDirectory()) {
      if (!GREP_SKIP_DIRS.has(entry)) {
        await grepDir(
          fullPath,
          regex,
          fileGlob,
          contextLines,
          results,
          depth + 1,
          signal
        )
      }
    } else if (entryStat.isFile()) {
      if (fileGlob && !matchGlob(entry, fileGlob)) continue
      await grepFile(fullPath, regex, contextLines, results, signal)
    }
  }
}

function matchGlob(filename: string, glob: string): boolean {
  // Simple glob: *.ts, *.{ts,tsx}, etc.
  if (glob.startsWith('*.')) {
    const exts = glob.slice(2)
    if (exts.startsWith('{') && exts.endsWith('}')) {
      const extList = exts.slice(1, -1).split(',')
      return extList.some((ext) => filename.endsWith('.' + ext.trim()))
    }
    return filename.endsWith('.' + exts)
  }
  return filename.includes(glob.replaceAll('*', ''))
}

async function grepFile(
  filePath: string,
  regex: RegExp,
  contextLines: number,
  results: GrepResult[],
  signal: AbortSignal | undefined
): Promise<void> {
  let content: string
  try {
    content = await readFile(filePath, { encoding: 'utf-8', signal })
  } catch {
    return // binary or unreadable file
  }

  const lines = content.split('\n')
  const matches: GrepMatch[] = []

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      regex.lastIndex = 0 // reset for global flag
      const before = lines.slice(Math.max(0, i - contextLines), i)
      const after = lines.slice(
        i + 1,
        Math.min(lines.length, i + 1 + contextLines)
      )
      matches.push({
        lineNumber: i + 1,
        line: lines[i],
        context: { before, after }
      })
    }
    regex.lastIndex = 0
  }

  if (matches.length > 0) {
    results.push({ file: filePath, matches })
  }
}

const grepSchema = Type.Object({
  pattern: Type.String({
    description: 'Regular expression pattern to search for.'
  }),
  path: Type.String({
    description:
      'File or directory to search in: absolute, `~/…`, or relative to the chat workspace.'
  }),
  file_glob: Type.Optional(
    Type.String({
      description:
        'Filter by filename pattern, e.g. "*.ts", "*.{ts,tsx}", "*.py". Only applies when searching a directory.'
    })
  ),
  context_lines: Type.Optional(
    Type.Number({
      description:
        'Number of lines to show before and after each match. Default: 2.'
    })
  ),
  case_insensitive: Type.Optional(
    Type.Boolean({ description: 'Case-insensitive search. Default: false.' })
  )
})

export const grep = (
  baseDir: string = homedir()
): AgentTool<typeof grepSchema> => ({
  name: TOOL_NAMES.grep,
  label: 'Grep',
  description:
    'Search for a regex pattern in files. Returns matching lines with optional context. ' +
    'Use this to find where a function is defined, where a variable is used, or locate specific code. ' +
    'Faster than reading entire files when searching for specific content.',
  parameters: grepSchema,
  execute: async (
    _toolCallId,
    { pattern, path: rawPath, file_glob, context_lines, case_insensitive },
    signal
  ) => {
    if (signal?.aborted) throw new Error('Aborted')
    const searchPath = resolveToolPath(rawPath, baseDir)
    let regex: RegExp
    try {
      regex = new RegExp(pattern, case_insensitive ? 'ig' : 'g')
    } catch (e) {
      throw new Error(
        `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      )
    }

    const results: GrepResult[] = []

    let pathStat
    try {
      pathStat = await stat(searchPath)
    } catch {
      throw new Error(`Path not found: ${searchPath}`)
    }

    if (pathStat.isFile()) {
      await grepFile(searchPath, regex, context_lines ?? 2, results, signal)
    } else if (pathStat.isDirectory()) {
      await grepDir(
        searchPath,
        regex,
        file_glob,
        context_lines ?? 2,
        results,
        0,
        signal
      )
    }

    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

    const details = {
      pattern,
      path: searchPath,
      totalFiles: results.length,
      totalMatches,
      truncated: totalMatches >= MAX_RESULTS,
      results
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(details) }],
      details
    }
  }
})
