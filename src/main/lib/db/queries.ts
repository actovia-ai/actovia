import { ErrorCode, DatabaseError } from '@actovia/shared'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatSearchResult } from '@actovia/shared/types/chat-search'
import { chatHistoryCursor } from '@actovia/shared/utils/chat-history-cursor'
import { and, asc, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm'

import { logger } from '../logger'
import { addLogSecrets } from '../logger/secret-mask'
import {
  buildChatSearchResults,
  CHAT_SEARCH_LIMIT,
  type ChatHit,
  type MessageHit,
  SNIPPETS_PER_CHAT
} from '../search/chat-search-results'
import { extractSearchableText } from '../search/extract-searchable-text'
import { searchWords } from '../search/snippet'
import { secretSafeWriteError, settingsColumnHasSecrets } from '../secrets'
import {
  decryptSettingsRow,
  planSettingsWrite,
  type StoredSettingsState
} from '../secrets/at-rest'
import { recordSettingsWrite } from '../secrets/moved'
import { SETTINGS_SECRET_PATHS } from '../secrets/registry'
import { recordSettingsDecryptFailures } from '../secrets/status'
import { settingsSecretValues } from '../secrets/values'
import { db, pglite } from './db'
import {
  chat,
  DBMessage,
  deepResearch,
  deepResearchMessage,
  message,
  settings,
  vote,
  type Chat,
  type DeepResearch,
  type DeepResearchMessage,
  type Message,
  type Settings
} from './schema'

function logDbError(logMessage: string, error: unknown) {
  logger.error('database', logMessage, {
    error
  })
}

export async function saveChat({ title, id }: { id: string; title: string }) {
  try {
    return await db.insert(chat).values({ id, title })
  } catch (error) {
    logDbError('Failed to save chat', error)
    throw error
  }
}

export async function updateChat(payload: Omit<Chat, 'createdAt'>) {
  try {
    return await db.update(chat).set(payload).where(eq(chat.id, payload.id))
  } catch (error) {
    logDbError('Failed to update chat', error)
    throw error
  }
}

export async function getAllChats() {
  try {
    return await db.select().from(chat).orderBy(desc(chat.createdAt))
  } catch (error) {
    logDbError('Failed to get chats', error)
    throw error
  }
}

// The list's order, to the millisecond: `createdAt` is stored to the
// microsecond (`defaultNow()`), but a cursor carries a JS Date. Ordering and
// comparing on the same truncated value keeps a row that shares the cursor's
// millisecond from being skipped or sent twice; `id` breaks the tie.
const chatCreatedAtMs = sql<Date>`date_trunc('milliseconds', ${chat.createdAt})`

/**
 * A page of the chat list (`GET /api/v1/history?limit=`): the `limit` newest
 * chats strictly older than `before`'s `(createdAt, id)`, newest first, and
 * the last one's cursor when more exist.
 */
export async function getChatsPage({
  limit,
  before
}: {
  limit: number
  before?: { createdAt: Date; id: string }
}): Promise<{ chats: Chat[]; olderCursor: string | null }> {
  try {
    const at = before && sql`${before.createdAt.toISOString()}::timestamp`
    const rows = await db
      .select()
      .from(chat)
      .where(
        before
          ? or(
              sql`${chatCreatedAtMs} < ${at}`,
              and(sql`${chatCreatedAtMs} = ${at}`, lt(chat.id, before.id))
            )
          : undefined
      )
      .orderBy(desc(chatCreatedAtMs), desc(chat.id))
      .limit(limit + 1)
    const chats = rows.slice(0, limit)
    const last = chats.at(-1)
    return {
      chats,
      olderCursor: rows.length > limit && last ? chatHistoryCursor(last) : null
    }
  } catch (error) {
    logDbError('Failed to get a page of chats', error)
    throw error
  }
}

/** Every favourite chat, newest first — the list's first page carries them. */
export async function getFavoriteChats() {
  try {
    return await db
      .select()
      .from(chat)
      .where(eq(chat.favorite, true))
      .orderBy(desc(chat.createdAt), desc(chat.id))
  } catch (error) {
    logDbError('Failed to get favourite chats', error)
    throw error
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id))
    await db.delete(message).where(eq(message.chatId, id))

    return await db.delete(chat).where(eq(chat.id, id))
  } catch (error) {
    logDbError('Failed to delete chat', error)
    throw error
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id))
    return selectedChat
  } catch (error) {
    logDbError('Failed to get chat by id', error)
    throw error
  }
}

