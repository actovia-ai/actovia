import type {
  ChatSearchResult,
  ChatSearchSnippet
} from '@actovia/shared/types/chat-search'

import { buildSnippet } from './snippet'

/** The most chats one search answers, and snippets one chat carries. */
export const CHAT_SEARCH_LIMIT = 30
export const SNIPPETS_PER_CHAT = 3

/** A chat found by its title or by a message (which brings its title along). */
export interface ChatHit {
  chatId: string
  title: string
  /** When the chat was last active: its `matchedAt` when no message matched. */
  activityAt: Date | string
}

/** A matching message; only its search text is read, for the snippet. */
export interface MessageHit {
  id: string
  chatId: string
  /** The run the message belongs to; null on a row no run claimed. */
  runId?: string | null
  role: string
  searchText: string | null
  createdAt: Date | string
}

const iso = (value: Date | string) => new Date(value).toISOString()

/**
 * Folds the chats and messages a search found into the response: one row
 * per chat, newest match first, at most 30, each with the snippets of its 3
 * newest matching messages, whatever order the hits arrive in.
 */
export function buildChatSearchResults(
  chats: ChatHit[],
  messages: MessageHit[],
  words: string[]
): ChatSearchResult[] {
  const byChat = new Map<string, MessageHit[]>()
  for (const m of messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || !m.searchText) continue
    byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m])
  }

  const seen = new Set<string>()
  const results: ChatSearchResult[] = []
  for (const chat of chats) {
    if (seen.has(chat.chatId)) continue
    seen.add(chat.chatId)
    const hits = (byChat.get(chat.chatId) ?? []).toSorted(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    const snippets = hits
      .slice(0, SNIPPETS_PER_CHAT)
      .map((m): ChatSearchSnippet => ({
        messageId: m.id,
        ...(m.runId ? { runId: m.runId } : {}),
        role: m.role as ChatSearchSnippet['role'],
        text: buildSnippet(m.searchText ?? '', words),
        createdAt: iso(m.createdAt)
      }))
    results.push({
      chatId: chat.chatId,
      title: chat.title,
      matchedAt: snippets[0]?.createdAt ?? iso(chat.activityAt),
      snippets
    })
  }

  return results
    .toSorted((a, b) => Date.parse(b.matchedAt) - Date.parse(a.matchedAt))
    .slice(0, CHAT_SEARCH_LIMIT)
}
