import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { REPORTED_STACK_MAX_CHARS } from '@actovia/shared/constants/systems'
import { NotFoundError } from '@actovia/shared/errors/app-error'
import {
  buildLogHistogram,
  parseLogQuery
} from '@actovia/shared/utils/log-query'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  localDateStr,
  logger,
  type LogRecord,
  normalizeToLogRecord
} from '../../logger'
import { mapStackTrace } from '../../logger/source-map'
import { getLogsDir } from '../../paths'
import {
  filterRecords,
  levelsFromParam,
  minSeverityFromLevel
} from './logs-filter'

/** An ISO time (or epoch ms) query param → epoch ms; undefined when absent or unreadable. */
function timeParam(value: string | undefined): number | undefined {
  if (!value) return undefined
  const ms = /^\d+$/u.test(value) ? Number(value) : Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function parseLogFile(filePath: string): LogRecord[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8')
  const entries: LogRecord[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = normalizeToLogRecord(JSON.parse(line))
      if (record) entries.push(record)
    } catch {
      // skip malformed lines
    }
  }
  return entries
}

const logsRouter = new Hono()

// GET /api/v1/logs — query log entries
logsRouter.get('/', (c) => {
  const date = c.req.query('date') || localDateStr()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(
    500,
    Math.max(1, Number(c.req.query('pageSize')) || 100)
  )

  const records = parseLogFile(join(getLogsDir(), `${date}.jsonl`))
  const base = {
    minSeverity: minSeverityFromLevel(c.req.query('level')),
    // Query param stays `surface` for URL stability; it matches scope.name.
    scope: c.req.query('surface'),
    keyword: c.req.query('keyword'),
    traceId: c.req.query('traceId'),
    query: parseLogQuery(c.req.query('q'))
  }
  // The chart is drawn from every filter but the two it sets itself — the
  // levels (its legend) and the time window (a bar) — so it stays a map of
  // the day to pick from, not a picture of the pick.
  const histogram = buildLogHistogram(filterRecords(records, base))
  const entries = filterRecords(records, {
    ...base,
    levels: levelsFromParam(c.req.query('levels')),
    from: timeParam(c.req.query('from')),
    to: timeParam(c.req.query('to'))
  })

  // Newest first
  entries.reverse()

  const total = entries.length
  const start = (page - 1) * pageSize
  const paged = entries.slice(start, start + pageSize)

  return c.json({ entries: paged, total, page, histogram })
})

// GET /api/v1/logs/scopes — distinct scope names present in a day's file
logsRouter.get('/scopes', (c) => {
  const date = c.req.query('date') || localDateStr()
  const records = parseLogFile(join(getLogsDir(), `${date}.jsonl`))
  const scopes = [...new Set(records.map((r) => r.scope.name))].sort()
  return c.json({ scopes })
})

// GET /api/v1/logs/dates — list available log dates
logsRouter.get('/dates', (c) => {
  const dir = getLogsDir()
  if (!existsSync(dir)) return c.json({ dates: [] })

  const dates = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''))
    .sort()
    .reverse()

  return c.json({ dates })
})

// GET /api/v1/logs/export — download a day's log file
logsRouter.get('/export', (c) => {
  const date = c.req.query('date') || localDateStr()
  const filePath = join(getLogsDir(), `${date}.jsonl`)

  if (!existsSync(filePath)) {
    throw new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'Log file not found')
  }

  const content = readFileSync(filePath, 'utf-8')
  return new Response(content, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="${date}.jsonl"`
    }
  })
})

// What one report from a client may carry. A stack is the biggest item;
// anything past the cap is cut, not refused, so a real error still lands.
const MAX_MESSAGE_CHARS = 2000
const MAX_ATTRIBUTE_CHARS = 8000
const MAX_BATCH_REPORTS = 50

// Who filed the report: the renderer (default, unchanged wire shape for
// existing callers) or a paired actovia-ios device reporting its own local
// errors over the LAN listener. Becomes the scope prefix below.
const reportSchema = z.object({
  level: z.enum(['warn', 'error']),
  scope: z.string().min(1).max(64),
  message: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(['renderer', 'ios']).optional()
})

// A single report, or a small batch — the phone flushes a buffer after being
// offline, so it needs to send more than one report per request.
const requestSchema = z.union([
  reportSchema,
  z.object({ reports: z.array(reportSchema).min(1).max(MAX_BATCH_REPORTS) })
])

const clip = (value: unknown, max: number): unknown =>
  typeof value === 'string' && value.length > max
    ? `${value.slice(0, max - 1)}…`
    : value

// The attributes of a renderer report that hold a stack: the error's own,
// and React's component stack from an error boundary.
const STACK_ATTRIBUTES = ['stack', 'componentStack'] as const

/**
 * A renderer report's stacks, with the frames that point into the packaged
 * renderer's built files rewritten to their source positions (a dev build's
 * frames are `http://localhost:5173/src/…` already and stay). What was sent
 * is kept under `<name>_raw`, only when mapping changed it.
 */
function withMappedStacks(
  attributes: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const name of STACK_ATTRIBUTES) {
    const sent = attributes[name]
    if (typeof sent !== 'string') continue
    // Mapped before it is clipped to what an attribute is stored under: the
    // source positions are shorter than the URLs, so more frames are kept.
    const bounded = sent.slice(0, REPORTED_STACK_MAX_CHARS)
    const stack = mapStackTrace(bounded)
    if (stack === bounded) continue
    mapped[name] = stack
    mapped[`${name}_raw`] = sent
  }
  return { ...attributes, ...mapped }
}

// POST /api/v1/logs — an error a client caught: the renderer (an error
// boundary, a route error) or a paired actovia-ios device. Client errors
// otherwise live only on-device; this puts them in the same JSONL the Logger
// tab reads, under a `renderer/<scope>` or `ios/<scope>` surface, so a card
// that failed to render is diagnosable after the fact.
logsRouter.post('/', async (c) => {
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        type: 'error',
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid report' }
      },
      400
    )
  }
  const reports = 'reports' in parsed.data ? parsed.data.reports : [parsed.data]
  for (const {
    level,
    scope,
    message,
    attributes,
    source = 'renderer'
  } of reports) {
    const detail = attributes
      ? Object.fromEntries(
          Object.entries(
            source === 'renderer' ? withMappedStacks(attributes) : attributes
          ).map(([k, v]) => [k, clip(v, MAX_ATTRIBUTE_CHARS)])
        )
      : undefined
    logger[level](
      `${source}/${scope}`,
      clip(message, MAX_MESSAGE_CHARS) as string,
      detail
    )
  }
  return c.body(null, 204)
})

// DELETE /api/v1/logs — clear all logs
logsRouter.delete('/', (c) => {
  const dir = getLogsDir()
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.jsonl')) {
        unlinkSync(join(dir, file))
      }
    }
  }
  return c.json({ ok: true })
})

export default logsRouter
