/**
 * The search box of Settings → Logger: words, quoted phrases, `-word` to
 * leave a line out, and two fields — `scope:` (a scope or every scope under
 * it: `scope:renderer` matches `renderer/route`) and `trace:` (a trace id or
 * its first characters, matched against `traceId` and `originTraceId`).
 *
 * Parsed by the logs route to filter, and by the page to highlight the words
 * in what it shows, so both read a query the same way.
 */
export interface LogQuery {
  /** Lower-cased words and phrases that must all appear. */
  terms: string[]
  /** Lower-cased words and phrases that must not appear. */
  excludes: string[]
  scope?: string
  trace?: string
}

const FIELDS = ['scope', 'trace'] as const
const FIELD_ONLY = /^(?:scope|trace):$/iu

// A token: an optional `-`, an optional `field:`, then a quoted phrase or a
// run of non-space characters.
const TOKEN = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/iuy

export function parseLogQuery(input: string | undefined): LogQuery {
  const query: LogQuery = { terms: [], excludes: [] }
  if (!input) return query
  for (let at = 0; at < input.length;) {
    if (/\s/u.test(input[at])) {
      at++
      continue
    }
    TOKEN.lastIndex = at
    const match = TOKEN.exec(input)
    if (!match) {
      at++
      continue
    }
    at = TOKEN.lastIndex
    const [, minus, field, phrase, word] = match
    const value = phrase ?? word ?? ''
    // `scope:` with nothing after it yet is a field being typed, not a word.
    if (!field && FIELD_ONLY.test(value)) continue
    const name = field?.toLowerCase()
    if (name && (FIELDS as readonly string[]).includes(name) && !minus) {
      if (value) query[name as (typeof FIELDS)[number]] = value
      continue
    }
    // An unknown `key:value` is searched for as it was typed.
    const text = (field ? `${field}:${value}` : value).toLowerCase()
    if (!text) continue
    if (minus) query.excludes.push(text)
    else query.terms.push(text)
  }
  return query
}

export interface LogQueryTarget {
  body: string
  scope: { name: string }
  attributes?: Record<string, unknown>
  traceId?: string
  originTraceId?: string
}

/** Whether a record answers a parsed query. Words are looked for in the
 *  message, the scope and the attributes. */
export function matchesLogQuery(
  record: LogQueryTarget,
  query: LogQuery
): boolean {
  if (query.scope) {
    const name = record.scope.name
    if (name !== query.scope && !name.startsWith(`${query.scope}/`)) {
      return false
    }
  }
  if (query.trace) {
    const ids = [record.traceId, record.originTraceId]
    if (!ids.some((id) => id?.startsWith(query.trace!))) return false
  }
  if (query.terms.length === 0 && query.excludes.length === 0) return true
  const haystack = [
    record.body,
    record.scope.name,
    record.attributes && Object.keys(record.attributes).length > 0
      ? JSON.stringify(record.attributes)
      : ''
  ]
    .join('\n')
    .toLowerCase()
  return (
    query.terms.every((term) => haystack.includes(term)) &&
    !query.excludes.some((term) => haystack.includes(term))
  )
}

// ─── Levels ─────────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type LogLevelName = (typeof LOG_LEVELS)[number]

/** A record's level by its OpenTelemetry severity number. */
export function levelOfSeverity(severityNumber: number): LogLevelName {
  if (severityNumber >= 17) return 'error'
  if (severityNumber >= 13) return 'warn'
  if (severityNumber >= 9) return 'info'
  return 'debug'
}

// ─── Histogram ──────────────────────────────────────────────────────────────

export interface LogHistogramBucket {
  /** ISO time the bucket starts at. */
  start: string
  error: number
  warn: number
  info: number
  debug: number
}

export interface LogHistogram {
  bucketMinutes: number
  buckets: LogHistogramBucket[]
}

/** Bucket sizes tried in order; the first that keeps the chart within
 *  `MAX_BUCKETS` bars is used. */
const BUCKET_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const
export const MAX_BUCKETS = 60

/**
 * Counts per level over time, from the first record to the last, in the
 * smallest bucket size that keeps it within `MAX_BUCKETS` bars. Buckets are
 * aligned to whole minutes of the local clock (an hour bucket starts on the
 * hour); empty buckets between two records are kept, so the gaps show.
 */
export function buildLogHistogram(
  records: { timestamp: string; severityNumber: number }[]
): LogHistogram {
  const times = records
    .map((r) => Date.parse(r.timestamp))
    .filter((t) => Number.isFinite(t))
  if (times.length === 0) return { bucketMinutes: 1, buckets: [] }
  let first = Infinity
  let last = -Infinity
  for (const t of times) {
    if (t < first) first = t
    if (t > last) last = t
  }
  const minuteMs = 60_000
  let bucketMinutes: number = BUCKET_MINUTES[BUCKET_MINUTES.length - 1]
  for (const size of BUCKET_MINUTES) {
    const ms = size * minuteMs
    const span = Math.floor(last / ms) - Math.floor(first / ms) + 1
    if (span <= MAX_BUCKETS) {
      bucketMinutes = size
      break
    }
  }
  const ms = bucketMinutes * minuteMs
  // Local alignment: shift by the zone offset so a 60-minute bucket starts
  // on the local hour, not the UTC one (they differ in half-hour zones).
  const offset = new Date(first).getTimezoneOffset() * minuteMs
  const indexOf = (t: number) => Math.floor((t - offset) / ms)
  const firstIndex = indexOf(first)
  const count = indexOf(last) - firstIndex + 1
  const buckets: LogHistogramBucket[] = Array.from(
    { length: count },
    (_, i) => ({
      start: new Date((firstIndex + i) * ms + offset).toISOString(),
      error: 0,
      warn: 0,
      info: 0,
      debug: 0
    })
  )
  for (const record of records) {
    const t = Date.parse(record.timestamp)
    if (!Number.isFinite(t)) continue
    buckets[indexOf(t) - firstIndex][levelOfSeverity(record.severityNumber)]++
  }
  return { bucketMinutes, buckets }
}
