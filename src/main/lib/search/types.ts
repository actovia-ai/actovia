import type { ChatSearchResult } from '@exodus/shared/types/chat-search'

import type { Message } from '../db/schema'

export interface SearchProvider {
  indexMessage(message: Message): Promise<void>
  /** Batched form of `indexMessage`, for reindexing existing history. */
  bulkIndexMessages(messages: Message[]): Promise<void>
  deleteByChatId(chatId: string): Promise<void>
  /** Clears the whole index — mirrors a full `resetAllData()` on the DB side. */
  deleteAll(): Promise<void>
  /** One row per chat, newest match first (`chat-search-results.ts`). */
  search(query: string): Promise<ChatSearchResult[]>
  /**
   * Pure connectivity/health check — must not depend on the index existing
   * (so it works against a freshly-configured cluster before anything has
   * been indexed) or on any data being present.
   */
  ping(): Promise<void>
}
