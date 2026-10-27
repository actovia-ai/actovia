import { readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { resolveToolPath } from './tool-path'

const editFileSchema = Type.Object({
  path: Type.String({
    description:
      'Path of the file to edit: absolute, `~/…`, or relative to the chat workspace.'
  }),
  old_string: Type.String({
    description:
      'The exact string to find and replace. Must be unique in the file.'
  }),
  new_string: Type.String({
    description:
      'The string to replace old_string with. Can be empty to delete.'
  }),
  replace_all: Type.Optional(
    Type.Boolean({
      description:
        'If true, replace all occurrences. Default: false (replace first only).'
    })
  )
})

export const editFile = (
  baseDir: string = homedir()
): AgentTool<typeof editFileSchema> => ({
  name: TOOL_NAMES.editFile,
  label: 'Edit File',
  description:
    'Edit a file by replacing a specific string with a new string. ' +
    'Prefer this over write_file for targeted edits — it only changes what you specify. ' +
    'The old_string must match exactly (including whitespace and indentation). ' +
    'To insert text, provide old_string as the surrounding context and include it in new_string. ' +
    'To delete text, set new_string to empty string.',
  parameters: editFileSchema,
  execute: async (
    _toolCallId,
    { path: rawPath, old_string, new_string, replace_all },
    signal
  ) => {
    if (signal?.aborted) throw new Error('Aborted')
    const path = resolveToolPath(rawPath, baseDir)
    let fileContent: string
    try {
      fileContent = await readFile(path, { encoding: 'utf-8', signal })
    } catch (e) {
      throw new Error(
        `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      )
    }

    if (!fileContent.includes(old_string)) {
      throw new Error(
        `old_string not found in file. Make sure it matches exactly including whitespace.`
      )
    }

    const occurrences = fileContent.split(old_string).length - 1
    if (!replace_all && occurrences > 1) {
      throw new Error(
        `old_string appears ${occurrences} times in the file. Provide more surrounding context to make it unique, or set replace_all=true.`
      )
    }

    const newContent = replace_all
      ? fileContent.split(old_string).join(new_string)
      : fileContent.replace(old_string, new_string)

    try {
      await writeFile(path, newContent, { encoding: 'utf-8', signal })
    } catch (e) {
      throw new Error(
        `Failed to write file: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      )
    }

    const linesBefore = fileContent.split('\n').length
    const linesAfter = newContent.split('\n').length

    const details = {
      path,
      replacements: occurrences,
      linesBefore,
      linesAfter
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(details) }],
      details
    }
  }
})
