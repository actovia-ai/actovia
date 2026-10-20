import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { and, desc, eq, inArray, max } from 'drizzle-orm'

import { db } from '../db/db'
import { chatSource, message, type ChatSource } from '../db/schema'

/**
 * A chat's numbered sources (spec 2026-10-01 §B4): every result of its
 * `web_search` calls and every page `web_fetch` read, kept apart from the
 * messages so a number can be looked up without reading the conversation —
 * by `recall({ source })`, by the next run counting on from the highest
 * number, and by the clients' citation map. Derived from the `message` rows,
 * which stay the record: the run's rows are saved here when it is persisted,
 * and a chat older than the table (or restored by an import, which carries
 * messages only) is filled in from its messages the first time it is asked.
 */

/** What `sourcesOfRows` reads of a stored message row. */
export interface SourceBearingRow {
  chatId: string
  runId: string
  role: string
  content: unknown
  toolCallId: string | null
  toolName: string | null
  details: unknown
  isError: boolean | null
  createdAt: Date
}

const WEB_TOOLS: string[] = [TOOL_NAMES.webSearch, TOOL_NAMES.webFetch]

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part?.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n')
}

function sourceRow(
  row: SourceBearingRow,
  source: unknown,
  content: string | null
): ChatSource | null {
  if (typeof source !== 'object' || source === null) return null
  const s = source as Record<string, unknown>
  const rank = s.rank
  const link = str(s.link)
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1) {
    return null
  }
  if (!link) return null
  return {
    chatId: row.chatId,
    rank,
    toolCallId: row.toolCallId ?? '',
    runId: row.runId,
    toolName: row.toolName ?? '',
    link,
    title: str(s.title) ?? link,
    siteName: str(s.siteName),
    hostname: str(s.hostname),
    favicon: str(s.favicon),
    snippet: str(s.snippet),
    thumbnail: str(s.thumbnail),
    age: str(s.age),
    content: content ?? str(s.content) ?? '',
    createdAt: row.createdAt
  }
}

/**
 * The sources a set of stored rows carries: a search's results (each with
 * the extract the model read) and a fetched page (whole — its `details`
 * keep a preview only; the page is the result's text). A failed call, a
 * fetch without a number and every other tool carry none.
 */
export function sourcesOfRows(rows: SourceBearingRow[]): ChatSource[] {
  const out: ChatSource[] = []
  for (const row of rows) {
    if (row.role !== 'toolResult' || row.isError) continue
    if (row.toolName === TOOL_NAMES.webSearch && Array.isArray(row.details)) {
      for (const source of row.details) {
        const s = sourceRow(row, source, null)
        if (s) out.push(s)
      }
    } else if (row.toolName === TOOL_NAMES.webFetch) {
      const s = sourceRow(row, row.details, textOf(row.content))
      if (s) out.push(s)
    }
  }
  return out
}

/** Saves sources; one already saved (same call, same rank) is left as it is. */
export async function saveChatSources(rows: ChatSource[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(chatSource).values(rows).onConflictDoNothing()
}

/**
 * Fills in a chat's sources from its messages when it has none saved — a
 * chat from before the table, or restored by an import. Two indexed reads
 * when there is nothing to do.
 */
export async function ensureChatSources(chatId: string): Promise<void> {
  const [any] = await db
    .select({ rank: chatSource.rank })
    .from(chatSource)
    .where(eq(chatSource.chatId, chatId))
    .limit(1)
  if (any) return
  const rows = await db
    .select({
      chatId: message.chatId,
      runId: message.runId,
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      details: message.details,
      isError: message.isError,
      createdAt: message.createdAt
    })
    .from(message)
    .where(
      and(eq(message.chatId, chatId), inArray(message.toolName, WEB_TOOLS))
    )
  await saveChatSources(sourcesOfRows(rows))
}

/**
 * The highest number a source of the chat carries: a new run numbers its
 * sources after it, so a 【3-source】 means one source in the whole chat,
 * whichever run found it.
 */
export async function highestSourceRank(chatId: string): Promise<number> {
  await ensureChatSources(chatId)
  const [row] = await db
    .select({ highest: max(chatSource.rank) })
    .from(chatSource)
    .where(eq(chatSource.chatId, chatId))
  return row?.highest ?? 0
}

/**
 * Source `rank` of the chat. Ranks repeat in a chat numbered before
 * 2026-09-29, when every run counted from 1; the newest source of a rank is
 * the one a citation of it meant, as the clients have always resolved it.
 */
export async function getChatSource(
  chatId: string,
  rank: number
): Promise<ChatSource | null> {
  await ensureChatSources(chatId)
  const [row] = await db
    .select()
    .from(chatSource)
    .where(and(eq(chatSource.chatId, chatId), eq(chatSource.rank, rank)))
    .orderBy(desc(chatSource.createdAt))
    .limit(1)
  return row ?? null
}

/** Every source of the chat, oldest first. */
export async function listChatSources(chatId: string): Promise<ChatSource[]> {
  await ensureChatSources(chatId)
  return db
    .select()
    .from(chatSource)
    .where(eq(chatSource.chatId, chatId))
    .orderBy(chatSource.createdAt, chatSource.rank)
}
