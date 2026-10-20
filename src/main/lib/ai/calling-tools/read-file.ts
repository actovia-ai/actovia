import { readFile as fsReadFile } from 'fs/promises'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

const readFileSchema = Type.Object({
  path: Type.String({
    description: 'Absolute or relative path to the file to read.'
  }),
  encoding: Type.Optional(
    // StringEnum: a Union of Literals emits `anyOf`/`const`, which Google's
    // function-calling schema rejects.
    StringEnum(['utf-8', 'base64'] as const, {
      description: 'File encoding. Use base64 for binary files.'
    })
  )
})

export const readFile: AgentTool<typeof readFileSchema> = {
  name: TOOL_NAMES.readFile,
  label: 'Read File',
  description: 'Read the contents of a file at the given path.',
  parameters: readFileSchema,
  execute: async (_toolCallId, { path, encoding }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    try {
      const enc = (encoding ?? 'utf-8') as BufferEncoding
      const content = await fsReadFile(path, { encoding: enc, signal })
      const details = {
        path,
        content: content.toString(),
        size: Buffer.byteLength(content)
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      throw new Error(`Failed to read file "${path}": ${e.message}`, {
        cause: err
      })
    }
  }
}
