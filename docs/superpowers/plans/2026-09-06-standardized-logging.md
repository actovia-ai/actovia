# Standardized Logging (OpenTelemetry-shaped) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Actovia's main-process logger to the OpenTelemetry log data model (no `@opentelemetry/*` dependency) and add flat per-unit-of-work trace IDs via `AsyncLocalStorage`, surfaced in the Logger settings tab.

**Architecture:** `src/main/lib/logger.ts` becomes a `src/main/lib/logger/` folder with four focused modules: `resource.ts` (process/app identity), `record.ts` (the `LogRecord` shape + severity/exception mapping + legacy normalization), `trace-context.ts` (the ALS store + `withTrace`), and `index.ts` (the `logger` API that stitches them together and writes JSONL). The public call signature `logger.<level>(surface, message, detail?)` is unchanged, so the ~105 existing call sites are untouched. `withTrace` wraps three entry points — the Hono `/api/*` middleware, the pgmq job worker, and the Philharmonic scheduler — and `enqueueJob` threads the originating `traceId` onto job payloads so async work links back to the turn that spawned it.

**Tech Stack:** TypeScript (`nodenext`), Electron 42 main process, Node `node:async_hooks` + `node:crypto`, Hono 4, PGlite/pgmq, Vitest 4, Playwright, React 19 + SWR (Logger tab).

**Spec:** `docs/superpowers/specs/2026-09-06-standardized-logging-design.md` — read it alongside this plan.

## Global Constraints

- **No new dependencies.** No `@opentelemetry/*`, no logging library. `node:*` built-ins only.
- **Call signature frozen.** `logger.debug|info|warn|error(surface, message, detail?)` stays exactly as-is. Do not touch the arguments at the ~105 call sites (the optional `bindTraceAttributes` cleanup in Task 9 adds lines, never changes existing `logger.*` calls).
- **Main process only.** No renderer logging, no IPC bridge, no `@opentelemetry/*` in the renderer bundle. `logger/` must never be imported from `src/renderer`.
- **`logger.ts` and `logger/index.ts` must never coexist** — the file is deleted in the same commit the folder is created (module-resolution ambiguity otherwise).
- **Logger never throws.** `write()` stays fire-and-forget; resource + trace lookups are wrapped so a failure degrades the record, never propagates.
- **ISO timestamps**, field name `timestamp` (not `ts`, not `timeUnixNano`).
- **Severity:** debug→`{severityNumber:5, severityText:"DEBUG"}`, info→`9/"INFO"`, warn→`13/"WARN"`, error→`17/"ERROR"`. Min-level gate: `is.dev ? 5 : 9`.
- **Trace/span ids:** `traceId` = 32 lowercase hex (`randomBytes(16).toString("hex")`). `session.id` = 16 lowercase hex (`randomBytes(8)`). `spanId` is a reserved field, never populated this iteration.
- **Test-ids are a durable contract.** New ids only; never rename. Every new id gets `data-testid` in source AND a Playwright reference (`test-ids.linkage.test.ts` enforces both).
- **Pre-commit gate:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. `--no-verify` is allowed ONLY for the CLAUDE.md-documented flaky PGlite WASM teardown (`RuntimeError: Aborted()` unhandled rejection from a DB-touching test file) — and only when all test _cases_ pass (`Tests N passed`, `Errors 1` is the teardown).
- Tests live under `tests/unit/` mirroring `src/`, import via `@main/...` alias, and mock `electron` (`vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))`) when the module under test transitively imports it.
- Commit on branch `dev`. Do not merge to `master`, do not push.

---

## File Structure

**New:**

