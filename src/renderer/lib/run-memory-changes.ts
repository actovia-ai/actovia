import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolResultMessage
} from '@actovia/shared/types/chat'
import type { MemoryChange } from '@actovia/shared/types/memory'

export interface RunMemoryChanges {
  /** An `update_memory` call is out with no result yet. */
  running: boolean
  /** An `update_memory` call came back as an error. */
  failed: boolean
  /** Every `update_memory` result's `details.changes`, in call order. */
  changes: MemoryChange[]
}

const NONE: RunMemoryChanges = { running: false, failed: false, changes: [] }

function changesOf(result: ChatToolResultMessage): MemoryChange[] {
  const changes = (result.details as { changes?: unknown } | undefined)?.changes
  return Array.isArray(changes) ? (changes as MemoryChange[]) : []
}

/**
 * What one run did to memory, read from its messages: the memory-change
 * strip at the run's foot is drawn from this alone. A call inside a message
 * that was aborted or errored never ran, so it does not count as running.
 */
export function runMemoryChanges(messages: ChatMessage[]): RunMemoryChanges {
  const pending = new Set<string>()
  const changes: MemoryChange[] = []
  let failed = false
  let touched = false

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const assistant = msg as ChatAssistantMessage
      if (
        assistant.stopReason === 'aborted' ||
        assistant.stopReason === 'error'
      ) {
        continue
      }
      for (const block of assistant.content) {
        if (
          block.type === 'toolCall' &&
          block.name === TOOL_NAMES.updateMemory
        ) {
          pending.add(block.id)
          touched = true
        }
      }
    } else if (
      msg.role === 'toolResult' &&
      msg.toolName === TOOL_NAMES.updateMemory
    ) {
      touched = true
      pending.delete(msg.toolCallId)
      if (msg.isError) failed = true
      else changes.push(...changesOf(msg))
    }
  }

  if (!touched) return NONE
  return { running: pending.size > 0, failed, changes }
}
