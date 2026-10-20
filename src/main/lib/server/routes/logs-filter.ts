import {
  type LogLevelName,
  type LogQuery,
  levelOfSeverity,
  matchesLogQuery
} from '@actovia/shared/utils/log-query'

import type { LogRecord } from '../../logger'

const LEVEL_FLOOR: Record<string, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17
}

/** The `severityNumber` floor for a UI level name; 0 (match all) for unknown/absent. */
export function minSeverityFromLevel(level: string | undefined): number {
  return level ? (LEVEL_FLOOR[level] ?? 0) : 0
}

/**
 * `levels=error,warn` → the set of levels to keep; absent keeps every level.
 * A param naming no level (`levels=none`: every legend entry switched off)
 * keeps none.
 */
export function levelsFromParam(
  param: string | undefined
): Set<LogLevelName> | undefined {
  if (!param) return undefined
  return new Set(
    param.split(',').filter((l): l is LogLevelName => l in LEVEL_FLOOR)
  )
}

export interface LogFilterOptions {
  minSeverity?: number
  /** Exactly these levels (the chart's legend), unlike `minSeverity`. */
  levels?: Set<LogLevelName>
  scope?: string
  keyword?: string
  traceId?: string
  /** The search box, parsed (`parseLogQuery`). */
  query?: LogQuery
  /** A time window in epoch ms: `from` inclusive, `to` exclusive. */
  from?: number
  to?: number
}

export function filterRecords(
  records: LogRecord[],
  opts: LogFilterOptions
): LogRecord[] {
  const keyword = opts.keyword?.toLowerCase()
  const windowed = opts.from !== undefined || opts.to !== undefined
  return records.filter((r) => {
    if (opts.minSeverity && r.severityNumber < opts.minSeverity) return false
    if (opts.levels && !opts.levels.has(levelOfSeverity(r.severityNumber))) {
      return false
    }
    if (opts.scope && r.scope.name !== opts.scope) return false
    if (keyword && !r.body.toLowerCase().includes(keyword)) return false
    if (opts.traceId && r.traceId !== opts.traceId) return false
    if (windowed) {
      const t = Date.parse(r.timestamp)
      if (opts.from !== undefined && !(t >= opts.from)) return false
      if (opts.to !== undefined && !(t < opts.to)) return false
    }
    if (opts.query && !matchesLogQuery(r, opts.query)) return false
    return true
  })
}
