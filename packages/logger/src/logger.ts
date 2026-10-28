import { readdirSync, unlinkSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'

import {
  type LogLevel,
  type LogRecord,
  type LogResource,
  type MapStack,
  MIN_SEVERITY_DEV,
  severityOf,
  toAttributes
} from './record'
import { currentTrace } from './trace-context'

/**
 * The day `d` falls on in this process's zone, as `YYYY-MM-DD` — what a log
 * file is named by. `toISOString().slice(0, 10)` is the UTC day instead,
 * which moves the boundary by the zone's offset.
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface LoggerOptions {
  /** The directory the `.jsonl` files go to, asked on every write. */
  dir: () => string
  /** Records under it are dropped. Default `MIN_SEVERITY_DEV` (everything). */
  minSeverity?: number
  /** Asked on every write; cache it. Default `{}`. */
  resource?: () => LogResource
  /** A line's text before it is written — mask the secrets you know. */
  mask?: (line: string) => string
  /** Stack frames mapped to source (`createSourceMapper().mapStackTrace`). */
  mapStack?: MapStack
  /** Default the local day, `YYYY-MM-DD.jsonl`. */
  fileName?: () => string
  /** Also print each record to the console. Default true. */
  console?: boolean
}

export type LogFn = (
  surface: string,
  message: string,
  detail?: Record<string, unknown> | null
) => void

export type Logger = Record<LogLevel, LogFn>

/**
 * `logger.<level>(surface, message, detail?)`: one `LogRecord` appended as a
 * line to today's file, fire and forget. The ambient trace (`withTrace`)
 * gives it `traceId`, `originTraceId` and the trace's attributes. It never
 * throws into its caller.
 *
 * What was caught goes in `detail` under `error`, as it was caught —
 * `{ error: err }`, never `String(err)`: see `toAttributes`.
 */
export function createLogger({
  dir,
  minSeverity = MIN_SEVERITY_DEV,
  resource = () => ({}),
  mask = (line) => line,
  mapStack,
  fileName = () => localDateStr() + '.jsonl',
  console: toConsole = true
}: LoggerOptions): Logger {
  function write(
    level: LogLevel,
    surface: string,
    message: string,
    detail?: Record<string, unknown> | null
  ) {
    const { severityNumber, severityText } = severityOf(level)
    if (severityNumber < minSeverity) return

    let attributes: Record<string, unknown>
    let res: LogResource
    let traceId: string | undefined
    let originTraceId: string | undefined
    try {
      const ctx = currentTrace()
      traceId = ctx?.traceId
      originTraceId = ctx?.originTraceId
      attributes = toAttributes({ ...ctx?.attributes, ...detail }, mapStack)
      res = resource()
    } catch {
      // The logger must never throw into a caller — degrade the record instead.
      attributes = toAttributes(detail)
      res = {}
    }

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      severityNumber,
      severityText,
      body: message,
      scope: { name: surface },
      attributes,
      resource: res,
      ...(traceId ? { traceId } : {}),
      ...(originTraceId ? { originTraceId } : {})
    }

    let line: string
    try {
      line = mask(JSON.stringify(record)) + '\n'
    } catch {
      line = JSON.stringify(record) + '\n'
    }
    try {
      appendFile(join(dir(), fileName()), line, 'utf-8').catch(() => {})
    } catch {
      // No directory to write to: the record is lost, the caller is not.
    }

    if (!toConsole) return
    const consoleFn =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : console.log
    consoleFn(`[${severityText}] [${surface}] ${message}`, detail ?? '')
  }

  return {
    debug: (surface, message, detail) =>
      write('debug', surface, message, detail),
    info: (surface, message, detail) => write('info', surface, message, detail),
    warn: (surface, message, detail) => write('warn', surface, message, detail),
    error: (surface, message, detail) =>
      write('error', surface, message, detail)
  }
}

/** Deletes the `YYYY-MM-DD*.jsonl` files in `dir` older than `days`. */
export function cleanupOldLogs(dir: string, days: number): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = localDateStr(cutoff)

  for (const file of readdirSync(dir)) {
    if (file.endsWith('.jsonl') && file.slice(0, 10) < cutoffStr) {
      unlinkSync(join(dir, file))
    }
  }
}