| File                                                   | Responsibility                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/lib/logger/resource.ts`                      | `Resource` type + `getResource()` frozen lazy singleton (service/process/os identity + per-launch `session.id`). Imports `electron` for the version.                                                                                     |
| `src/main/lib/logger/record.ts`                        | `LogRecord` type; `LOG_LEVELS`/severity maps; `toAttributes(detail)` (exception-convention expansion); `normalizeToLogRecord(raw)` (accepts new- or old-shape lines, returns `null` for garbage). Pure — type-only import of `Resource`. |
| `src/main/lib/logger/trace-context.ts`                 | `AsyncLocalStorage<TraceContext>`; `newTraceId()`, `withTrace(fn, opts?)`, `currentTrace()`, `bindTraceAttributes(attrs)`. Pure — `node:async_hooks` + `node:crypto` only.                                                               |
| `src/main/lib/logger/index.ts`                         | The `logger` object, `write()`, level gate, console echo, `cleanupOldLogs()`, `localDateStr()`, `KnownLogSurface`/`LogSurface`, re-exports. (Replaces `src/main/lib/logger.ts`.)                                                         |
| `src/main/lib/server/middlewares/trace.ts`             | `traceMiddleware` — wraps every `/api/*` request in `withTrace`, sets `x-trace-id` response header.                                                                                                                                      |
| `tests/unit/main/lib/logger/resource.test.ts`          |                                                                                                                                                                                                                                          |
| `tests/unit/main/lib/logger/record.test.ts`            |                                                                                                                                                                                                                                          |
| `tests/unit/main/lib/logger/trace-context.test.ts`     |                                                                                                                                                                                                                                          |
| `tests/unit/main/lib/logger/index.test.ts`             |                                                                                                                                                                                                                                          |
| `tests/unit/main/lib/server/middlewares/trace.test.ts` |                                                                                                                                                                                                                                          |
| `tests/e2e/settings-logger.spec.ts`                    |                                                                                                                                                                                                                                          |

**Modified:** `src/main/lib/logger.ts` (deleted), `src/main/lib/server/middlewares/index.ts`, `src/main/lib/server/app.ts`, `src/main/lib/server/routes/logs.ts`, `src/main/lib/jobs/queries.ts`, `src/main/lib/jobs/worker.ts`, `src/main/lib/ai/philharmonic/scheduler.ts`, `src/renderer/components/settings/settings-form/logger.tsx`, `src/shared/constants/test-ids.ts`, `CLAUDE.md`. Optionally (Task 9): `src/main/lib/server/routes/chat.ts`, `src/main/lib/server/routes/deep-research.ts`.

---

## Task 1: Resource module

**Files:**

- Create: `src/main/lib/logger/resource.ts`
- Test: `tests/unit/main/lib/logger/resource.test.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces:
  - `interface Resource { 'service.name': 'actovia'; 'service.version': string; 'process.pid': number; 'process.runtime.name': 'electron'; 'os.type': string; 'os.version': string; 'session.id': string }`
  - `function getResource(): Resource` — frozen, memoized after first call.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/logger/resource.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' } }))

const { getResource } = await import('@main/lib/logger/resource')

describe('getResource', () => {
  it('returns the OTel resource fields', () => {
    const r = getResource()
    expect(r['service.name']).toBe('actovia')
    expect(r['service.version']).toBe('9.9.9')
    expect(r['process.runtime.name']).toBe('electron')
    expect(typeof r['process.pid']).toBe('number')
    expect(typeof r['os.type']).toBe('string')
    expect(typeof r['os.version']).toBe('string')
    expect(r['session.id']).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is a stable frozen singleton', () => {
    const a = getResource()
    const b = getResource()
    expect(a).toBe(b)
    expect(Object.isFrozen(a)).toBe(true)
    expect(a['session.id']).toBe(b['session.id'])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run tests/unit/main/lib/logger/resource.test.ts`
Expected: FAIL — `Cannot find module '@main/lib/logger/resource'`.

- [ ] **Step 3: Implement**

`src/main/lib/logger/resource.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { release, type } from 'node:os'

import { app } from 'electron'

export interface Resource {
  'service.name': 'actovia'
  'service.version': string
  'process.pid': number
  'process.runtime.name': 'electron'
  'os.type': string
  'os.version': string
  'session.id': string
}

// One id per app launch — distinguishes runs within a single day's log file
// (crash → relaunch appends to the same YYYY-MM-DD.jsonl).
const SESSION_ID = randomBytes(8).toString('hex')

let cached: Resource | null = null

function resolveVersion(): string {
  try {
    const v = app.getVersion()
    if (typeof v === 'string' && v.length > 0) return v
  } catch {
    // Not a ready Electron main process (unit tests) — fall through.
  }
  return '0.0.0'
}

export function getResource(): Resource {
  if (cached) return cached
  cached = Object.freeze({
    'service.name': 'actovia',
    'service.version': resolveVersion(),
    'process.pid': process.pid,
    'process.runtime.name': 'electron',
    'os.type': type(),
    'os.version': release(),
    'session.id': SESSION_ID
  })
  return cached
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run tests/unit/main/lib/logger/resource.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Gate + commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green (or `Errors 1` = the known flaky PGlite teardown with every test case passing).

```bash
git add src/main/lib/logger/resource.ts tests/unit/main/lib/logger/resource.test.ts
git commit -m "feat(logger): OTel Resource module"
```

---

## Task 2: Record module

**Files:**

- Create: `src/main/lib/logger/record.ts`
- Test: `tests/unit/main/lib/logger/record.test.ts`

**Interfaces:**

- Consumes: `import type { Resource } from './resource'`.
- Produces:
  - `type LogLevel = 'debug' | 'info' | 'warn' | 'error'`
  - `interface LogRecord { timestamp: string; severityNumber: number; severityText: string; body: string; scope: { name: string }; attributes: Record<string, unknown>; resource: Resource; traceId?: string; originTraceId?: string; spanId?: string }`
  - `function severityOf(level: LogLevel): { severityNumber: number; severityText: string }`
  - `const MIN_SEVERITY_DEV = 5`, `const MIN_SEVERITY_PROD = 9`
  - `function toAttributes(detail?: Record<string, unknown> | null): Record<string, unknown>` — copies `detail`, and if it has an `error` key (Error or string) removes it and adds `exception.type` / `exception.message` / `exception.stacktrace`.
  - `function normalizeToLogRecord(raw: unknown): LogRecord | null` — passes a new-shape object through; maps an old-shape `{ts,level,surface,message,detail}` object; returns `null` otherwise.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/logger/record.test.ts`:

```ts
import {
  normalizeToLogRecord,
  severityOf,
  toAttributes
} from '@main/lib/logger/record'
import { describe, expect, it } from 'vitest'

describe('severityOf', () => {
  it('maps levels to OTel bands', () => {
    expect(severityOf('debug')).toEqual({
      severityNumber: 5,
      severityText: 'DEBUG'
    })
    expect(severityOf('info')).toEqual({
      severityNumber: 9,
      severityText: 'INFO'
    })
    expect(severityOf('warn')).toEqual({
      severityNumber: 13,
      severityText: 'WARN'
    })
    expect(severityOf('error')).toEqual({
      severityNumber: 17,
      severityText: 'ERROR'
    })
  })
})

describe('toAttributes', () => {
  it('returns {} for nullish detail', () => {
    expect(toAttributes()).toEqual({})
    expect(toAttributes(null)).toEqual({})
  })

  it('passes non-error keys through untouched', () => {
    expect(toAttributes({ chatId: 'c1', count: 3 })).toEqual({
      chatId: 'c1',
      count: 3
    })
  })

  it('expands an Error into exception.* conventions', () => {
    const err = new TypeError('boom')
    const attrs = toAttributes({ error: err, chatId: 'c1' })
    expect(attrs).not.toHaveProperty('error')
    expect(attrs['exception.type']).toBe('TypeError')
    expect(attrs['exception.message']).toBe('boom')
    expect(typeof attrs['exception.stacktrace']).toBe('string')
    expect(attrs.chatId).toBe('c1')
  })

  it('expands a string error with no stacktrace', () => {
    const attrs = toAttributes({ error: 'nope' })
    expect(attrs['exception.type']).toBe('Error')
    expect(attrs['exception.message']).toBe('nope')
    expect(attrs).not.toHaveProperty('exception.stacktrace')
  })
})

describe('normalizeToLogRecord', () => {
  it('passes a new-shape record through', () => {
    const rec = {
      timestamp: '2026-09-06T00:00:00.000Z',
      severityNumber: 17,
      severityText: 'ERROR',
      body: 'x',
      scope: { name: 'chat' },
      attributes: {},
      resource: {}
    }
    expect(normalizeToLogRecord(rec)).toEqual(rec)
  })

  it('maps a legacy line', () => {
    const out = normalizeToLogRecord({
      ts: '2026-09-05T10:00:00.000Z',
      level: 'warn',
      surface: 'jobs',
      message: 'old style',
      detail: { msgId: 7 }
    })
    expect(out).toMatchObject({
      timestamp: '2026-09-05T10:00:00.000Z',
      severityNumber: 13,
      severityText: 'WARN',
      body: 'old style',
      scope: { name: 'jobs' },
      attributes: { msgId: 7 }
    })
  })

  it('returns null for garbage', () => {
    expect(normalizeToLogRecord('nope')).toBeNull()
    expect(normalizeToLogRecord({ random: 1 })).toBeNull()
    expect(normalizeToLogRecord(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run tests/unit/main/lib/logger/record.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/lib/logger/record.ts`:

```ts
import type { Resource } from './resource'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
  timestamp: string
  severityNumber: number
  severityText: string
  body: string
  scope: { name: string }
  attributes: Record<string, unknown>
  resource: Resource
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

const LEGACY_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

export function toAttributes(
  detail?: Record<string, unknown> | null
): Record<string, unknown> {
  if (detail == null) return {}
  const { error, ...rest } = detail
  const attrs: Record<string, unknown> = { ...rest }
  if (error !== undefined) {
    if (error instanceof Error) {
      attrs['exception.type'] = error.name || 'Error'
      attrs['exception.message'] = error.message
      if (error.stack) attrs['exception.stacktrace'] = error.stack
    } else {
      attrs['exception.type'] = 'Error'
      attrs['exception.message'] = String(error)
    }
  }
  return attrs
}

function isRecordObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function normalizeToLogRecord(raw: unknown): LogRecord | null {
  if (!isRecordObject(raw)) return null

  // New shape — trust the required fields.
  if (
    typeof raw.timestamp === 'string' &&
    typeof raw.severityNumber === 'number' &&
    typeof raw.body === 'string' &&
    isRecordObject(raw.scope)
  ) {
    return raw as unknown as LogRecord
  }

  // Legacy shape { ts, level, surface, message, detail }.
  if (
    typeof raw.ts === 'string' &&
    typeof raw.level === 'string' &&
    LEGACY_LEVELS.has(raw.level) &&
    typeof raw.surface === 'string' &&
    typeof raw.message === 'string'
  ) {
    const sev = SEVERITY[raw.level as LogLevel]
    return {
      timestamp: raw.ts,
      severityNumber: sev.severityNumber,
      severityText: sev.severityText,
      body: raw.message,
      scope: { name: raw.surface },
      attributes: isRecordObject(raw.detail) ? raw.detail : {},
      resource: {} as Resource
    }
  }

  return null
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run tests/unit/main/lib/logger/record.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add src/main/lib/logger/record.ts tests/unit/main/lib/logger/record.test.ts
git commit -m "feat(logger): LogRecord shape + severity/exception/legacy mapping"
```

---

## Task 3: Trace-context module

**Files:**

- Create: `src/main/lib/logger/trace-context.ts`
- Test: `tests/unit/main/lib/logger/trace-context.test.ts`

**Interfaces:**

- Consumes: `node:async_hooks`, `node:crypto` only. **No import of `./index` or `./record`** (keeps it dependency-free and its test electron-mock-free).
- Produces:
  - `interface TraceContext { traceId: string; originTraceId?: string; attributes: Record<string, unknown> }`
  - `function newTraceId(): string` — 32 lowercase hex.
  - `function withTrace<T>(fn: () => T, opts?: { originTraceId?: string; attributes?: Record<string, unknown> }): T`
  - `function currentTrace(): TraceContext | undefined`
  - `function bindTraceAttributes(attrs: Record<string, unknown>): void` — merges into the ambient context; no-op outside a trace.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/logger/trace-context.test.ts`:

```ts
import {
  bindTraceAttributes,
  currentTrace,
  newTraceId,
  withTrace
} from '@main/lib/logger/trace-context'
import { describe, expect, it } from 'vitest'

describe('trace-context', () => {
  it('newTraceId is 32 lowercase hex', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('currentTrace is undefined outside withTrace', () => {
    expect(currentTrace()).toBeUndefined()
  })

  it('withTrace establishes a fresh id', () => {
    const seen: string[] = []
    withTrace(() => seen.push(currentTrace()!.traceId))
    withTrace(() => seen.push(currentTrace()!.traceId))
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('nested withTrace shadows with a new id, restores on exit', () => {
    withTrace(() => {
      const outer = currentTrace()!.traceId
      withTrace(() => {
        expect(currentTrace()!.traceId).not.toBe(outer)
      })
      expect(currentTrace()!.traceId).toBe(outer)
    })
  })

  it('carries originTraceId and seed attributes', () => {
    withTrace(
      () => {
        expect(currentTrace()!.originTraceId).toBe('abc')
        expect(currentTrace()!.attributes).toEqual({ queueName: 'kb-sync' })
      },
      { originTraceId: 'abc', attributes: { queueName: 'kb-sync' } }
    )
  })

  it('bindTraceAttributes merges; no-op outside a trace', () => {
    expect(() => bindTraceAttributes({ x: 1 })).not.toThrow()
    withTrace(() => {
      bindTraceAttributes({ chatId: 'c1' })
      bindTraceAttributes({ step: 2 })
      expect(currentTrace()!.attributes).toEqual({ chatId: 'c1', step: 2 })
    })
  })

  it('survives an await boundary', async () => {
    await withTrace(async () => {
      const id = currentTrace()!.traceId
      await new Promise((r) => setTimeout(r, 1))
      expect(currentTrace()!.traceId).toBe(id)
    })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run tests/unit/main/lib/logger/trace-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/lib/logger/trace-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

export interface TraceContext {
  traceId: string
  originTraceId?: string
  attributes: Record<string, unknown>
}

const als = new AsyncLocalStorage<TraceContext>()

export function newTraceId(): string {
  return randomBytes(16).toString('hex')
}

export function withTrace<T>(
  fn: () => T,
  opts?: { originTraceId?: string; attributes?: Record<string, unknown> }
): T {
  const ctx: TraceContext = {
    traceId: newTraceId(),
    originTraceId: opts?.originTraceId,
    attributes: { ...(opts?.attributes ?? {}) }
  }
  return als.run(ctx, fn)
}

export function currentTrace(): TraceContext | undefined {
  return als.getStore()
}

export function bindTraceAttributes(attrs: Record<string, unknown>): void {
  const ctx = als.getStore()
  if (ctx) Object.assign(ctx.attributes, attrs)
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run tests/unit/main/lib/logger/trace-context.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Gate + commit**

```bash
git add src/main/lib/logger/trace-context.ts tests/unit/main/lib/logger/trace-context.test.ts
git commit -m "feat(logger): AsyncLocalStorage trace context"
```

---

## Task 4: Logger folder — wire it together, delete `logger.ts`

This is the integration task. `src/main/lib/logger.ts` → `src/main/lib/logger/index.ts` in one commit. All ~40 `import { logger } from '.../logger'` sites keep resolving (now to the folder). `LogSurface` widens.

**Files:**

- Create: `src/main/lib/logger/index.ts`
- Delete: `src/main/lib/logger.ts`
- Create: `tests/unit/main/lib/logger/index.test.ts`
- Reference only (do not edit): every file that imports `logger`.

**Interfaces:**

- Consumes: `./resource` (`getResource`), `./record` (`LogRecord`, `LogLevel`, `severityOf`, `toAttributes`, `normalizeToLogRecord`, `MIN_SEVERITY_DEV`, `MIN_SEVERITY_PROD`), `./trace-context` (`currentTrace`), `./paths` → wait, it is `../paths` (`getLogsDir`), `@electron-toolkit/utils` (`is`).
- Produces (public API — unchanged names where they already exist):
  - `type KnownLogSurface` (the current 20 literals) and `type LogSurface = KnownLogSurface | (string & {})`
  - `const logger: { debug|info|warn|error: (surface: LogSurface, message: string, detail?: Record<string, unknown> | null) => void }`
  - `function localDateStr(d?: Date): string` (unchanged from today)
  - `function cleanupOldLogs(): void` (unchanged from today)
  - re-exports: `type LogLevel`, `type LogRecord`, `normalizeToLogRecord`
- **Removed from the public surface:** `LogEntry` (renamed `LogRecord`), `LogSurface` as a closed union (now open). `src/main/lib/server/routes/logs.ts` is the only external consumer of `LogEntry`/`LogLevel` and is rewritten in Task 7 — until then it will not typecheck, so **Task 4's commit updates `logs.ts`'s import line only** to keep the gate green (see Step 4).

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/logger/index.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', getPath: () => '/tmp' }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

const appendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('node:fs/promises', () => ({
  appendFile: (...a: unknown[]) => appendMock(...a)
}))
vi.mock('fs/promises', () => ({
  appendFile: (...a: unknown[]) => appendMock(...a)
}))

const { logger } = await import('@main/lib/logger')
const { withTrace } = await import('@main/lib/logger/trace-context')

function lastRecord() {
  const call = appendMock.mock.calls.at(-1)!
  return JSON.parse((call[1] as string).trim())
}

describe('logger.write', () => {
  beforeEach(() => appendMock.mockClear())

  it('emits an OTel-shaped record', () => {
    logger.info('chat', 'hello', { chatId: 'c1' })
    const r = lastRecord()
    expect(r.severityNumber).toBe(9)
    expect(r.severityText).toBe('INFO')
    expect(r.body).toBe('hello')
    expect(r.scope).toEqual({ name: 'chat' })
    expect(r.attributes).toEqual({ chatId: 'c1' })
    expect(r.resource['service.name']).toBe('actovia')
    expect(r.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(r.traceId).toBeUndefined()
  })

  it('expands errors and stamps the trace id when inside withTrace', () => {
    withTrace(() => logger.error('jobs', 'kaboom', { error: new Error('x') }))
    const r = lastRecord()
    expect(r.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(r.attributes['exception.type']).toBe('Error')
  })

  it('merges ambient trace attributes under the call detail', () => {
    withTrace(
      () => {
        logger.info('chat', 'a', { chatId: 'call-wins' })
      },
      { attributes: { chatId: 'ambient', region: 'eu' } }
    )
    const r = lastRecord()
    expect(r.attributes.chatId).toBe('call-wins')
    expect(r.attributes.region).toBe('eu')
  })

  it('drops debug in prod, keeps it in dev', async () => {
    // is.dev is mocked true here → debug passes
    logger.debug('app', 'dev debug')
    expect(appendMock).toHaveBeenCalled()
  })

  it('accepts an unregistered surface string', () => {
    logger.info('brand-new-surface', 'ok')
    expect(lastRecord().scope.name).toBe('brand-new-surface')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run tests/unit/main/lib/logger/index.test.ts`
Expected: FAIL — `@main/lib/logger` still resolves to the old `logger.ts` whose records have `ts`/`level`/`surface`/`message`, so the shape assertions fail (or module resolves to the folder once created).

- [ ] **Step 3: Create `src/main/lib/logger/index.ts`**

Start from the current `src/main/lib/logger.ts` and transform. Full file:

```ts
import { readdirSync, unlinkSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'

import { is } from '@electron-toolkit/utils'

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

// Open union: known surfaces keep autocomplete, any string still type-checks.
export type LogSurface = KnownLogSurface | (string & {})

const MIN_SEVERITY = is.dev ? MIN_SEVERITY_DEV : MIN_SEVERITY_PROD
const RETENTION_DAYS = 7

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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

  const ctx = currentTrace()
  const attributes = toAttributes({
    ...(ctx?.attributes ?? {}),
    ...(detail ?? {})
  })

  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    severityNumber,
    severityText,
    body: message,
    scope: { name: surface },
    attributes,
    resource: getResource(),
    ...(ctx?.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx?.originTraceId ? { originTraceId: ctx.originTraceId } : {})
  }

  const line = JSON.stringify(record) + '\n'
  appendFile(join(getLogsDir(), todayFileName()), line, 'utf-8').catch(() => {})

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
```

Note: `toAttributes` is applied to the merged `{...ambient, ...detail}` so an `error` key in _either_ is expanded, and explicit `detail` keys win over ambient on collision.

- [ ] **Step 4: Delete the old file + fix the one now-broken import**

```bash
git rm src/main/lib/logger.ts
```

`src/main/lib/server/routes/logs.ts` line 6 currently imports `{ localDateStr, type LogEntry, type LogLevel }`. Change **only that import** to keep the gate green (the route body is rewritten in Task 7):

```ts
import { localDateStr, type LogRecord } from '../../logger'
```

Then inside `logs.ts`, replace the local `LEVEL_PRIORITY: Record<LogLevel, number>` map + its uses with a temporary shim so it still compiles: change the `parseLogFile` return type to `LogRecord[]`, map each parsed line through `normalizeToLogRecord` (import it), drop the `LogLevel` references, and for now filter on `e.severityText.toLowerCase()` / `e.body` / `e.scope.name`. Keep it minimal — Task 7 does the real rewrite. If a clean minimal shim is not obviously achievable in ~15 lines, instead **merge Task 7 into this task** (do the full `logs.ts` rewrite now) rather than leave broken types.

- [ ] **Step 5: Run the full unit suite** (import graph changed for ~40 files)

Run: `pnpm test`
Expected: `Test Files` all pass, `Tests N passed` with the pre-existing count + the new logger tests. Investigate any _new_ failure. `Errors 1` (PGlite teardown) is acceptable.

- [ ] **Step 6: Typecheck both projects**

Run: `pnpm typecheck`
Expected: clean. If `logs.ts` still complains, finish its rewrite here (see Step 4 fallback).

- [ ] **Step 7: Gate + commit**

```bash
git add -A
git commit -m "feat(logger): OTel-shaped records + trace ids; logger.ts -> logger/"
```

---

## Task 5: HTTP request trace middleware

**Files:**

- Create: `src/main/lib/server/middlewares/trace.ts`
- Modify: `src/main/lib/server/middlewares/index.ts` (add `export * from './trace'`)
- Modify: `src/main/lib/server/app.ts` (register before the settings middleware)
- Test: `tests/unit/main/lib/server/middlewares/trace.test.ts`

**Interfaces:**

- Consumes: `withTrace`, `currentTrace` from `@main/lib/logger/trace-context`; `hono` types.
- Produces: `function traceMiddleware(c: Context, next: Next): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/server/middlewares/trace.test.ts`:

```ts
import { currentTrace } from '@main/lib/logger/trace-context'
import { traceMiddleware } from '@main/lib/server/middlewares/trace'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

describe('traceMiddleware', () => {
  it('runs the handler inside a trace and sets x-trace-id', async () => {
    const app = new Hono()
    app.use('*', traceMiddleware)
    let seen: string | undefined
    app.get('/x', (c) => {
      seen = currentTrace()?.traceId
      return c.text('ok')
    })
    const res = await app.request('/x')
    expect(res.status).toBe(200)
    expect(seen).toMatch(/^[0-9a-f]{32}$/)
    expect(res.headers.get('x-trace-id')).toBe(seen)
  })

  it('gives distinct ids to distinct requests', async () => {
    const app = new Hono()
    app.use('*', traceMiddleware)
    app.get('/x', (c) => c.text(currentTrace()!.traceId))
    const a = await (await app.request('/x')).text()
    const b = await (await app.request('/x')).text()
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run tests/unit/main/lib/server/middlewares/trace.test.ts` → module not found.

- [ ] **Step 3: Implement**

`src/main/lib/server/middlewares/trace.ts`:

```ts
import type { Context, Next } from 'hono'

import { currentTrace, withTrace } from '../../logger/trace-context'

/**
 * Wraps every `/api/*` request in a trace so any `logger.*` call made while
 * handling it — however deep in `agentLoop`, tools, DB, or synchronous job
 * kicks — carries the same `traceId`. The id is echoed as `x-trace-id` for
 * renderer-side correlation.
 */