export async function saveMessages({
  messages
}: {
  messages: Array<Omit<Message, 'searchText'>>
}) {
  try {
    const rows = messages.map((m) => ({
      ...m,
      searchText: extractSearchableText(m)
    }))
    return await db.insert(message).values(rows)
  } catch (error) {
    logDbError('Failed to save messages', error)
    throw error
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt))
  } catch (error) {
    logDbError('Failed to get messages by chat id', error)
    throw error
  }
}

export async function updateChatTitleById({
  id,
  title
}: {
  id: string
  title: string
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, id))
  } catch (error) {
    logDbError(`Failed to update title for chat ${id}`, error)
    throw error
  }
}

// Currently unused (zero call sites) — kept for a future message-edit
// feature. NOTE: if wired up, this must also recompute `searchText` via
// `extractSearchableText()`, the same way `saveMessages()` does — otherwise
// an edited message's old text stays searchable and its new text doesn't.
export async function updateMessage({
  id,
  content
}: {
  id: string
  content: DBMessage['content']
}) {
  try {
    return await db.update(message).set({ content }).where(eq(message.id, id))
  } catch {
    throw new DatabaseError(
      ErrorCode.DB_QUERY_FAILED,
      'Failed to update message'
    )
  }
}

/** Rewrite an artifact toolResult message's `details.code` (used to re-sync
 * a hand-edited .tsx on disk back into the DB row that the card actually
 * renders from). Returns the number of rows updated. */
export async function updateArtifactCodeByArtifactId({
  artifactId,
  code
}: {
  artifactId: string
  code: string
}): Promise<number> {
  try {
    const result = await db
      .update(message)
      .set({
        details: sql`jsonb_set(${message.details}, '{code}', to_jsonb(${code}::text), false)`
      })
      .where(
        and(
          eq(message.role, 'toolResult'),
          eq(message.toolName, TOOL_NAMES.createArtifact),
          sql`${message.details}->>'artifactId' = ${artifactId}`
        )
      )
      .returning({ id: message.id })
    return result.length
  } catch (error) {
    logDbError('Failed to update artifact code', error)
    throw new DatabaseError(
      ErrorCode.DB_QUERY_FAILED,
      'Failed to update artifact code'
    )
  }
}

/**
 * Escapes LIKE/ILIKE's three special characters (`%`, `_`, and the escape
 * character itself, `\`) so a literal search term containing them is matched
 * literally instead of as a wildcard. Postgres's default LIKE escape
 * character is `\`, so no explicit `ESCAPE` clause is needed at the call
 * site as long as this is applied first.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** A timestamp as the ISO string drizzle reads the column as (stored as UTC). */
