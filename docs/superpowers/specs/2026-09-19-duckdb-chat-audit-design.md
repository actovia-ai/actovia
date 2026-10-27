# Chat Audit on DuckDB — Design

> Cost/price parts superseded by 2026-10-27-remove-cost-context-panel-design.md (ISSUE-235).

Date: 2026-09-19
Status: Approved (autonomous session), implemented in the same branch.
Research: `docs/duckdb-research.md`.

## Summary

Settings → Developer gains a **Chat Audit** page: a read-only SQL console
over a DuckDB snapshot of the user's chats, messages and projects, with a
`logs` view straight over the JSONL log files. DuckDB (`@duckdb/node-api`,
Node-API binding) is lazy-loaded in the main process on first use; PGlite
remains the only write path.

## Goals

- Build / rebuild a snapshot on demand (`~/.actovia/analytics/actovia.duckdb`
  - `snapshot.json` meta): `chats`, `messages` (usage flattened to
    `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
    `total_tokens`, `cost_usd`), `projects`, and a `logs` view over
    `~/.actovia/logs/*.jsonl` when any exist.
- Run any SQL against it, capped at 500 rows, with column names and types
  and the wall time.
- Preset queries a non-SQL user can click: messages per day, tokens and
  cost by model, tool calls, longest chats, errors by model, activity by
  hour, message search, log severity by scope.
- Download the current result as CSV; open the snapshot folder in Finder.

## Non-goals

- Live sync — the snapshot is explicit and dated on screen.
- Writes through DuckDB. The console connection opens the file
  `access_mode: READ_ONLY`; the read-write instance exists only while a
  snapshot is being built, and all DuckDB work is serialised on one promise
  chain so the two never overlap.
- Loading DuckDB at boot; any Philharmonic/chat-path use.

## Architecture

```
renderer  settings-form/chat-audit.tsx ── services/analytics.ts ──▶ /api/v1/analytics
main      routes/analytics.ts ──▶ lib/analytics/snapshot.ts ──▶ PGlite (Drizzle) → NDJSON → DuckDB
                              ──▶ lib/analytics/duckdb.ts   (lazy import, RO/RW instance, runQuery)
```

- `lib/analytics/duckdb.ts` — `loadDuckDB()` (one dynamic import, cached),
  `withReadOnly` / `withReadWrite` (open the file in that mode, closing any
  instance in the other), `runQuery(sql)` → `{ columns, rows, rowCount,
  truncated, durationMs }` via `runAndReadUntil(sql, 501)` +
  `getRowObjectsJson()` (BigInt-safe), `closeDuckDB()` on quit.
- `lib/analytics/snapshot.ts` — pure row mappers (`toChatRow`,
  `toMessageRow`, `toProjectRow`, unit-tested), NDJSON staging under
  `analytics/tmp`, `CREATE OR REPLACE TABLE … AS SELECT * FROM
  read_json(…, columns = {…})` with explicit types, the `logs` view
  (`read_json_auto(glob, union_by_name = true)`, skipped when the glob is
  empty), `snapshot.json` meta.
- `routes/analytics.ts` (`/api/v1/analytics`): `GET /status`, `POST
  /snapshot`, `POST /query { sql }`. DuckDB errors surface as
  `VALIDATION_FAILED` with DuckDB's own message (it names the column or
  syntax problem); a missing snapshot is `ANALYTICS_SNAPSHOT_MISSING`
  (404); a DuckDB that fails to load is `ANALYTICS_UNAVAILABLE` (503).
- Packaging: `@duckdb/node-api` + `@duckdb/node-bindings` are Vite externals;
  forge keeps `node_modules/@duckdb/**` and `detect-libc` and unpacks
  `@duckdb/**` from asar.

## UI (Settings → Developer → Chat Audit)

Status card: snapshot age, row counts per table, DuckDB version, Rebuild and
Open-folder buttons; an explanation when no snapshot exists yet. Presets as a
row of small buttons; a Monaco SQL editor (the app's existing
`StandaloneCodeEditor`, `language: sql`, ⌘/Ctrl+Enter bound through the editor,
completion of the snapshot's table and column names from
`packages/shared/src/constants/chat-audit-schema.ts`); Run button with
the row count and time; a results `Table` in a scrolling frame with sticky
headers; the DuckDB error in a destructive `Alert`; Download CSV.

## Testing

- Unit: row mappers; `runQuery` result shaping with a real in-memory DuckDB
  (node-api works under vitest); the route with mocked analytics modules;
  every preset compiles against a fixture snapshot.
- E2E: open the tab, rebuild on a fresh profile, run a preset, see the
  results frame; every `TEST_IDS.chatAudit.*` id is referenced.
