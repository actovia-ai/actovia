// The chat list's paging cursor (`GET /api/v1/history?before=`):
// `"<createdAt ISO>|<id>"` of the last chat of a page — the `(createdAt, id)`
// pair the list is ordered by, newest first. The ISO part never holds a `|`,
// so the split is on the first one and an id may contain anything.
// actovia-ios builds and reads the same string.

const SEPARATOR = '|'

export function chatHistoryCursor(chat: {
  createdAt: Date | string
  id: string
}): string {
  const createdAt =
    chat.createdAt instanceof Date ? chat.createdAt : new Date(chat.createdAt)
  return `${createdAt.toISOString()}${SEPARATOR}${chat.id}`
}

/** The pair a cursor names, or `null` for a string that is not one. */
export function parseChatHistoryCursor(
  s: string
): { createdAt: Date; id: string } | null {
  const at = s.indexOf(SEPARATOR)
  if (at <= 0) return null
  const iso = s.slice(0, at)
  const id = s.slice(at + 1)
  if (!id) return null
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id }
}