export async function traceMiddleware(c: Context, next: Next): Promise<void> {
  await withTrace(async () => {
    const id = currentTrace()?.traceId
    if (id) c.header('x-trace-id', id)
    await next()
  })
}
```

- [ ] **Step 4: Register in `app.ts`**

In `src/main/lib/server/app.ts`, add the import and place the middleware immediately after `app.use('/api/*', lockGate)` and **before** the `app.use('/api/*', async (c, next) => { ... getSettings ... })` block:

```ts
import { errorHandler, lockGate, traceMiddleware } from './middlewares'
// ...
app.use('/api/*', lockGate)
app.use('/api/*', traceMiddleware)
app.use('/api/*', async (c, next) => {
  const settings = await getSettings()
  c.set('settings', settings)
  await next()
})
```

Add `export * from './trace'` to `src/main/lib/server/middlewares/index.ts`.

- [ ] **Step 5: Run, verify pass** — the trace test (2) + `pnpm test`.

- [ ] **Step 6: Gate + commit**

```bash
git add src/main/lib/server/middlewares/trace.ts src/main/lib/server/middlewares/index.ts src/main/lib/server/app.ts tests/unit/main/lib/server/middlewares/trace.test.ts
git commit -m "feat(logger): trace every /api request"
```

---

## Task 6: Trace the job worker + scheduler; thread origin trace id

**Files:**

- Modify: `src/main/lib/jobs/queries.ts` (`enqueueJob`)
- Modify: `src/main/lib/jobs/worker.ts` (`processQueue` + new `extractOriginTraceId`)
- Modify: `src/main/lib/ai/philharmonic/scheduler.ts` (`runScheduledRound`, one-off task body)
- Test: extend `tests/unit/main/lib/jobs/worker.test.ts`; add cases to a queries test (create `tests/unit/main/lib/jobs/queries.test.ts` if absent — check first).

**Interfaces:**

- Consumes: `withTrace`, `currentTrace` from `@main/lib/logger/trace-context`.
- Produces: `function extractOriginTraceId(payload: unknown): string | undefined` (exported from `worker.ts` for testing).

- [ ] **Step 1: Write the failing tests**

Add to the jobs tests (adjust import paths to match the existing file's style — it mocks `electron` and `@main/lib/db/db`):

```ts
// queries: enqueueJob stamps __originTraceId only when a trace is active
import { withTrace } from '@main/lib/logger/trace-context'

