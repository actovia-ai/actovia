import { readdirSync, unlinkSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'

import { app } from 'electron'

import { localDateStr } from '../local-date'
import { getLogsDir } from '../paths'
import {
  type LogLevel,
  type LogRecord,
  MIN_SEVERITY_DEV,
  MIN_SEVERITY_PROD,
  normalizeToLogRecord,
  severityOf,
  toAttributes
} from './record'
import { getResource } from './resource'
import { maskLogText } from './secret-mask'
import { currentTrace } from './trace-context'

export type { LogLevel, LogRecord }
export { normalizeToLogRecord }

type KnownLogSurface =
  | 'app'
  | 'server'
  | 'migration'
  | 'chat'
  | 'database'
  | 'philharmonic'
  | 'mcp'
  | 'audio'
  | 'memory'
  | 'deep_research'
  | 'scheduler'
  | 's3'
  | 'skills'
  | 'lcm'
  | 'tools'
  | 'search'
  | 'jobs'
  | 'knowledge-base'
  | 'discover'
  | 'computer'

// Open union: known surfaces keep editor autocomplete, any string still
// type-checks — new subsystems no longer have to edit this list.
export type LogSurface = KnownLogSurface | (string & {})

const MIN_SEVERITY = app.isPackaged ? MIN_SEVERITY_PROD : MIN_SEVERITY_DEV
const RETENTION_DAYS = 7

// Log files are named by the user's local day (and cleaned up by it), as the
// renderer's day picker names them — see local-date.ts.
export { localDateStr }

function todayFileName(): string {
  return localDateStr() + '.jsonl'
}

function write(
  level: LogLevel,
  surface: LogSurface,
  message: string,
  detail?: Record<string, unknown> | null
) {
  const { severityNumber, severityText } = severityOf(level)
  if (severityNumber < MIN_SEVERITY) return

  let attributes: Record<string, unknown>
  let resource: LogRecord['resource']
  let traceId: string | undefined
  let originTraceId: string | undefined
  try {
    const ctx = currentTrace()
    traceId = ctx?.traceId
    originTraceId = ctx?.originTraceId
    attributes = toAttributes({ ...ctx?.attributes, ...detail })
    resource = getResource()
  } catch {
    // The logger must never throw into a caller — degrade the record instead.
    attributes = toAttributes(detail)
    resource = {} as LogRecord['resource']
  }

  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    severityNumber,
    severityText,
    body: message,
    scope: { name: surface },
    attributes,
    resource,
    ...(traceId ? { traceId } : {}),
    ...(originTraceId ? { originTraceId } : {})
  }

  // Known secret values are masked before the line is written (M4).
  let line: string
  try {
    line = maskLogText(JSON.stringify(record)) + '\n'
  } catch {
    line = JSON.stringify(record) + '\n'
  }
  // Fire-and-forget async write.
  appendFile(join(getLogsDir(), todayFileName()), line, 'utf-8').catch(() => {})

  // Also output to console for dev visibility.
  const consoleFn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log
  consoleFn(`[${severityText}] [${surface}] ${message}`, detail ?? '')
}

export function cleanupOldLogs() {
  const dir = getLogsDir()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const cutoffStr = localDateStr(cutoff)

  for (const file of readdirSync(dir)) {
    if (file.endsWith('.jsonl') && file.slice(0, 10) < cutoffStr) {
      unlinkSync(join(dir, file))
    }
  }
}

/**
 * `logger.<level>(surface, message, detail?)`.
 *
 * What was caught goes in `detail` under `error`, as it was caught —
 * `{ error: err }`, never `String(err)` or `err.message`: the Error is where
 * the stack is. It is written as `exception.type`, `exception.message` and
 * `exception.stacktrace` — the stack with the frames that point into a built
 * file mapped to `source:line:column` (`source-map.ts`) — plus
 * `exception.stacktrace_raw`, the stack as it was thrown, when mapping
 * changed it. Where the message must not be written (it can quote a failed
 * statement's parameters), log the name and
 * `'exception.stacktrace': stackFramesOf(error)` instead (`record.ts`).
 */
export const logger = {
  debug: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write('debug', surface, message, detail),
  info: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write('info', surface, message, detail),
  warn: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write('warn', surface, message, detail),
  error: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write('error', surface, message, detail)
}
