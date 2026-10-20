# Standardized Logging (OpenTelemetry-shaped) — Design

**Date**: 2026-09-06

**Status**: approved (brainstorming 2026-09-06)

---

## Context

Actovia's logger (`src/main/lib/logger.ts`, spec `2026-03-24-logger-design.md`) is
a zero-dependency JSONL writer: `logger.<level>(surface, message, detail?)` →
one line `{ts, level, surface, message, detail?}` appended to
`~/.actovia/logs/YYYY-MM-DD.jsonl`, also echoed to `console.*`. ~105 call sites
across ~40 files. Read back by `GET /api/logs` (filter by date/level/surface/
keyword, paginate, export, clear) and the **Settings → Logger** tab
(`src/renderer/components/settings/settings-form/logger.tsx`). Main process only.

Two structural problems:

1. **`LogSurface` is a closed union of 20 strings.** Every new subsystem edits
   the union (most recently `discover`). Friction with no upside.
2. **No correlation.** A chat turn fans out through `agentLoop`, multi-step tool
   calls, provider calls, DB queries, then post-turn background jobs
   (`index-message`, `lcm-post-turn`, `memory-consolidate`, `kb-sync`,
   `discover-refresh`). Nothing ties those log lines together. Answering "what
   happened during this one turn / why did it take 40s / which step failed" from
   a flat file means eyeballing timestamps.

A full OpenTelemetry adoption was evaluated and rejected (spike, 2026-09-06):
the OTel **Logs** SDK for JS is still experimental, and OTel's payoff (collectors,
dashboards, fleet aggregation, cross-service traces) needs infrastructure a
local-first single-user desktop app neither has nor should have by default.

This spec **borrows OpenTelemetry's data model and naming conventions** without
any `@opentelemetry/*` dependency, and adds **flat per-unit-of-work trace IDs**
(no span tree) via `AsyncLocalStorage`. It is the on-ramp: a real `spanId`
hierarchy can be layered on later (e.g. if Computer Use needs episode-level
tracing) without reshaping anything defined here.

## Decisions (from brainstorming, 2026-09-06)

1. **Borrow the design, not the SDK.** OTel LogRecord shape + semantic
   conventions (`exception.*`), Resource, Instrumentation Scope. Zero new
   dependencies.
2. **Flat trace IDs, no spans.** One `traceId` per unit of work (HTTP request,
   background job, scheduler task). `spanId` is a reserved field, always absent
   this iteration.
3. **Background work links to its origin.** `enqueueJob` stamps the ambient
   `traceId` onto the job payload as `__originTraceId`; the worker starts the
   job's trace with that value as `originTraceId`, so every one of the job's
   log lines carries both its own `traceId` and the originating `originTraceId`.
   Jobs still get their own `traceId`.
4. **Flat enriched JSONL on disk.** One self-contained OTel-LogRecord-shaped
   object per line (Resource inline). Not the OTLP `resourceLogs[].scopeLogs[]`
   envelope — it is awkward as an append-only file and would force a bigger
   parser/UI rewrite. An OTLP-JSON _export_ format can come later.
5. **ISO timestamps, not `timeUnixNano`.** Readability of the raw file wins; an
   OTLP export can compute nanoseconds on demand. Deliberate deviation.
6. **Main process only.** Renderer logging (IPC bridge, React error boundaries,
   `window.onerror`) is a separate future pass.
7. **Call signature unchanged.** `logger.<level>(surface, message, detail?)`
   stays. No churn at the ~105 call sites.
8. **No migration.** Legacy log lines are best-effort-mapped by the reader so a
   day that straddles the upgrade still renders. `~/.actovia/logs` is disposable
   (7-day retention + "Clear All").

---

## 1. The log record

`src/main/lib/logger/record.ts` — the on-disk shape, one per JSONL line.

