import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, relative } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

function matchGlob(name: string, pattern: string): boolean {
  // Simple glob: * matches anything, ? matches single char
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i'
  )
  return regex.test(name)
}

const findFilesSchema = Type.Object({
  pattern: Type.String({
    description:
      'Filename glob pattern to match (e.g. "*.ts", "config.*", "README*").'
  }),
  searchPath: Type.Optional(
    Type.String({
      description:
        'Root directory to search from. Defaults to the workspace directory named in the system prompt.'
    })
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of results to return.'
    })
  )
})

/** @param defaultRoot where a search starts when the model names no `searchPath`. */
export const findFiles = (
  defaultRoot: string = homedir()
): AgentTool<typeof findFilesSchema> => ({
  name: TOOL_NAMES.findFiles,
  label: 'Find Files',
  description:
    'Find files matching a name pattern within a directory. Searches recursively up to 5 levels deep.',
  parameters: findFilesSchema,
  execute: async (_toolCallId, { pattern, searchPath, maxResults }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const root = searchPath ?? defaultRoot
    const limit = maxResults ?? 50
    const results: string[] = []

    async function walk(dir: string, depth: number): Promise<void> {
      if (results.length >= limit || depth > 5 || signal?.aborted) return
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        return
      }
      for (const name of entries) {
        if (results.length >= limit) break
        if (name.startsWith('.') && depth > 1) continue
        const fullPath = join(dir, name)
        let isDir = false
        try {
          isDir = (await stat(fullPath)).isDirectory()
        } catch {
          continue
        }
        if (isDir) {
          if (['node_modules', '.git', 'dist', 'out', '.cache'].includes(name))
            continue
          await walk(fullPath, depth + 1)
        } else {
          if (matchGlob(name, pattern)) {
            const info = await stat(fullPath).catch(() => null)
            results.push(
              relative(root, fullPath) + (info ? ` (${info.size}b)` : '')
            )
          }
        }
      }
    }

    await walk(root, 1)
    const details = {
      pattern,
      searchPath: root,
      results,
      total: results.length
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(details) }],
      details
    }
  }
})
