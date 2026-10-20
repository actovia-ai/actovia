import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { MemoryChange } from '@actovia/shared/types/memory'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'

import { runMemoryInstruction } from '../memory/manager'

const updateMemorySchema = Type.Object({
  instruction: Type.String({
    description:
      "What to change in the user's memory, in plain words — e.g. " +
      '"They use Linux now, not macOS" or "Forget their old address".'
  })
})

function opLabel(op: MemoryChange['op']): string {
  switch (op) {
    case 'create':
      return 'added'
    case 'update':
      return 'updated'
    case 'delete':
      return 'deleted'
  }
}

/** "Updated 'Work setup'; deleted 'Old address'." — or "No memory change
 *  was needed." when nothing changed. Every op label is lowercase and only
 *  the sentence's first character is capitalised, whichever op comes first.
 *  The key comes from `after` (its value post-change) falling back to
 *  `before` for a delete. */
function summarize(changes: MemoryChange[]): string {
  if (changes.length === 0) return 'No memory change was needed.'
  const text = changes
    .map((change) => {
      const key = (change.after ?? change.before)?.key ?? ''
      return `${opLabel(change.op)} '${key}'`
    })
    .join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/**
 * Lets the model correct, add or remove what it knows about the user
 * mid-conversation, reusing the same instruction engine as Settings →
 * Memory's instruction box. Bound only for a chat with a model and API key,
 * except in Deep Research or when switched off in Built-in Tools
 * (`tool-binding-util.ts`) — Philharmonic keeps its own agent memory.
 */
export function updateMemory(
  model: Model<string>,
  apiKey: string
): AgentTool<typeof updateMemorySchema> {
  return {
    name: TOOL_NAMES.updateMemory,
    label: 'Update Memory',
    description:
      "Change the user's long-term memory: correct, add or remove what you know about them. " +
      'Call it when the user corrects something you know about them, asks you to remember or forget something, ' +
      'or states a lasting fact about themselves — or a change to one you already hold (a new holding, a switch of tools, a project done). ' +
      'Not for one-off details, passing mentions or the specifics of the task at hand.',
    parameters: updateMemorySchema,
    execute: async (_toolCallId, { instruction }, signal) => {
      if (signal?.aborted) throw new Error('Aborted')
      const { changes } = await runMemoryInstruction(
        instruction,
        null,
        model,
        apiKey
      )
      return {
        content: [{ type: 'text' as const, text: summarize(changes) }],
        details: { changes }
      }
    }
  }
}
