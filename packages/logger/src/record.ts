/** What `mapStack` does when none is given: nothing. */
const asIs = (stack: string) => stack

/** Who wrote a record: `service.name`, `process.pid`… (see `createResource`). */
export type LogResource = Readonly<Record<string, string | number>>

/** A stack mapped to source positions (`createSourceMapper`), or as it was. */
export type MapStack = (stack: string) => string

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord<R extends LogResource = LogResource> {
  timestamp: string
  severityNumber: number
  severityText: string
  body: string
  scope: { name: string }
  attributes: Record<string, unknown>
  resource: R
  traceId?: string
  originTraceId?: string
  spanId?: string // reserved — never populated this iteration
}

const SEVERITY: Record<
  LogLevel,
  { severityNumber: number; severityText: string }
> = {
  debug: { severityNumber: 5, severityText: 'DEBUG' },
  info: { severityNumber: 9, severityText: 'INFO' },
  warn: { severityNumber: 13, severityText: 'WARN' },
  error: { severityNumber: 17, severityText: 'ERROR' }
}

export const MIN_SEVERITY_DEV = SEVERITY.debug.severityNumber
export const MIN_SEVERITY_PROD = SEVERITY.info.severityNumber

export function severityOf(level: LogLevel) {
  return SEVERITY[level]
}

/**
 * A log call's detail as the record's attributes. Whatever is caught goes
 * under `error`, as it was caught — the Error itself, never `String(err)` or
 * `err.message`, which is where a stack is lost:
 *
 * - `exception.type` / `exception.message` — its name and message;
 * - `exception.stacktrace` — its stack, with the frames that point into a
 *   built file rewritten to the source line they came from, by `mapStack`
 *   (`createSourceMapper`);
 * - `exception.stacktrace_raw` — the stack as it was thrown, only when the
 *   line above differs from it.
 *
 * Anything that is not an Error has no stack to record: it becomes
 * `exception.message` through `String()`.
 */
export function toAttributes(
  detail?: Record<string, unknown> | null,
  mapStack: MapStack = asIs
): Record<string, unknown> {
  if (detail == null) return {}
  const { error, ...rest } = detail
  const attrs: Record<string, unknown> = { ...rest }
  if (error !== undefined) {
    if (error instanceof Error) {
      attrs['exception.type'] = error.name || 'Error'
      attrs['exception.message'] = error.message
      if (error.stack) {
        const mapped = mapStack(error.stack)
        attrs['exception.stacktrace'] = mapped
        if (mapped !== error.stack) {
          attrs['exception.stacktrace_raw'] = error.stack
        }
      }
    } else {
      attrs['exception.type'] = 'Error'
      attrs['exception.message'] = String(error)
    }
  }
  return attrs
}

// A V8 frame: `at name (location:line:column)`, `at location:line:column`,
// or one with no position — `at div (<anonymous>)`, `at Promise.all (index 0)`.
const FRAME_LINE = /^\s+at .*(?::\d+:\d+\)?|\))$/u

/**
 * Only the frames of what was caught — no name, no message — mapped like any
 * other stack. For a site that logs an error's name alone because its message
 * can quote what must not be written (an ORM may put a failed statement's
 * parameters in it): where it was thrown holds
 * function names and code positions and nothing else. Logged as
 * `'exception.stacktrace': stackFramesOf(error)`, beside the name.
 */
export function stackFramesOf(
  error: unknown,
  mapStack: MapStack = asIs
): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    return undefined
  }
  const { message } = error
  const stack = error.stack.trimEnd()
  // The stack opens with `name: message`. Past the message there are only
  // frames; when the message is not in it (replaced since), only the run of
  // frame-shaped lines the stack ends with is taken.
  const at = message ? stack.indexOf(message) : -1
  const lines = (at < 0 ? stack : stack.slice(at + message.length)).split('\n')
  let first = lines.length
  while (first > 0 && FRAME_LINE.test(lines[first - 1])) first--
  if (first === lines.length) return undefined
  return mapStack(lines.slice(first).join('\n'))
}

function isRecordObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Accepts a parsed JSONL line in the `LogRecord` shape. Returns `null` for
 * anything else so the reader can skip malformed lines.
 */
export function normalizeToLogRecord(raw: unknown): LogRecord | null {
  if (!isRecordObject(raw)) return null

  // Trust the required fields.
  if (
    typeof raw.timestamp === 'string' &&
    typeof raw.severityNumber === 'number' &&
    typeof raw.body === 'string' &&
    isRecordObject(raw.scope)
  ) {
    return raw as unknown as LogRecord
  }

  return null
}
