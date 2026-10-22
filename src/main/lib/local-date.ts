/**
 * The day `d` falls on in the user's zone, as `YYYY-MM-DD` — what a per-day
 * bucket, a log file's name and the renderer's own day keys mean by "a day".
 * `toISOString().slice(0, 10)` is the UTC day instead, which moves the
 * boundary by the zone's offset: at 05:10 in Shanghai it is still yesterday.
 * The main process runs in the user's zone, so this is that zone's day.
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
