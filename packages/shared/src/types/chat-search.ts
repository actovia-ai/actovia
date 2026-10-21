/**
 * `GET /api/v1/chat/search?query=<q>`: one row per chat, newest match first,
 * at most 30 (owner, 2026-10-14). actovia-ios decodes the same shape.
 *
 * A chat matches when one of its user/assistant messages contains every word
 * of the query, or its title does (case-insensitive substrings, so CJK needs
 * no word breaks). An empty query answers `[]`.
 */
export interface ChatSearchResult {
  chatId: string
  title: string
  /** ISO 8601: the newest matching message's `createdAt`; for a title-only match, the chat's last activity. */
  matchedAt: string
  /** At most 3, newest first; `[]` when only the title matched. */
  snippets: ChatSearchSnippet[]
}

export interface ChatSearchSnippet {
  messageId: string
  /**
   * The run the message belongs to (`message.runId`), so a client can load
   * the chat's history back through it and open there. Absent on a row no
   * run claimed.
   */
  runId?: string
  role: 'user' | 'assistant'
  /**
   * Plain text of at most ~160 characters around the first matched word
   * (about 40 before it), '…' at a cut end; Markdown, 【N-source】 markers and
   * runs of whitespace removed.
   */
  text: string
  createdAt: string
}
