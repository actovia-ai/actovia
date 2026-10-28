import {
  cleanupOldLogs as cleanupLogsIn,
  createLogger
} from '@actovia-ai/logger'
import { app } from 'electron'

import { localDateStr } from '../local-date'
import { getLogsDir } from '../paths'
import {
  type LogLevel,
  type LogRecord,
  MIN_SEVERITY_DEV,
  MIN_SEVERITY_PROD,
  normalizeToLogRecord
} from './record'
import { getResource } from './resource'
import { maskLogText } from './secret-mask'
import { mapStackTrace } from './source-map'

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

const RETENTION_DAYS = 7

// Log files are named by the user's local day (and cleaned up by it), as the
// renderer's day picker names them — see local-date.ts.
export { localDateStr }

// The writer is @actovia-ai/logger's: one OpenTelemetry-shaped record per
// line of `~/.actovia/logs/<local day>.jsonl`, with the ambient trace, known
// secret values masked before the line is written (M4), and stacks mapped
// through the running build's source maps.
const write = createLogger({
  dir: getLogsDir,
  minSeverity: app.isPackaged ? MIN_SEVERITY_PROD : MIN_SEVERITY_DEV,
  resource: getResource as () => LogRecord['resource'],
  mask: maskLogText,
  mapStack: mapStackTrace,
  fileName: () => localDateStr() + '.jsonl'
})

export function cleanupOldLogs() {
  cleanupLogsIn(getLogsDir(), RETENTION_DAYS)
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
  ) => write.debug(surface, message, detail),
  info: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write.info(surface, message, detail),
  warn: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write.warn(surface, message, detail),
  error: (
    surface: LogSurface,
    message: string,
    detail?: Record<string, unknown> | null
  ) => write.error(surface, message, detail)
}