const isoText = (value: SQL) =>
  sql`to_char(${value}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/** `column ILIKE %word%` for every word, ANDed. */
function containsEvery(column: SQL, words: string[]): SQL {
  return sql.join(
    words.map((word) => sql`${column} ILIKE ${`%${escapeLikePattern(word)}%`}`),
    sql` AND `
  )
}

/**
 * Chat search on PGlite (`GET /api/v1/chat/search`): strict substring
 * matching via `pg_trgm` (not Postgres's built-in text search), so CJK text —
 * which the built-in parser doesn't segment into words at all — is matched
 * the same way as any other language. A message matches when its search text
 * holds every word (AND, in any order); a chat when one of its messages does
 * or its title holds every word. One query: the 30 chats with the newest
 * match, their titles, and their 3 newest matching messages' search text —
 * nothing else of a row leaves the database.
 */
export async function searchChats(query: string): Promise<ChatSearchResult[]> {
  try {
    const words = searchWords(query)
    if (words.length === 0) return []

    const result = await db.execute(sql`
      WITH hit AS (
        SELECT m.id, m."chatId", m.role, m."searchText", m."createdAt",
          row_number() OVER (PARTITION BY m."chatId" ORDER BY m."createdAt" DESC) AS rank
        FROM ${message} m
        WHERE m.role IN ('user', 'assistant')
          AND ${containsEvery(sql`m."searchText"`, words)}
      ),
      found AS (
        SELECT c.id, c.title,
          COALESCE(
            (SELECT max(h."createdAt") FROM hit h WHERE h."chatId" = c.id),
            (SELECT max(a."createdAt") FROM ${message} a WHERE a."chatId" = c.id),
            c."createdAt"
          ) AS "matchedAt"
        FROM ${chat} c
        WHERE EXISTS (SELECT 1 FROM hit h WHERE h."chatId" = c.id)
          OR (${containsEvery(sql`c.title`, words)})
        ORDER BY "matchedAt" DESC
        LIMIT ${CHAT_SEARCH_LIMIT}
      )
      SELECT f.id AS "chatId", f.title,
        ${isoText(sql`f."matchedAt"`)} AS "matchedAt",
        h.id AS "messageId", h.role, h."searchText",
        ${isoText(sql`h."createdAt"`)} AS "createdAt"
      FROM found f
      LEFT JOIN hit h ON h."chatId" = f.id AND h.rank <= ${SNIPPETS_PER_CHAT}
    `)
    // db.execute on pglite returns { rows }.
    const rows = (
      result as unknown as {
        rows: Array<{
          chatId: string
          title: string
          matchedAt: string
          messageId: string | null
          role: string | null
          searchText: string | null
          createdAt: string | null
        }>
      }
    ).rows

    const messages: MessageHit[] = []
    for (const row of rows) {
      if (!row.messageId || !row.role || !row.createdAt) continue
      messages.push({
        id: row.messageId,
        chatId: row.chatId,
        role: row.role,
        searchText: row.searchText,
        createdAt: row.createdAt
      })
    }
    const chats = rows.map((row): ChatHit => ({
      chatId: row.chatId,
      title: row.title,
      activityAt: row.matchedAt
    }))
    return buildChatSearchResults(chats, messages, words)
  } catch (error) {
    logDbError('Failed to complete full-text search', error)
    throw error
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type
}: {
  chatId: string
  messageId: string
  type: 'up' | 'down'
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)))

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)))
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up'
    })
  } catch (error) {
    logDbError('Failed to vote on message', error)
    throw error
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  return await db.select().from(vote).where(eq(vote.chatId, id))
}

// The settings row is read on every `/api/*` request (app.ts) and by most
// background work, and it used to cost two PGlite round trips each time — an
// upsert-if-missing plus the select — on a single-threaded WASM database that
// every other query queues behind. It only ever changes through the two
// update functions below, so it is read through a cache they invalidate.
//
// The row holds every registry secret encrypted (`secrets/at-rest.ts`); the
// cache keeps the row as stored and as decrypted, so the rest of the process
// sees plaintext and a write can still find a ciphertext that would not open.
let settingsCache: StoredSettingsState<Settings> | null = null
// Bumped on every write. A read that was already in flight when a write landed
// carries the old row; the version check keeps it from re-filling the cache.
let settingsVersion = 0

export function invalidateSettingsCache() {
  settingsCache = null
  settingsVersion++
}

async function loadSettingsState(): Promise<StoredSettingsState<Settings>> {
  if (settingsCache) return settingsCache
  const version = settingsVersion
  await db.insert(settings).values({ id: 'global' }).onConflictDoNothing()
  const [data] = await db.select().from(settings)
  const state = decryptSettingsRow(data!)
  recordSettingsDecryptFailures(state.undecryptable)
  // The logger masks these from now on (M4).
  addLogSecrets(settingsSecretValues(state.plain))
  if (version === settingsVersion) settingsCache = state
  return state
}

export async function getSettings(): Promise<Settings> {
  // A copy, so a caller that edits what it got can't rewrite everyone's view.
  return structuredClone((await loadSettingsState()).plain)
}

/**
 * A settings write in its stored form (spec 2026-09-25 §2.2–2.3): posted masks
 * back to the stored plaintext (the API hands out masks only, and a client
 * that posts one back — the desktop autosave posts whole sections, actovia-ios
 * whole columns — means "unchanged"), a secret whose destination moves
 * cleared, and every secret encrypted. See `prepareSettingsWrite`.
 */
async function toStoredForm<T extends object>(payload: T) {
  return planSettingsWrite(payload, await loadSettingsState())
}

export async function updateSettings(payload: Settings) {
  const plan = await toStoredForm(payload)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdAt, updatedAt, lastBackupAt, ...rest } = plan.write
  try {
    const result = await db
      .update(settings)
      .set({
        ...rest,
        // lastBackupAt arrives as ISO string from frontend; convert to Date for DB
        lastBackupAt: lastBackupAt
          ? new Date(lastBackupAt as unknown as string)
          : null,
        updatedAt: new Date()
      })
      .where(eq(settings.id, payload.id))
    // A key cleared for a new base URL is asked for again, across restarts.
    recordSettingsWrite(plan)
    return result
  } catch (error) {
    const safe = secretSafeWriteError('Failed to update settings', error)
    logDbError(safe.message, safe)
    throw safe
  } finally {
    invalidateSettingsCache()
  }
}

export async function updateSettingField(
  field: keyof Settings,
  value: unknown
) {
  const plan = settingsColumnHasSecrets(field)
    ? await toStoredForm({ [field]: value })
    : null
  const resolved = plan ? plan.write[field] : value
  try {
    const result = await db
      .update(settings)
      .set({ [field]: resolved, updatedAt: new Date() })
      .where(eq(settings.id, 'global'))
    if (plan) recordSettingsWrite(plan)
    return result
  } catch (error) {
    const safe = secretSafeWriteError(
      `Failed to update setting field: ${field}`,
      error
    )
    logDbError(safe.message, safe)
    throw safe
  } finally {
    invalidateSettingsCache()
  }
}

