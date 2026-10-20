import { writeFile as fsWriteFile, mkdir, stat } from 'fs/promises'
import { dirname } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

const writeFileSchema = Type.Object({
  path: Type.String({
    description: 'Absolute or relative path to write the file to.'
  }),
  content: Type.String({ description: 'Content to write into the file.' }),
  append: Type.Optional(
    Type.Boolean({
      description: 'If true, append to the file instead of overwriting.'
    })
  )
})

export const writeFile: AgentTool<typeof writeFileSchema> = {
  name: TOOL_NAMES.writeFile,
  label: 'Write File',
  description:
    'Write content to a file at the given path. Creates parent directories if they do not exist. Overwrites existing files.',
  parameters: writeFileSchema,
  execute: async (_toolCallId, { path, content, append }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    try {
      // Whether the file is new, for the card's "Created" / "Edited".
      const existed = await stat(path).then(
        () => true,
        () => false
      )
      await mkdir(dirname(path), { recursive: true })
      if (append) {
        // fs/promises.appendFile's options type doesn't include `signal`
        // (unlike read_file/write_file), so append mode can't be cancelled.
        const { appendFile } = await import('fs/promises')
        await appendFile(path, content, 'utf-8')
      } else {
        await fsWriteFile(path, content, { encoding: 'utf-8', signal })
      }
      const details = {
        path,
        bytes: Buffer.byteLength(content),
        appended: append ?? false,
        created: !existed
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      throw new Error(`Failed to write file "${path}": ${e.message}`, {
        cause: err
      })
    }
  }
}
