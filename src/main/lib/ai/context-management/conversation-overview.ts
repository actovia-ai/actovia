import { excludedRuns } from '@actovia/shared/utils/attempts'

import { getChatById } from '../../db/queries'
import {
  getChatMessages,
  getContextItems,
  getSummariesByIds,
  getSummarizedMessageIds
} from './queries'

/**
 * How much of a conversation `lcm_describe` hands over. A tool result stays in
 * the context for the rest of the chat, so the overview is bounded: the
 * newest summaries and the newest messages, each cut to a length; the rest
 * is one `lcm_grep` / `lcm_describe` away.
 */
export const OVERVIEW_LIMITS = {
  summaryChars: 3000,
  summariesChars: 12_000,
  messageChars: 1200,
  messagesChars: 8000
} as const

export interface ConversationOverview {
  conversation: {
    id: string
    title: string
    createdAt: string
    /** The questions and answers a reader of the chat sees. */
    messages: number
  }
  /** What compaction wrote of the older part, oldest first. */
  summaries: Array<{
    id: string
    kind: string
    depth: number
    earliestAt: string
    latestAt: string
    content: string
    truncated?: true
  }>
  /** What was said and not compacted, oldest first: text only. */
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    createdAt: string
    text: string
    truncated?: true
  }>
  /** What did not fit: read a summary by its id, find a message by grep. */
  omitted: { summaryIds: string[]; messages: number }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function cut(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: `${text.slice(0, max)}…`, truncated: true }
    : { text, truncated: false }
}

/**
 * Takes entries newest first while they fit `budget`, and gives them back
 * oldest first with what was left out.
 */
function newestThatFit<T>(
  oldestFirst: T[],
  budget: number,
  sizeOf: (entry: T) => number
): { kept: T[]; left: T[] } {
  let used = 0
  let from = oldestFirst.length
  while (from > 0) {
    const size = sizeOf(oldestFirst[from - 1])
    // The newest entry is always kept: an overview of something says something.
    if (used + size > budget && from < oldestFirst.length) break
    used += size
    from--
  }
  return { kept: oldestFirst.slice(from), left: oldestFirst.slice(0, from) }
}

/**
 * A conversation as someone who was not in it needs it: its summaries (the
 * part compaction replaced) and the text of what was said since — all of it
 * when the conversation never grew long enough to be compacted. Read-only:
 * another chat's context tracking is never bootstrapped from here. Runs a
 * regenerate group keeps out of sight are left out, as they are from the
 * model's own context. `null` when no chat has the id.
 */
export async function describeConversation(
  chatId: string
): Promise<ConversationOverview | null> {
  const chat = await getChatById({ id: chatId })
  if (!chat) return null

  const [rows, items, summarized] = await Promise.all([
    getChatMessages(chatId),
    getContextItems(chatId),
    getSummarizedMessageIds(chatId)
  ])

  const hidden = excludedRuns(
    rows
      .filter((row) => row.role === 'user' && row.id === row.runId)
      .map((row) => ({
        runId: row.runId,
        alternateOf: row.alternateOf,
        attempt: row.attempt
      }))
  )
  const spoken = rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .filter((row) => !hidden.has(row.runId))
    .map((row) => ({ row, text: textOf(row.content) }))
    .filter(({ text }) => text.length > 0)

  const summaryIds = items
    .filter((item) => item.kind === 'summary')
    .map((item) => item.refId)
  const byId = new Map(
    (await getSummariesByIds(summaryIds)).map((summary) => [
      summary.id,
      summary
    ])
  )
  const summaries = summaryIds.flatMap((id) => {
    const summary = byId.get(id)
    if (!summary) return []
    const { text, truncated } = cut(
      summary.content,
      OVERVIEW_LIMITS.summaryChars
    )
    return [
      {
        id: summary.id,
        kind: summary.kind,
        depth: summary.depth,
        earliestAt: summary.earliestAt.toISOString(),
        latestAt: summary.latestAt.toISOString(),
        content: text,
        ...(truncated ? { truncated: true as const } : {})
      }
    ]
  })

  const messages = spoken
    .filter(({ row }) => !summarized.has(row.id))
    .map(({ row, text }) => {
      const shown = cut(text, OVERVIEW_LIMITS.messageChars)
      return {
        id: row.id,
        role: row.role as 'user' | 'assistant',
        createdAt: row.createdAt.toISOString(),
        text: shown.text,
        ...(shown.truncated ? { truncated: true as const } : {})
      }
    })

  const keptSummaries = newestThatFit(
    summaries,
    OVERVIEW_LIMITS.summariesChars,
    (summary) => summary.content.length
  )
  const keptMessages = newestThatFit(
    messages,
    OVERVIEW_LIMITS.messagesChars,
    (message) => message.text.length
  )

  return {
    conversation: {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      messages: spoken.length
    },
    summaries: keptSummaries.kept,
    messages: keptMessages.kept,
    omitted: {
      summaryIds: keptSummaries.left.map((summary) => summary.id),
      messages: keptMessages.left.length
    }
  }
}