export async function resetAllData() {
  // Order matters for foreign key constraints — children before parents
  const tables = [
    'vote',
    'deep_research_message',
    'deep_research',
    'task_execution_event',
    'task_execution',
    'task',
    'lcm_context_items',
    'lcm_summary_messages',
    'lcm_summary_parents',
    'lcm_summary',
    'memory_usage_log',
    'memory',
    'agent_memory',
    'agent',
    'chat_source',
    'message',
    'chat'
  ]

  for (const table of tables) {
    await pglite.query(`TRUNCATE "${table}" CASCADE`)
  }
}

export async function importData(tableName: string, blob: Blob) {
  await pglite.query(`COPY "${tableName}" FROM '/dev/blob';`, [], {
    blob
  })
}

export async function exportData(tableName: string) {
  if (tableName === 'settings') return exportSettingsWithoutSecrets()
  const ret = await pglite.query(
    `COPY "${tableName}" TO '/dev/blob' DELIMITER ',' CSV HEADER;`
  )
  return ret.blob
}

/**
 * The settings table for a db-io export, with every registry secret removed
 * (spec 2026-09-25 §2.2–2.3: an export carries neither plaintext nor
 * ciphertext). A copy in a temp table has the secret keys deleted from its
 * jsonb columns (`#-`) and a whole-value secret column nulled, then that copy
 * is what COPY writes — same columns, same order, as before.
 */
function exportSettingsWithoutSecrets() {
  const byColumn = new Map<string, string[][]>()
  for (const path of SETTINGS_SECRET_PATHS) {
    const [column, ...rest] = path.split('.')
    byColumn.set(column, [...(byColumn.get(column) ?? []), rest])
  }
  const sets = [...byColumn].map(([column, rests]) =>
    rests.some((r) => r.length === 0)
      ? `"${column}" = NULL`
      : `"${column}" = "${column}"${rests.map((r) => ` #- '{${r.join(',')}}'`).join('')}`
  )
  return pglite.transaction(async (tx) => {
    await tx.exec(
      `CREATE TEMP TABLE settings_export ON COMMIT DROP AS SELECT * FROM settings;
       UPDATE settings_export SET ${sets.join(', ')};`
    )
    const ret = await tx.query(
      `COPY settings_export TO '/dev/blob' DELIMITER ',' CSV HEADER;`
    )
    return ret.blob
  })
}

export async function saveDeepResearch(payload: DeepResearch) {
  try {
    return await db.insert(deepResearch).values(payload)
  } catch (error) {
    logDbError('Failed to save deep research', error)
    throw error
  }
}

export async function getDeepResearchById({ id }: { id: string }) {
  try {
    const [selectedDeepSearch] = await db
      .select()
      .from(deepResearch)
      .where(eq(deepResearch.id, id))
    return selectedDeepSearch
  } catch (error) {
    logDbError('Failed to get deep research by id', error)
    throw error
  }
}

export async function updateDeepResearch(payload: DeepResearch) {
  try {
    return await db
      .update(deepResearch)
      .set(payload)
      .where(eq(deepResearch.id, payload.id))
  } catch (error) {
    logDbError('Failed to update deep research', error)
    throw error
  }
}

export async function saveDeepResearchMessage(payload: DeepResearchMessage) {
  try {
    return await db.insert(deepResearchMessage).values(payload)
  } catch (error) {
    logDbError('Failed to save deep research message', error)
    throw error
  }
}

export async function getDeepResearchMessagesById({ id }: { id: string }) {
  try {
    const deepResearchMessages = await db
      .select()
      .from(deepResearchMessage)
      .where(eq(deepResearchMessage.deepResearchId, id))
      .orderBy(asc(deepResearchMessage.createdAt))
    return deepResearchMessages
  } catch (error) {
    logDbError('Failed to get deep research messages', error)
    throw error
  }
}

/**
 * Aggregate token usage and costs from all assistant messages.
 * Returns per-row data so the caller can group however they want.
 */
export async function getUsageRows() {
  const rows = await db
    .select({
      model: message.model,
      provider: message.provider,
      usage: message.usage,
      createdAt: message.createdAt
    })
    .from(message)
    .where(
      and(eq(message.role, 'assistant'), sql`${message.usage} is not null`)
    )
    .orderBy(desc(message.createdAt))
  return rows
}
