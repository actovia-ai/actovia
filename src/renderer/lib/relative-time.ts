/**
 * Ultra-compact relative time — "now", "5m", "2h", "3d", "2w", "6mo".
 * Used in the chat sidebar and under assistant replies. Computed at render
 * time; it doesn't tick on its own (fine for both call sites).
 */
export function compactRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

/**
 * The DB currently persists `createdAt` as the local wall-clock time but
 * serializes it with a trailing `Z` (so an ISO string at Beijing 17:59
 * comes back as `…T17:59…Z`). Plain `new Date()` then re-applies the
 * timezone offset and lands the chat 8h in the future, knocking it out
 * of the "Today" bucket and into "Last Week".
 *
 * We strip the trailing `Z` so `new Date()` parses the same wall-clock as
 * local time. When the storage-side bug is fixed (timestamps actually in
 * UTC), this helper becomes a no-op for proper-UTC strings — but until
 * then it keeps the sidebar's "Today" group accurate.
 */
export function parseLocalishCreatedAt(value: string | Date): Date {
  if (value instanceof Date) return value
  const stripped = typeof value === 'string' ? value.replace(/Z$/u, '') : value
  return new Date(stripped)
}
