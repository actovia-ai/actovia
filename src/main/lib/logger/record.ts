import {
  type LogLevel,
  type LogRecord as PackageLogRecord,
  normalizeToLogRecord as packageNormalizeToLogRecord,
  stackFramesOf as packageStackFramesOf,
  toAttributes as packageToAttributes
} from '@actovia-ai/logger'

import type { Resource } from './resource'
import { mapStackTrace } from './source-map'

export {
  MIN_SEVERITY_DEV,
  MIN_SEVERITY_PROD,
  severityOf
} from '@actovia-ai/logger'
export type { LogLevel }

export type LogRecord = PackageLogRecord<
  Resource & Record<string, string | number>
>

/**
 * A log call's detail as the record's attributes (`@actovia-ai/logger`'s
 * `toAttributes`), stack frames mapped through the running build's source
 * maps (`source-map.ts`). Whatever is caught goes under `error`, as it was
 * caught — the Error itself, never `String(err)` or `err.message`.
 */
export function toAttributes(
  detail?: Record<string, unknown> | null
): Record<string, unknown> {
  return packageToAttributes(detail, mapStackTrace)
}

/**
 * Only the frames of what was caught, mapped — for a site that logs an
 * error's name alone because its message can quote what must not be written
 * (drizzle puts a failed statement's parameters in it: whole conversations,
 * keys). Logged as `'exception.stacktrace': stackFramesOf(error)`.
 */
export function stackFramesOf(error: unknown): string | undefined {
  return packageStackFramesOf(error, mapStackTrace)
}

/** A parsed JSONL line in the `LogRecord` shape, or null to skip it. */
export function normalizeToLogRecord(raw: unknown): LogRecord | null {
  return packageNormalizeToLogRecord(raw) as LogRecord | null
}
