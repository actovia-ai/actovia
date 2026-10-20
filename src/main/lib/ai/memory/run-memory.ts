import type { UsedMemory } from '@actovia/shared/types/memory'
import type { Message } from '@earendil-works/pi-ai'

import type { MemoryRow } from '../../db/memory-queries'

/**
 * The memory a message was answered with, carried by that message's run.
 *
 * It used to close the system prompt, chosen afresh for every message by the
 * read filter — so the system prompt changed on every message, and the
 * provider's prompt cache (a prefix: tools, system, messages) was re-written
 * at 1.25× instead of read at 0.1×, history and all (2026-10-01). Now each
 * run's user message is preceded by the block chosen for it, rendered from
 * `memory_usage_log` with the entries as they read now: the same bytes on
 * every request while nothing changes; an edit changes the runs that used
 * the entry, once; a deleted or switched-off entry drops out of every run.
 */

const SECTION_ORDER: Record<string, number> = {
  profile: 0,
  topic: 1,
  person: 2
}

function compare(a: MemoryRow, b: MemoryRow): number {
  const bySection =
    (SECTION_ORDER[a.section] ?? 9) - (SECTION_ORDER[b.section] ?? 9)
  if (bySection !== 0) return bySection
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** One run's block: section, then key — the same bytes for the same entries. */
export function formatRunMemory(memories: MemoryRow[]): string {
  if (memories.length === 0) return ''
  const blocks = memories.toSorted(compare).map((m) => {
    const bullets = (m.details ?? []).map((d) => `- ${d}`).join('\n')
    return `## ${m.key} (${m.section})\n${m.summary}${bullets ? `\n${bullets}` : ''}`
  })
  return `<user_memory>\nThe user's saved memory, as chosen for this message:\n\n${blocks.join('\n\n')}\n</user_memory>`
}

/**
 * Every run's block, from what the read filter chose for it (`usage`, by run)
 * and the entries as they are now (`current`, active ones). A run whose
 * entries are all gone has none.
 */
export function runMemoryBlocks(
  usage: Record<string, UsedMemory[]>,
  current: MemoryRow[]
): Map<string, string> {
  const live = new Map(
    current.filter((m) => m.isActive !== false).map((m) => [m.id, m])
  )
  const blocks = new Map<string, string>()
  for (const [runId, used] of Object.entries(usage)) {
    const entries = used.flatMap((u) => {
      const entry = live.get(u.id)
      return entry ? [entry] : []
    })
    const block = formatRunMemory(entries)
    if (block) blocks.set(runId, block)
  }
  return blocks
}

type AnyMessage = Pick<Message, 'role'> & { content: unknown }

/** The run's user message with its block before the question; a copy. */
export function withRunMemory<M extends AnyMessage>(
  message: M,
  block: string
): M {
  if (!block || message.role !== 'user') return message
  const parts =
    typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : (message.content as unknown[])
  return {
    ...message,
    content: [{ type: 'text' as const, text: block }, ...parts]
  }
}
