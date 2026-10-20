import type { ChatMessage } from '@actovia/shared/types/chat'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage
} from '@earendil-works/pi-ai'
import { and, eq } from 'drizzle-orm'

import { storedUsage } from '../ai/utils/usage'
import { db } from '../db/db'
import { getMessagesByChatId } from '../db/queries'
import { message, type DBMessage } from '../db/schema'

/**
 * A chat's conversation as the server reads it. Clients used to post the
 * whole conversation back with every send — 2.4 MB for a chat with a few
 * searches, on a phone's uplink — and the server built the model's context
 * (LCM off), the source numbering and the `done` echo from what they sent.
 * Now it reads its own rows (spec 2026-10-01 §C1); a client sends what is new.
 */
export async function loadChatHistory(chatId: string): Promise<ChatMessage[]> {
  return (await getMessagesByChatId({ id: chatId })).map(rowToChatMessage)
}

/** One row as the message a client would have posted: every field kept. */
export function rowToChatMessage(row: DBMessage): ChatMessage {
  const timestamp = row.createdAt.getTime()
  if (row.role === 'user') {
    return {
      id: row.id,
      runId: row.runId,
      role: 'user',
      content: row.content as UserMessage['content'],
      timestamp,
      ...(row.alternateOf ? { alternateOf: row.alternateOf } : {}),
      ...(row.attempt ? { attempt: row.attempt } : {})
    } as ChatMessage
  }
  if (row.role === 'assistant') {
    return {
      id: row.id,
      runId: row.runId,
      role: 'assistant',
      content: row.content as AssistantMessage['content'],
      // pi reads `usage` off every assistant message of a request.
      usage: storedUsage(row.usage),
      api: row.api ?? '',
      provider: row.provider ?? '',
      model: row.model ?? '',
      stopReason: row.stopReason ?? 'stop',
      ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
      ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
      timestamp
    } as ChatMessage
  }
  return {
    id: row.id,
    runId: row.runId,
    role: 'toolResult',
    content: row.content as ToolResultMessage['content'],
    toolCallId: row.toolCallId ?? '',
    toolName: row.toolName ?? '',
    details: row.details,
    isError: row.isError ?? false,
    timestamp
  } as ChatMessage
}

/** An earlier call of a chat as stored: its arguments and its result row. */
export interface StoredToolCall {
  toolName: string
  arguments: unknown
  result: DBMessage
}

/**
 * Call `toolCallId` of the chat, for `recall({ call })`: the result row,
 * and the arguments from the assistant message of the same run that made
 * the call. Only this chat's rows are read.
 */
export async function findToolCall(
  chatId: string,
  toolCallId: string
): Promise<StoredToolCall | null> {
  const [result] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.chatId, chatId),
        eq(message.role, 'toolResult'),
        eq(message.toolCallId, toolCallId)
      )
    )
    .limit(1)
  if (!result) return null
  const answers = await db
    .select({ content: message.content })
    .from(message)
    .where(
      and(
        eq(message.chatId, chatId),
        eq(message.runId, result.runId),
        eq(message.role, 'assistant')
      )
    )
  for (const { content } of answers) {
    if (!Array.isArray(content)) continue
    for (const part of content as { type?: string; id?: string }[]) {
      if (part?.type === 'toolCall' && part.id === toolCallId) {
        return {
          toolName: result.toolName ?? '',
          arguments: (part as { arguments?: unknown }).arguments ?? {},
          result
        }
      }
    }
  }
  return { toolName: result.toolName ?? '', arguments: {}, result }
}
