import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'

import { db } from './db'
import { conversation, conversationMessage, type Conversation } from './schema'

// ─── Conversation ─────────────────────────────────────────────────────────────

export async function getAllConversations() {
  return db
    .select()
    .from(conversation)
    .orderBy(desc(conversation.lastMessageAt))
}

export interface LatestMessage {
  conversationId: string
  role: 'user' | 'pm' | 'employee' | 'system'
  content: string
  agentId: string | null
  createdAt: Date
}

/**
 * One row per conversation: the most recent message. Used to render a
 * preview line under each title in the conversation list. Through drizzle's
 * select, not raw SQL: `db.execute` hands a timestamp back as the column's
 * zone-less text, which a client then reads as its own local time.
 */
export async function getLatestMessagePerConversation(): Promise<
  LatestMessage[]
> {
  return db
    .selectDistinctOn([conversationMessage.conversationId], {
      conversationId: conversationMessage.conversationId,
      role: conversationMessage.role,
      content: conversationMessage.content,
      agentId: conversationMessage.agentId,
      createdAt: conversationMessage.createdAt
    })
    .from(conversationMessage)
    .orderBy(
      conversationMessage.conversationId,
      desc(conversationMessage.createdAt)
    )
}

export async function getConversationById(id: string) {
  const [row] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, id))
  return row
}

export async function createConversation(
  data: typeof conversation.$inferInsert
) {
  const [row] = await db.insert(conversation).values(data).returning()
  return row
}

export async function updateConversation(
  id: string,
  data: Partial<typeof conversation.$inferInsert>
) {
  const [row] = await db
    .update(conversation)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(conversation.id, id))
    .returning()
  return row
}

export async function touchConversation(id: string) {
  const now = new Date()
  const [row] = await db
    .update(conversation)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversation.id, id))
    .returning()
  return row
}

export async function deleteConversation(id: string) {
  // conversation_message + task (and their executions/events) cascade via FK.
  return db.delete(conversation).where(eq(conversation.id, id))
}

export async function addMemberToConversation(
  conversationId: string,
  agentId: string
) {
  const current = await getConversationById(conversationId)
  const members = new Set<string>(
    (current?.memberAgentIds as string[] | null) ?? []
  )
  members.add(agentId)
  const [row] = await db
    .update(conversation)
    .set({ memberAgentIds: [...members], updatedAt: new Date() })
    .where(eq(conversation.id, conversationId))
    .returning()
  return row as Conversation & { memberAgentIds: string[] }
}

// ─── Conversation messages ────────────────────────────────────────────────────

// A group's rows in one order: by time, then by id, so two rows saved in the
// same millisecond never swap between two reads (`getMessagesAfter` relies on it).
const MESSAGE_ORDER = [
  asc(conversationMessage.createdAt),
  asc(conversationMessage.id)
] as const

export async function getMessagesByConversationId(conversationId: string) {
  return db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.conversationId, conversationId))
    .orderBy(...MESSAGE_ORDER)
}

/**
 * The rows saved after `afterId`, in the order above; null when `afterId` is
 * not a row of the conversation. Rows are edited after they are saved (an
 * agent card's parts), and this does not return those edits: it is for the
 * re-read after a `message_end`, while a client that (re)connects reads
 * everything.
 */
export async function getMessagesAfter(
  conversationId: string,
  afterId: string
) {
  // The anchor's time is compared inside the database, never round-tripped
  // through a JS Date: `createdAt` keeps microseconds, a Date only
  // milliseconds, and a truncated anchor would sort before itself.
  const anchor = db
    .select({
      createdAt: conversationMessage.createdAt,
      id: conversationMessage.id
    })
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.conversationId, conversationId),
        eq(conversationMessage.id, afterId)
      )
    )
  const [found] = await anchor
  if (!found) return null
  return db
    .select()
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.conversationId, conversationId),
        sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) > (${anchor})`
      )
    )
    .orderBy(...MESSAGE_ORDER)
}

/** An employee's latest reports in a group, newest first. */
export async function getEmployeeReports(
  conversationId: string,
  agentId: string,
  limit: number
) {
  return db
    .select({
      content: conversationMessage.content,
      createdAt: conversationMessage.createdAt
    })
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.conversationId, conversationId),
        eq(conversationMessage.agentId, agentId),
        eq(conversationMessage.role, 'employee'),
        ne(conversationMessage.content, '')
      )
    )
    .orderBy(desc(conversationMessage.createdAt))
    .limit(limit)
}

export async function createConversationMessage(
  data: typeof conversationMessage.$inferInsert
) {
  const [row] = await db.insert(conversationMessage).values(data).returning()
  // Bump the parent conversation so it sorts to the top of the list.
  await touchConversation(data.conversationId)
  return row
}

export async function updateConversationMessageParts(
  id: string,
  parts: Record<string, unknown>[]
): Promise<void> {
  await db
    .update(conversationMessage)
    .set({ parts })
    .where(eq(conversationMessage.id, id))
}

export async function updateConversationMessageContent(
  id: string,
  content: string
): Promise<void> {
  await db
    .update(conversationMessage)
    .set({ content })
    .where(eq(conversationMessage.id, id))
}

export async function getConversationMessageById(id: string) {
  const [row] = await db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.id, id))
  return row
}