```ts
interface LogRecord {
  timestamp: string // ISO 8601, e.g. "2026-09-06T10:30:00.123Z"
  severityNumber: number // 5 | 9 | 13 | 17
  severityText: string // "DEBUG" | "INFO" | "WARN" | "ERROR"
  body: string // human-readable message
  scope: { name: string } // subsystem — OTel Instrumentation Scope
  attributes: Record<string, unknown> // structured metadata
  resource: Resource // process/app identity, inline on every line
  traceId?: string // 32 lowercase hex, W3C format; absent outside a traced unit
  originTraceId?: string // set when this unit was spawned by another traced unit
  spanId?: string // RESERVED — always absent this iteration
}
```

### Field mapping from today

| Today (`LogEntry`) | New (`LogRecord`)                            | Notes                                                                              |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ts`               | `timestamp`                                  | Same ISO format, renamed.                                                          |
| `level: "info"`    | `severityNumber: 9` + `severityText: "INFO"` | See severity table.                                                                |
| `message`          | `body`                                       | Verbatim.                                                                          |
| `surface: "chat"`  | `scope: { name: "chat" }`                    | Nested to match OTel; any string accepted.                                         |
| `detail`           | `attributes`                                 | Shallow-merged; `{}` when omitted (never `null`). Well-known keys get conventions. |
| —                  | `resource`                                   | New; see §2.                                                                       |
| —                  | `traceId` / `originTraceId`                  | New; see §3.                                                                       |

### Severity mapping

OTel `SeverityNumber` bands: DEBUG 5–8, INFO 9–12, WARN 13–16, ERROR 17–20.
Actovia uses the low end of each band.

| Actovia level | `severityNumber` | `severityText` |
| ------------- | ---------------- | -------------- |
| `debug`       | 5                | `DEBUG`        |
| `info`        | 9                | `INFO`         |
| `warn`        | 13               | `WARN`         |
| `error`       | 17               | `ERROR`        |

`is.dev ? 5 : 9` remains the minimum-level gate (unchanged behavior, expressed
as a `severityNumber` threshold).

### Error convention

When `detail` carries an `error` key (an `Error` instance **or** a string), the
logger removes it and expands per OTel exception semantic conventions:

| Attribute              | Source                                      |
| ---------------------- | ------------------------------------------- |
| `exception.type`       | `err.name` (Error) or `"Error"` (string)    |
| `exception.message`    | `err.message` (Error) or the string itself  |
| `exception.stacktrace` | `err.stack` when present; omitted otherwise |

Existing call sites already pass `{ error: String(err) }` or `{ error: err }` —
both are handled. Every other `detail` key passes through to `attributes`
untouched (`chatId`, `msgId`, `port`, `durationMs`, …). No forced `actovia.`
namespacing this pass.

### Legacy-line fallback (reader side)

A shared `normalizeToLogRecord(raw: unknown): LogRecord | null` in `record.ts`
accepts either shape. An old-shape line (`{ts, level, surface, message, detail}`)
maps as `ts→timestamp`, `level→severityNumber/Text`, `surface→scope.name`,
`message→body`, `detail→attributes`, no `resource`/`traceId`. A new-shape line
passes through. Anything else → `null`. The `/api/logs` parser calls it per line
and drops the `null`s (current skip-malformed behavior).

---

## 2. Resource

`src/main/lib/logger/resource.ts` — computed once at module load, frozen,
spread into every `LogRecord`.

```ts
interface Resource {
  'service.name': 'actovia'
  'service.version': string // app.getVersion() — "1.13.0"
  'process.pid': number
  'process.runtime.name': 'electron'
  'os.type': string // os.type() — "Darwin" | "Windows_NT" | "Linux"
  'os.version': string // os.release()
  'session.id': string // 16 lowercase hex, random, one per app launch
}
```

`session.id` distinguishes app runs within one day's file (crash → relaunch).
Inline redundancy (~6 keys × every line) is accepted — JSONL lines stay
self-contained for `grep`, `jq`, and the line-by-line parser. Deduplication
(file header, or a sidecar) is a possible later optimization, explicitly not
done now.

`app.getVersion()` is only callable in the Electron main process after `app` is
ready; `resource.ts` reads it lazily on first log call and caches, falling back
to the `package.json` `version` import if `app` is unavailable (tests, early
boot).

---

## 3. Trace context

`src/main/lib/logger/trace-context.ts` — the only new runtime concept.

```ts
interface TraceContext {
  traceId: string
  originTraceId?: string
  attributes: Record<string, unknown> // ambient — merged into every record in this trace
}

