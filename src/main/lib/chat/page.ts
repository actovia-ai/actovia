import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { NotFoundError } from '@actovia/shared/errors/app-error'
import type {
  ChatPage,
  ChatPageQuestion,
  ChatPageRow,
  ChatPageSource
} from '@actovia/shared/types/chat-page'
import { and, eq } from 'drizzle-orm'

import { db } from '../db/db'
import { getMessagesByChatId } from '../db/queries'
import { message } from '../db/schema'
import type { ChatSource, DBMessage } from '../db/schema'
import { listChatSources } from './sources'

/**
 * A chat's history a page at a time (spec 2026-10-01 §C3): a chat with a few
 * searches was 2.4 MB in one `GET /api/v1/chat/:id`, seconds over a phone's
 * slow link. A page is the newest `runs` runs — whole runs, and a regenerate
 * group whole even past the size — in the same row shape as that route,
 * without what no client reads (`compactRow`); and with it, for the whole
 * chat, what a client needs of the runs it has not loaded: every numbered
 * source (citations, the Sources sheet, Copy's references) and every
 * question (the outline).
 */

export interface PageQuery {
  runs: number
  /** A run id (an `olderCursor`): the page ends just before its group. */
  before?: string
  /** A run id: the page reaches back at least to its group (the outline). */
  through?: string
}

const QUESTION_CHARS = 200
/** A row larger than this is sent cut (`limitRow`). */
const ROW_LIMIT = 64 * 1024
/** What a cut keeps of each long string. */
const CUT_CHARS = 8 * 1024

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(
            (p): p is { type: 'text'; text: string } =>
              p?.type === 'text' && typeof p.text === 'string'
          )
          .map((p) => p.text)
          .join('\n')
      : ''

function dropKey<T extends object>(value: T, key: string): T {
  if (!(key in value)) return value
  const { [key]: _dropped, ...rest } = value as Record<string, unknown>
  return rest as T
}

/**
 * A stored row as a page carries it. Not sent — no client reads it (audit
 * 2026-10-01): `searchText` and `chatId`; a successful result's text when
 * its `details` carry the payload both clients render from (the text is
 * often `JSON.stringify(details)`; computer use keeps it — iOS draws the
 * final screenshot from it); a search result's extract (`details[].content`:
 * the cards show the snippet); an artifact call's `code` (the card reads the
 * result's). Every error text, user image, thinking block and memory change
 * stays. The full row is still `GET /api/v1/chat/:id`.
 */
export function compactRow(row: DBMessage): ChatPageRow {
  const { searchText: _s, chatId: _c, ...rest } = row
  let out: ChatPageRow = rest
  if (
    row.role === 'toolResult' &&
    !row.isError &&
    row.details !== null &&
    row.details !== undefined &&
    row.toolName !== TOOL_NAMES.computerUse
  ) {
    out = { ...out, content: [] }
  }
  if (row.toolName === TOOL_NAMES.webSearch && Array.isArray(row.details)) {
    out = {
      ...out,
      details: row.details.map((s) =>
        s && typeof s === 'object' ? dropKey(s as object, 'content') : s
      )
    }
  }
  if (row.role === 'assistant' && Array.isArray(row.content)) {
    out = {
      ...out,
      content: row.content.map((part) => {
        const p = part as { type?: string; name?: string; arguments?: object }
        return p?.type === 'toolCall' &&
          p.name === TOOL_NAMES.createArtifact &&
          p.arguments &&
          typeof p.arguments === 'object'
          ? { ...p, arguments: dropKey(p.arguments, 'code') }
          : part
      })
    }
  }
  return out
}

function cutStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > CUT_CHARS ? `${value.slice(0, CUT_CHARS)}…` : value
  }
  if (Array.isArray(value)) return value.map((v) => cutStrings(v))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, cutStrings(v)])
    )
  }
  return value
}

/**
 * A row over 64 KB — a long terminal output, a big file, a pasted document —
 * with each long string cut to its first 8 KB and `truncated: true`; the
 * client reads it whole from `GET /api/v1/chat/:id/messages/:messageId`.
 */
export function limitRow(row: ChatPageRow): ChatPageRow {
  if (JSON.stringify(row).length <= ROW_LIMIT) return row
  return {
    ...row,
    content: cutStrings(row.content),
    details: cutStrings(row.details),
    truncated: true
  }
}

/** One row of the chat, whole: what a `truncated` page row stands for. */
export async function loadChatRow(
  chatId: string,
  messageId: string
): Promise<ChatPageRow> {
  const [row] = await db
    .select()
    .from(message)
    .where(and(eq(message.chatId, chatId), eq(message.id, messageId)))
    .limit(1)
  if (!row) {
    throw new NotFoundError(
      ErrorCode.MESSAGE_NOT_FOUND,
      'No message with that id in this chat.'
    )
  }
  const { searchText: _s, chatId: _c, ...rest } = row
  return rest
}

function compactSource(s: ChatSource): ChatPageSource {
  const out: ChatPageSource = {
    rank: s.rank,
    link: s.link,
    title: s.title,
    runId: s.runId
  }
  for (const key of [
    'siteName',
    'hostname',
    'favicon',
    'snippet',
    'thumbnail',
    'age'
  ] as const) {
    const value = s[key]
    if (value !== null) out[key] = value
  }
  return out
}

/** Runs grouped as they are drawn: a regenerate group is one unit. */
function unitsOf(rows: DBMessage[]): { key: string; runIds: string[] }[] {
  const units: { key: string; runIds: string[] }[] = []
  const byKey = new Map<string, { key: string; runIds: string[] }>()
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.runId)) continue
    seen.add(row.runId)
    const key =
      row.role === 'user' && row.runId === row.id && row.alternateOf
        ? row.alternateOf
        : row.runId
    let unit = byKey.get(key)
    if (!unit) {
      unit = { key, runIds: [] }
      byKey.set(key, unit)
      units.push(unit)
    }
    unit.runIds.push(row.runId)
  }
  return units
}

function notFound(): NotFoundError {
  return new NotFoundError(
    ErrorCode.RUN_NOT_FOUND,
    'No run with that id in this chat.'
  )
}

export async function loadChatPage(
  chatId: string,
  query: PageQuery
): Promise<ChatPage> {
  const [rows, sources] = await Promise.all([
    getMessagesByChatId({ id: chatId }),
    listChatSources(chatId)
  ])
  const units = unitsOf(rows)
  const unitOf = (runId: string) => {
    const i = units.findIndex((u) => u.runIds.includes(runId))
    if (i < 0) throw notFound()
    return i
  }

  const end = query.before ? unitOf(query.before) : units.length
  let start = end
  let runs = 0
  while (start > 0 && (runs < query.runs || start === end)) {
    start--
    runs += units[start].runIds.length
  }
  if (query.through) start = Math.min(start, unitOf(query.through))

  const included = new Set(units.slice(start, end).flatMap((u) => u.runIds))
  const questions: ChatPageQuestion[] = []
  for (const unit of units) {
    const head = rows.find((r) => r.id === unit.runIds[0])
    if (!head || head.role !== 'user') continue
    questions.push({
      runId: head.id,
      text: textOf(head.content).slice(0, QUESTION_CHARS),
      createdAt: head.createdAt.getTime()
    })
  }

  const hasOlder = start > 0
  return {
    messages: rows
      .filter((r) => included.has(r.runId))
      .map((r) => limitRow(compactRow(r))),
    sources: sources.map((s) => compactSource(s)),
    questions,
    hasOlder,
    olderCursor: hasOlder ? units[start].runIds[0] : null
  }
}
