import { stat as fsStat, readdir } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { getWorkspacesDir } from '../../paths'
import { resolveToolPath } from './tool-path'

const listDirectorySchema = Type.Object({
  path: Type.String({
    description:
      'Directory to list: absolute, `~/…`, or relative to the chat workspace.'
  }),
  recursive: Type.Optional(
    Type.Boolean({
      description: 'If true, list recursively up to 3 levels deep.'
    })
  )
})

/**
 * A chat's workspace is made on its first write, so before that it does not
 * exist: listing it is an empty folder, not an error the model has to work
 * around (it reads as a failed step in the timeline).
 */
function isUnmadeWorkspace(path: string, err: unknown): boolean {
  if ((err as { code?: string }).code !== 'ENOENT') return false
  const rel = relative(getWorkspacesDir(), resolve(path))
  return (
    rel !== '' &&
    !isAbsolute(rel) &&
    !rel.startsWith('..') &&
    !rel.includes(sep)
  )
}

export const listDirectory = (
  baseDir: string = homedir()
): AgentTool<typeof listDirectorySchema> => ({
  name: TOOL_NAMES.listDirectory,
  label: 'List Directory',
  description: 'List files and directories at a given path.',
  parameters: listDirectorySchema,
  execute: async (_toolCallId, { path: rawPath, recursive }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const path = resolveToolPath(rawPath, baseDir)
    async function listDir(
      dir: string,
      depth: number
    ): Promise<
      {
        name: string
        type: 'file' | 'directory'
        size?: number
        children?: unknown[]
      }[]
    > {
      if (signal?.aborted) return []
      const names = await readdir(dir)
      const result = await Promise.all(
        names.map(async (name) => {
          const fullPath = join(dir, name)
          const info = await fsStat(fullPath).catch(() => null)
          if (info?.isDirectory()) {
            const children =
              recursive && depth < 3
                ? await listDir(fullPath, depth + 1)
                : undefined
            return { name, type: 'directory' as const, children }
          } else {
            return { name, type: 'file' as const, size: info?.size }
          }
        })
      )
      return result
    }

    try {
      const entries = await listDir(path, 1)
      const details = { path, entries }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    } catch (err: unknown) {
      if (isUnmadeWorkspace(path, err)) {
        const details = { path, entries: [] }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(details) }],
          details
        }
      }
      const e = err as { message?: string }
      throw new Error(`Failed to list directory "${path}": ${e.message}`, {
        cause: err
      })
    }
  }
})