it('stamps __originTraceId when enqueued inside a trace', async () => {
  const sends: string[] = []
  // ...mock db.execute to capture the JSON payload string...
  await withTrace(async () => {
    await enqueueJob('kb-sync', { op: 'delete', lightragDocId: 'd1' })
  })
  const payload = JSON.parse(/* captured */)
  expect(payload.__originTraceId).toMatch(/^[0-9a-f]{32}$/)
})

it('does not stamp when no trace is active', async () => {
  await enqueueJob('kb-sync', { op: 'delete', lightragDocId: 'd1' })
  expect(JSON.parse(/* captured */)).not.toHaveProperty('__originTraceId')
})
```

```ts
// worker: extractOriginTraceId
import { extractOriginTraceId } from '@main/lib/jobs/worker'

it('extractOriginTraceId reads the sibling field', () => {
  expect(extractOriginTraceId({ a: 1, __originTraceId: 'abc' })).toBe('abc')
  expect(extractOriginTraceId({ a: 1 })).toBeUndefined()
  expect(extractOriginTraceId('nope')).toBeUndefined()
  expect(extractOriginTraceId({ __originTraceId: 42 })).toBe('42')
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement — `queries.ts`**

In `enqueueJob`, before the `pgmq.send` call:

```ts
import { currentTrace } from '../logger/trace-context'

export async function enqueueJob(queueName: QueueName, payload: unknown) {
  const traceId = currentTrace()?.traceId
  const withOrigin =
    traceId && payload !== null && typeof payload === 'object'
      ? { ...(payload as Record<string, unknown>), __originTraceId: traceId }
      : payload
  await db.execute(
    sql`SELECT * FROM pgmq.send(${queueName}, ${JSON.stringify(withOrigin)}::jsonb)`
  )
}
```

(Match the exact current signature/return of `enqueueJob` — only add the trace stamping.)

- [ ] **Step 4: Implement — `worker.ts`**

```ts
import { withTrace } from '../logger/trace-context'

export function extractOriginTraceId(payload: unknown): string | undefined {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    '__originTraceId' in payload
  ) {
    return String((payload as Record<string, unknown>).__originTraceId)
  }
  return undefined
}
```

In `processQueue`, wrap the handler call:

```ts
for (const msg of messages) {
  try {
    await withTrace(
      async () => {
        logger.debug('jobs', 'processing', { queueName, msgId: msg.msgId })
        await handlers[queueName](msg.message)
      },
      { originTraceId: extractOriginTraceId(msg.message) }
    )
    await archiveMessage(queueName, msg.msgId)
  } catch (error) {
    // ...unchanged...
  }
}
```

The `catch` block's `logger.error` calls now run outside the trace (the throw unwinds `withTrace`). That is fine — acceptable per spec §3. If you want the failure line traced, move the `try/catch` inside the `withTrace` callback and re-throw; keep it simple unless trivial.

- [ ] **Step 5: Implement — `scheduler.ts`**

Wrap the body of `runScheduledRound(...)` and the per-task work inside `runDueOneOffTasks(...)` in `withTrace(async () => { ...existing... })`. These have no origin. Example for `runScheduledRound`:

```ts
import { withTrace } from '../../logger/trace-context'

export async function runScheduledRound(taskId: string, emit: SseEmitter) {
  return withTrace(async () => {
    // ...existing body...
  })
}
```

- [ ] **Step 6: Run, verify pass** — jobs tests + `pnpm test`.

- [ ] **Step 7: Gate + commit**

```bash
git add src/main/lib/jobs/queries.ts src/main/lib/jobs/worker.ts src/main/lib/ai/philharmonic/scheduler.ts tests/unit/main/lib/jobs/
git commit -m "feat(logger): trace jobs + scheduler; thread origin trace id through the queue"
```

---

## Task 7: `/api/logs` route — new filters + `/scopes`

**Files:**

- Modify: `src/main/lib/server/routes/logs.ts`
- Test: create `tests/unit/main/lib/server/routes/logs.test.ts` (unit-test the pure filter/parse helpers — extract them if needed) OR extend `tests/api/logs.spec.ts` if it exists (check).

**Interfaces:**

- Consumes: `normalizeToLogRecord`, `type LogRecord` from `@main/lib/logger`.
- Produces: unchanged route surface + `GET /api/logs/scopes`.

- [ ] **Step 1: Write the failing test**

Extract the filtering into a pure helper `filterRecords(records: LogRecord[], opts: { minSeverity?: number; scope?: string; keyword?: string; traceId?: string }): LogRecord[]` and test it directly:

```ts
import {
  filterRecords,
  minSeverityFromLevel
} from '@main/lib/server/routes/logs-filter'
import { describe, expect, it } from 'vitest'

const rec = (over: Partial<any> = {}) => ({
  timestamp: '2026-09-06T00:00:00.000Z',
  severityNumber: 9,
  severityText: 'INFO',
  body: 'hello world',
  scope: { name: 'chat' },
  attributes: {},
  resource: {},
  ...over
})

describe('filterRecords', () => {
  it('filters by minimum severity', () => {
    const out = filterRecords(
      [rec({ severityNumber: 9 }), rec({ severityNumber: 17 })],
      {
        minSeverity: minSeverityFromLevel('warn')
      }
    )
    expect(out).toHaveLength(1)
    expect(out[0].severityNumber).toBe(17)
  })
  it('filters by scope name', () => {
    expect(
      filterRecords(
        [rec({ scope: { name: 'chat' } }), rec({ scope: { name: 'jobs' } })],
        {
          scope: 'jobs'
        }
      )
    ).toHaveLength(1)
  })
  it('filters by body keyword (case-insensitive)', () => {
    expect(
      filterRecords([rec({ body: 'Hello World' })], { keyword: 'world' })
    ).toHaveLength(1)
  })
  it('filters by exact traceId', () => {
    expect(
      filterRecords([rec({ traceId: 'aaaa' }), rec({ traceId: 'bbbb' })], {
        traceId: 'bbbb'
      })
    ).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

Create `src/main/lib/server/routes/logs-filter.ts` with `minSeverityFromLevel(level: string): number` (`{debug:5,info:9,warn:13,error:17}[level] ?? 0`) and `filterRecords(...)`.

Rewrite `logs.ts`:

- `parseLogFile` → returns `LogRecord[]` by mapping each non-empty line: `JSON.parse` in try/catch → `normalizeToLogRecord(parsed)` → keep non-null.
- `GET /` — read query params (`level`, `surface`, `keyword`, `traceId`, `page`, `pageSize`), call `filterRecords`, reverse (newest first), paginate. Response `{ entries: LogRecord[], total, page }`.
- `GET /scopes` — `const date = c.req.query('date') || localDateStr()`; parse that file; `[...new Set(records.map((r) => r.scope.name))].sort()`; return `{ scopes }`.
- `GET /dates`, `GET /export`, `DELETE /` — unchanged.

- [ ] **Step 4: Run, verify pass** — filter test + `pnpm test`.

- [ ] **Step 5: Manual smoke (optional, needs dev server free):** with `pnpm dev` not running elsewhere, `curl 'localhost:60223/api/logs?level=error'` and `curl localhost:60223/api/logs/scopes`. Skip if the port is held.

- [ ] **Step 6: Gate + commit**

```bash
git add src/main/lib/server/routes/logs.ts src/main/lib/server/routes/logs-filter.ts tests/unit/main/lib/server/routes/
git commit -m "feat(logger): /api/logs severity+scope+traceId filters and /scopes"
```

---

## Task 8: Logger settings tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/logger.tsx`
- Modify: `src/shared/constants/test-ids.ts` (add `logger` group)
- Create: `tests/e2e/settings-logger.spec.ts`

**Interfaces:**

- Consumes: `GET /api/logs` (now returns `LogRecord[]`), `GET /api/logs/scopes`.

- [ ] **Step 1: Add test-ids**

In `src/shared/constants/test-ids.ts`, add to `TEST_IDS`:

```ts
  logger: {
    scopeSelect: 'logger.scope-select',
    traceBadge: 'logger.trace-badge',
    traceFilterChip: 'logger.trace-filter-chip'
  },
```

- [ ] **Step 2: Write the failing e2e test**

`tests/e2e/settings-logger.spec.ts`:

```ts
import { TEST_IDS } from '../../src/shared/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Settings — Logger', () => {
  test('shows the standardized log table with scope filter and trace pivot', async ({
    mainWindow
  }) => {
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Logger', exact: true })
      .click()

    // The app logs 'server: Hono is running' at startup → at least one row.
    await expect(mainWindow.getByText('Hello there!')).toHaveCount(0) // sanity: we're in settings
    await expect(
      mainWindow.getByTestId(TEST_IDS.logger.scopeSelect)
    ).toBeVisible()

    const firstTrace = mainWindow
      .getByTestId(TEST_IDS.logger.traceBadge)
      .first()
    if (await firstTrace.count()) {
      await firstTrace.click()
      await expect(
        mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip)
      ).toBeVisible()
      await mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip).click()
      await expect(
        mainWindow.getByTestId(TEST_IDS.logger.traceFilterChip)
      ).toHaveCount(0)
    }
  })
})
```

(E2E is not run in the sandbox gate — Electron teardown times out here, same as the other specs. Write it to satisfy `test-ids.linkage.test.ts` and for CI.)

- [ ] **Step 3: Run linkage test, verify it fails**

Run: `pnpm vitest run tests/unit/shared/constants/test-ids.linkage.test.ts` (or wherever it lives)
Expected: FAIL — new ids not applied in source yet.

- [ ] **Step 4: Implement the tab**

- Replace the local `interface LogEntry` with:

```ts
interface LogRecord {
  timestamp: string
  severityNumber: number
  severityText: string
  body: string
  scope: { name: string }
  attributes: Record<string, unknown>
  resource?: Record<string, unknown>
  traceId?: string
  originTraceId?: string
}
interface LogsResponse {
  entries: LogRecord[]
  total: number
  page: number
}
interface ScopesResponse {
  scopes: string[]
}
```

- Remove the static `SURFACES` array. Add `const { data: scopesData } = useSWR<ScopesResponse>(\`/api/logs/scopes?date=${date}\`)`and build options`['All', ...(scopesData?.scopes ?? [])]`.
- Rename the "Surface" `<SettingsSelect>` to "Scope", `value={scope}`, `data-testid={TEST_IDS.logger.scopeSelect}`, param key `surface` in the URL unchanged.
- Add `const [traceId, setTraceId] = useState<string | null>(null)`; include `traceId` in the `params` when set; render a dismissable chip (`data-testid={TEST_IDS.logger.traceFilterChip}`) in the filter bar when `traceId` is set, `onClick={() => setTraceId(null)}`.
- Table: rename the "Surface" column header to "Scope"; render `entry.scope.name`. Level badge reads `entry.severityText` (map DEBUG/INFO/WARN/ERROR → the existing color helpers; adjust `levelColor`/`levelClassName` to take `severityText`).
- In each row, when `entry.traceId`, render a monospace badge `entry.traceId.slice(0, 8)` with `data-testid={TEST_IDS.logger.traceBadge}`, `onClick={(e) => { e.stopPropagation(); setTraceId(entry.traceId!) }}`. When `entry.originTraceId`, a second badge `↖ {entry.originTraceId.slice(0,8)}` → `setTraceId(entry.originTraceId!)`.
- Expanded row: show `attributes` (pretty JSON), then a small list of `traceId` / `originTraceId`, then `resource` (pretty JSON).
- `formatTime` now takes `entry.timestamp` (same ISO parsing — no change needed beyond the field name).

- [ ] **Step 5: Run linkage + typecheck:web**

Run: `pnpm vitest run` (linkage passes) and `pnpm typecheck:web`.

- [ ] **Step 6: Gate + commit**

```bash
git add src/renderer/components/settings/settings-form/logger.tsx src/shared/constants/test-ids.ts tests/e2e/settings-logger.spec.ts
git commit -m "feat(logger): standardized log table + scope filter + trace pivot"
```

---

## Task 9: CLAUDE.md + `bindTraceAttributes` adoption

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/main/lib/server/routes/chat.ts`, `src/main/lib/server/routes/deep-research.ts`, `src/main/lib/jobs/worker.ts`

- [ ] **Step 1: `bindTraceAttributes` at the entry points**

- `chat.ts` `chat.post('/')` handler — right after `const id = ...` is resolved:

```ts
import { bindTraceAttributes } from '../../logger/trace-context'
// ...
bindTraceAttributes({ chatId: id })
```

- `deep-research.ts` `deepResearch.post('/')` — after `deepResearchId` is destructured:

```ts
bindTraceAttributes({ researchId: deepResearchId })
```

- `worker.ts` — inside the `withTrace` callback added in Task 6, replace the standalone `logger.debug('jobs', 'processing', ...)` detail with a bind:

```ts
bindTraceAttributes({ queueName, msgId: msg.msgId })
logger.debug('jobs', 'processing')
```

- [ ] **Step 2: Verify** — `pnpm typecheck && pnpm test`. Confirm (by reading) that `chatId` now appears on chat-trace records without being passed to each `logger.*` call — no assertion needed, this is cleanup.

- [ ] **Step 3: Update CLAUDE.md**

In the "Code Structure" → main process list, update the logger line:

```
- `src/main/lib/logger/` — OpenTelemetry-shaped structured logging: `record.ts`
  (LogRecord shape + severity/exception/legacy mapping), `resource.ts`
  (service/process identity), `trace-context.ts` (AsyncLocalStorage per-unit
  trace ids), `index.ts` (the `logger` API). `withTrace` wraps the `/api/*`
  Hono middleware, the job worker, and the scheduler; `enqueueJob` threads the
  originating `traceId` onto job payloads. See
  docs/superpowers/specs/2026-09-06-standardized-logging-design.md
```

Add `/api/logs/scopes` context near the routes list if the route inventory enumerates sub-paths (it lists top-level routes only — a one-line note in the logger entry is enough). Note the `x-trace-id` response header in the "Backend Server Architecture" middleware pipeline section (new step: "Trace middleware — wraps each `/api/*` request in an `AsyncLocalStorage` trace, sets `x-trace-id`").

- [ ] **Step 4: Gate + commit**

```bash
git add CLAUDE.md src/main/lib/server/routes/chat.ts src/main/lib/server/routes/deep-research.ts src/main/lib/jobs/worker.ts
git commit -m "feat(logger): bind chatId/researchId/queueName to their traces; docs"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                          | Task                                             |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| §1 LogRecord shape, severity, exception convention, legacy fallback   | Task 2 (+ consumed by 4)                         |
| §2 Resource                                                           | Task 1                                           |
| §3 trace-context module                                               | Task 3                                           |
| §3 logger integration (traceId/originTraceId stamping, ambient attrs) | Task 4                                           |
| §3 entry point 1 (HTTP middleware, `x-trace-id`)                      | Task 5                                           |
| §3 entry point 2 (job worker) + origin threading                      | Task 6                                           |
| §3 entry point 3 (scheduler)                                          | Task 6                                           |
| §4 `/api/logs` filters + `/scopes`                                    | Task 7                                           |
| §5 Logger tab                                                         | Task 8                                           |
| §6 `LogSurface` widening                                              | Task 4                                           |
| §7 `bindTraceAttributes` adoption (stretch)                           | Task 9                                           |
| §8 file structure (`logger.ts` deleted same commit)                   | Task 4                                           |
| §10 error handling (logger never throws, `withTrace` transparent)     | Tasks 3, 4 (covered by design of the code shown) |
| §11 testing                                                           | every task's tests                               |
| §8 CLAUDE.md update                                                   | Task 9                                           |

No gaps.

**Placeholder scan:** Task 6 Step 1 test bodies contain `/* captured */` sketches for the db-mock capture — the executor must wire these to the existing `queries.test.ts` / `worker.test.ts` mock style (the exact `db.execute` mock shape is in those files). This is the one under-specified spot; flagged, not hidden. Task 4 Step 4 has a documented fallback ("merge Task 7 into this task") rather than a vague instruction. Everything else is concrete.

**Type consistency:** `LogRecord` fields identical in Tasks 2, 4, 7, 8. `severityOf` / `toAttributes` / `normalizeToLogRecord` / `withTrace` / `currentTrace` / `bindTraceAttributes` / `extractOriginTraceId` signatures match across their defining and consuming tasks. `traceId` = 32 hex, `session.id` = 16 hex, consistently. `__originTraceId` is the wire field name everywhere; `originTraceId` is the in-memory/record field everywhere.

---

## Execution note

Order matters: Tasks 1–3 are independent and could be done in any order, but Task 4 depends on all three, and Tasks 5–9 depend on Task 4. Do them in sequence. Task 4 is the risk point (import graph change across ~40 files + `logs.ts` type break) — budget extra care there and run the full `pnpm test` + `pnpm typecheck` before committing it.
