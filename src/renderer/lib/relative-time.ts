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