// module-private
const als = new AsyncLocalStorage<TraceContext>()

export function newTraceId(): string // randomBytes(16).toString("hex")

export function withTrace<T>(
  fn: () => T,
  opts?: { originTraceId?: string; attributes?: Record<string, unknown> }
): T // als.run({ traceId: newTraceId(), ...opts, attributes: opts?.attributes ?? {} }, fn)

export function currentTrace(): TraceContext | undefined // als.getStore()

export function bindTraceAttributes(attrs: Record<string, unknown>): void
// Object.assign(currentTrace()?.attributes ?? {}, attrs) — no-op if not in a trace
```

### Logger integration

`write()` in `logger/index.ts` reads `currentTrace()` and:

- sets `record.traceId` / `record.originTraceId` when present,
- shallow-merges `ctx.attributes` **under** the call's own `detail` (explicit
  call args win on key collision).

No call-site change. `logger.*` outside any `withTrace` (startup, module load)
simply omits `traceId` — valid and expected.

### Entry points (where `withTrace` wraps)

| #   | Unit of work   | File / location                                                                                                       | Boundary                                                                                                  |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | HTTP request   | `src/main/lib/server/app.ts` — new middleware on `/api/*`, **before** the settings middleware                         | `withTrace(() => next())`. Adds `x-trace-id` response header.                                             |
| 2   | Background job | `src/main/lib/jobs/worker.ts` — `processQueue`, per message                                                           | `withTrace(() => handlers[queueName](msg.message), { originTraceId: extractOriginTraceId(msg.message) })` |
| 3   | Scheduler task | `src/main/lib/ai/philharmonic/scheduler.ts` — inside `runScheduledRound` and the per-task body of `runDueOneOffTasks` | `withTrace` per fired task                                                                                |

Entry point 1 covers more than it looks: the chat route holds the request open
for the whole streamed `agentLoop`, and **deep research** and **Philharmonic
conversation runs** are also fully `await`ed inside their POST handlers (verified
2026-09-06) — all three inherit the request's trace with no extra wrapping.
Scheduled Philharmonic tasks reach execution via entry point 3 instead, so they
too get a trace.

### Origin threading through the job queue

```
enqueueJob(queueName, payload)          // src/main/lib/jobs/queries.ts
  ├─ const tid = currentTrace()?.traceId
  └─ pgmq insert: tid ? { ...payload, __originTraceId: tid } : payload
```

`payload` is `jsonb` — no schema change. Handlers (`src/main/lib/jobs/handlers.ts`)
read named fields off `payload as SomeType`; a sibling `__originTraceId` is
invisible to them. `worker.ts` pulls it back:

```ts
function extractOriginTraceId(payload: unknown): string | undefined {
  return payload && typeof payload === 'object' && '__originTraceId' in payload
    ? String((payload as Record<string, unknown>).__originTraceId)
    : undefined
}
```

`withTrace({ originTraceId })` puts that value in the ambient `TraceContext`, so
`write()` stamps `originTraceId` onto **every** log line the job emits — the same
way it stamps `traceId`. No dedicated attribute, no special log call. In the
Logger tab, any of the job's lines can pivot back to the origin trace.

### Not traced (accepted gaps)

Module-load logs; `initJobQueue` / `initScheduler` / `connectHttpServer`
startup logs; `src/main/lib/ipc.ts` IPC handlers; `src/main/lib/db/migrate.ts`.
These emit records with no `traceId`. They are not units of work worth
correlating.

---

## 4. Read path — `/api/logs`

`src/main/lib/server/routes/logs.ts`.

### `GET /api/logs`

| Param                      | Behavior change                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `date`, `page`, `pageSize` | unchanged                                                                           |
| `level`                    | now maps to a `severityNumber >=` threshold (was `LEVEL_PRIORITY` on `entry.level`) |
| `surface`                  | now matches `record.scope.name` (param name kept as `surface` for URL stability)    |
| `keyword`                  | now substring-matches `record.body`                                                 |
| `traceId`                  | **new** — exact match on `record.traceId`. Combines with the others.                |

Response shape: `{ entries: LogRecord[], total, page }` — `entries` are now
`LogRecord`s. Legacy lines are normalized to `LogRecord` by the parser before
filtering (see §1).

### `GET /api/logs/scopes` — new

`{ scopes: string[] }` — distinct `record.scope.name` values in the given
`date`'s file (query param `date`, default today), sorted. Feeds the Logger
tab's Scope dropdown so it reflects reality instead of a hardcoded list.

### `GET /api/logs/dates`, `GET /api/logs/export`, `DELETE /api/logs`

Unchanged. Export still streams the raw file.

---

## 5. Read path — Settings → Logger tab

`src/renderer/components/settings/settings-form/logger.tsx`.

- **Types**: local `LogEntry` interface → `LogRecord` (`body`, `severityText`,
  `scope`, `attributes`, `resource`, `traceId`, `originTraceId`).
- **Columns**: Time / Level / **Scope** / Message. "Level" badge reads
  `severityText`; colors keyed off it (DEBUG gray, INFO blue, WARN yellow,
  ERROR red — same palette).
- **Scope filter**: the static `SURFACES` array is replaced by a fetch from
  `GET /api/logs/scopes` (SWR, keyed on `date`), plus an `"All"` option.
- **Trace filter**:
  - Each row with a `traceId` renders a short monospace badge (`traceId.slice(0, 8)`).
  - Clicking the badge sets a `traceId` filter (added to the SWR key). An active
    trace filter shows a dismissable chip in the filter bar
    (`"trace a1b2c3d4 ×"`).
  - `originTraceId`, when present, renders a second badge (`"↖ e5f6g7h8"`);
    clicking it filters to the origin trace.
- **Expanded row**: pretty-printed `attributes`, then `traceId` /
  `originTraceId` / `spanId` (if ever set), then `resource`.
- **`TEST_IDS`** (new, `src/shared/constants/test-ids.ts` → `logger` group):
  `logger.scopeSelect`, `logger.traceBadge`, `logger.traceFilterChip`.
  Referenced from `tests/e2e/settings-logger.spec.ts` (new or extended).

---

## 6. `LogSurface` widening

`src/main/lib/logger/index.ts` (or a `types.ts` in the folder):

```ts
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

export type LogSurface = KnownLogSurface | (string & {})
```

Editor autocomplete for the current 20; any string still type-checks. `scope.name`
carries whatever is passed. New subsystems stop editing the union.

---

## 7. `bindTraceAttributes` adoption (stretch)

Once the module exists, a handful of call sites can drop repetitive `detail`
keys by binding them once per trace:

- `chat.ts` POST handler: `bindTraceAttributes({ chatId: id })` right after the
  id is known — `chatId` then rides every log line of the turn.
- `deep-research.ts` POST handler: `bindTraceAttributes({ researchId: deepResearchId })`
  (runs inside the request trace).
- `worker.ts`: `bindTraceAttributes({ queueName, msgId })` per job.

This is cleanup, not required for the feature. The plan marks it a final
optional task; skipping it changes nothing functional.

---

## 8. File structure

### New

| File                                               | Purpose                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/main/lib/logger/index.ts`                     | `logger` API, `write()`, level gate, console echo, retention. (Was `src/main/lib/logger.ts`.) |
| `src/main/lib/logger/record.ts`                    | `LogRecord` type, severity mapping, exception expansion, `detail`→`attributes`.               |
| `src/main/lib/logger/resource.ts`                  | `Resource` type + lazy singleton.                                                             |
| `src/main/lib/logger/trace-context.ts`             | `AsyncLocalStorage`, `withTrace`, `currentTrace`, `bindTraceAttributes`, `newTraceId`.        |
| `src/main/lib/server/middlewares/trace.ts`         | Hono middleware — entry point 1.                                                              |
| `tests/unit/main/lib/logger/record.test.ts`        | Shape, severity, exception convention, legacy mapping.                                        |
| `tests/unit/main/lib/logger/trace-context.test.ts` | `als` run/nest/isolation, origin threading, `bindTraceAttributes`.                            |
| `tests/unit/main/lib/logger/resource.test.ts`      | Fields present, `session.id` stable within a process, fallback version.                       |
| `tests/e2e/settings-logger.spec.ts`                | Scope dropdown, trace badge → filter chip. (New if absent.)                                   |

### Modified

| File | Change |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `src/main/lib/logger.ts` | **Deleted in the same step** `logger/index.ts` is created — the two must never coexist (resolver ambiguity between `logger.ts` and `logger/index.ts`). Import path `../logger` / `../../logger` then resolves to the folder unchanged. `index.ts` must re-export everything current consumers use: `logger`, `cleanupOldLogs`, `localDateStr`, `type LogLevel`, and `type LogRecord` (the renamed `LogEntry`). |
| `src/main/index.ts` | Import unchanged (`{ cleanupOldLogs, logger }`). |
| `src/main/lib/server/app.ts` | Register `trace.ts` middleware on `/api/*` before the settings middleware. |
| `src/main/lib/server/middlewares/index.ts` | Export `traceMiddleware`. |
| `src/main/lib/server/routes/logs.ts` | `severityNumber` filter, `scope.name` filter, `traceId` filter, `/scopes` endpoint, legacy-line normalization, `LogRecord` response type. |
| `src/main/lib/jobs/queries.ts` | `enqueueJob` stamps `__originTraceId` (guarded: only when `payload` is a non-null object and a trace is active). |
| `src/main/lib/jobs/worker.ts` | `processQueue` wraps the handler call in `withTrace({ originTraceId: extractOriginTraceId(msg.message) })`; adds `extractOriginTraceId`; adds one `logger.debug('jobs', 'processing', { queueName, msgId })` per message so a successful job that otherwise logs nothing still has one traced line. |
| `src/main/lib/ai/philharmonic/scheduler.ts` | `withTrace` per fired task (`runScheduledRound`, per-task body of `runDueOneOffTasks`). |
| `src/renderer/components/settings/settings-form/logger.tsx` | `LogRecord` type, Scope column + dynamic dropdown (new `/api/logs/scopes` fetch), trace badges + filter chip, expanded-row fields. The tab fetches inline (`useSWR` keys + `fetcher`) — there is no `services/logs.ts` module today and this spec does not add one. |
| `src/shared/constants/test-ids.ts` | `logger.scopeSelect`, `logger.traceBadge`, `logger.traceFilterChip`. |
| `src/main/lib/logger/index.ts` (`LogSurface`) | Widen to `KnownLogSurface                                                                                                                                                                                                                                                                                                                                                                                      | (string & {})`. |
| `CLAUDE.md` | Note `logger/` folder + trace-context + `/api/logs/scopes` + `x-trace-id` header. |

Call sites (`logger.*` across ~40 files): **unchanged.**

---

## 9. Data flow — a traced chat turn

```
POST /api/chat
  └─ traceMiddleware: withTrace()                  traceId = T1
       └─ chat.post handler
            ├─ bindTraceAttributes({ chatId })      (stretch)
            ├─ logger.info('chat', 'skill injection', …)        → line { traceId: T1, … }
            ├─ agentLoop(...)  ── tool calls, provider calls ──  → lines { traceId: T1 }
            ├─ logger.error('chat', 'Chat stream error', { error })
            │        → line { traceId: T1, attributes: { "exception.type": …, "exception.stacktrace": … } }
            └─ enqueueAndProcess('index-message', row)
                 └─ enqueueJob: payload += { __originTraceId: T1 }
       (response sent, x-trace-id: T1)

  later — job worker sweep
  └─ processQueue('index-message')
       └─ withTrace({ originTraceId: T1 })          traceId = T2
            ├─ logger.debug('jobs', 'processing', { queueName, msgId })
            │        → line { traceId: T2, originTraceId: T1, … }
            └─ handlers['index-message'](payload)    → any lines carry { traceId: T2, originTraceId: T1 }
```

In the Logger tab: filter `traceId = T1` → the whole turn. Every line of the
job's own trace `T2` carries `originTraceId: T1`, so filtering `traceId = T2`
(or clicking the `↖ T1` badge on any job line) walks between the two.

---

## 10. Error handling

- **Logger never throws.** `write()` stays fire-and-forget (`appendFile(...).catch(() => {})`).
  Resource resolution and trace lookup are wrapped so a failure degrades to
  "record without resource / without traceId", never a thrown error into a
  caller.
- **`withTrace` is transparent to errors** — `als.run` propagates throws/rejections
  from `fn` unchanged. Wrapping an entry point cannot change its error behavior.
- **Malformed `__originTraceId`** (non-string in payload) → coerced via `String()`,
  or dropped if absent. Never fatal.
- **`/api/logs` parser** tolerates old lines, new lines, and unparseable lines
  (skip) — same resilience as today.

---

## 11. Testing strategy

Unit (Vitest, `tests/unit/`, mock `electron` + `@main/lib/db/db` per CLAUDE.md):

- **`record.test.ts`** — level → `severityNumber`/`severityText`; `{error: Error}`
  → `exception.*` with stacktrace; `{error: "str"}` → `exception.*` without;
  non-error `detail` keys pass through; legacy `{ts,level,surface,message}` line
  → `LogRecord`.
- **`trace-context.test.ts`** — `currentTrace()` is `undefined` outside `withTrace`;
  nested `withTrace` gets a fresh id; two sibling `withTrace` calls are isolated;
  `originTraceId` flows through; `bindTraceAttributes` merges and is a no-op
  outside a trace; a `logger.*` call inside `withTrace` produces a record with
  the id (spy on `appendFile` / the write path).
- **`resource.test.ts`** — all keys present; `session.id` identical across two
  calls in one process; version falls back to `package.json` when `app` throws.
- **`logs` route** — `severityNumber` threshold filter; `scope` filter; `traceId`
  exact filter; `/scopes` returns distinct sorted names; legacy line normalized
  in the response.
- **`worker` / `queries`** — `enqueueJob` adds `__originTraceId` when in a trace,
  omits it when not; `extractOriginTraceId` handles present/absent/malformed.

E2E (Playwright, `tests/e2e/`):

- **`settings-logger.spec.ts`** — Logger tab: Scope dropdown populated from
  `/api/logs/scopes`; a row's trace badge click adds the filter chip; chip
  dismiss clears it.

Gate: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (CLAUDE.md
pre-commit). No `--no-verify` (the known-flaky PGlite teardown is unrelated to
this surface).

---

## 12. Non-goals

Explicitly **not** in this iteration:

- `spanId` / span tree / any parent-child span hierarchy.
- Metrics (counters, histograms) — no destination for them.
- Renderer-process logging — IPC bridge, `window.onerror`, React error
  boundaries. Separate future pass.
- OTLP-JSON on disk or over the wire; any `@opentelemetry/*` package.
- Automatic `code.function` / `code.filepath` / `code.lineno` capture (needs
  stack parsing per call or a build transform).
- Namespacing custom attributes under `actovia.*`.
- An OTLP export format for the Export button (raw JSONL only, as today).
- Changing retention, file naming, or the level-gate policy.
- Touching the ~105 `logger.*` call sites' arguments (beyond the optional
  `bindTraceAttributes` cleanup at ~3 of them).
