/**
 * `GET /api/v1/history?limit=N[&before=<cursor>]`: the chat list a page at a
 * time (backlog 24, 2026-10-06). Without `limit` the route answers the whole
 * list as a bare array, as it always has. The cursor's format lives in
 * `utils/chat-history-cursor.ts`; actovia-ios mirrors it.
 */

/** A chat row as the list carries it (`createdAt` an ISO string on the wire). */
export interface ChatHistoryItem {
  id: string
  title: string
  createdAt: Date | string
  favorite: boolean | null
}

export interface ChatHistoryPage<C = ChatHistoryItem> {
  /** The newest `limit` chats older than the cursor, newest first (favourites included). */
  chats: C[]
  /** Pass as `before` for the next older page; `null` when there is none. */
  olderCursor: string | null
  /** Every favourite, newest first — on the first page only (no `before`). */
  favorites?: C[]
}
