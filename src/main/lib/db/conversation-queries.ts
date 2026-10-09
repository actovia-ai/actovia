import { asc, desc, eq, sql } from 'drizzle-orm'

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
 * preview line under each title in the conversation list.
 */
export async function getLatestMessagePerConversation(): Promise<
  LatestMessage[]
> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON ("conversationId")
      "conversationId",
      "role",
      "content",
      "agentId",
      "createdAt"
    FROM ${conversationMessage}
    ORDER BY "conversationId", "createdAt" DESC
  `)
  // db.execute on pglite returns { rows }; normalize.
  const list = (rows as unknown as { rows: unknown[] }).rows ?? rows
  return list as LatestMessage[]
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

export async function getMessagesByConversationId(conversationId: string) {
  return db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.conversationId, conversationId))
    .orderBy(asc(conversationMessage.createdAt))
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

export async function getConversationMessageById(id: string) {
  const [row] = await db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.id, id))
  return row
}
