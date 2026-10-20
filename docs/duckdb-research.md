# DuckDB in Actovia — research notes

Date: 2026-09-19. Companion to
`docs/superpowers/specs/2026-09-19-duckdb-chat-audit-design.md`.

## What DuckDB is

An in-process analytical (OLAP) SQL engine — the "SQLite of analytics".
Columnar, vectorised, single file (or in-memory), no server. Its strengths for
a desktop app:

- **Reads files directly.** `read_json_auto('logs/*.jsonl')`, `read_csv`,
  `read_parquet`, globs, `union_by_name` for ragged schemas — no import step.
- **Fast aggregates** over millions of rows on a laptop; irrelevant at
  Actovia's current data sizes but it means the audit console never needs
  paging tricks.
- **Portable output.** A `.duckdb` file or Parquet/CSV export opens in the
  DuckDB CLI, DBeaver, Python, R, Excel — the "hand the data to someone
  else" story PGlite doesn't have (PGlite is a private WASM Postgres).
- **Friendly SQL.** `GROUP BY ALL`, `FROM t SELECT`, `SUMMARIZE t`,
  `PIVOT`, struct field access (`scope.name`) on JSON-derived columns.

## Spike results (Electron 44.4.2 / Node 24.21 in the main process)

| Probe                                                           | Result                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@duckdb/node-api@1.5.5-r.5` loads in the Electron main process | Yes — Node-API binding, no rebuild, no `electron-rebuild`                   |
| `require` cost, cold (first ever load of the 117 MB dylib)      | ~3.2 s                                                                      |
| `require` cost, warm                                            | ~85 ms                                                                      |
| `DuckDBInstance.create(':memory:')`                             | 8–22 ms                                                                     |
| `read_json_auto` on NDJSON + `GROUP BY ALL`                     | Works offline (json extension is built in)                                  |
| Gotcha                                                          | `count(*)` etc. come back as `BigInt` — serialise via `getRowObjectsJson()` |

Bundle cost: `@duckdb/node-bindings-<platform>` is ~113 MB unpacked
(`libduckdb.dylib` 117 MB on darwin-arm64), one platform per build. It must
be **external** in `vite.main.config.mts` (same reason as PGlite: native
assets resolve relative to the real package) and **unpacked from asar**
(`duckdb.node` dlopens `libduckdb.dylib` from its own directory, so the
`.node`-only rule of `AutoUnpackNativesPlugin` is not enough). The forge
`ignore` allowlist keeps `@duckdb/*` and its runtime dep `detect-libc`.

## Where it fits Actovia

1. **Chat audit (built now)** — Settings → Developer → Chat Audit. A
   snapshot of `chat` / `message` / `project` from PGlite is written into
   `~/.actovia/analytics/actovia.duckdb`, plus a `logs` view straight over
   `~/.actovia/logs/*.jsonl`. A read-only SQL console with presets (tokens
   and cost by model, tool calls, longest chats, errors, activity by hour,
   full-text search, log severity by scope) and CSV export. The snapshot
   file is the audit artefact: it opens in any DuckDB client.
2. **Log analytics without import** — the same `logs` view answers "which
   scope errored most this week" over the JSONL files that already exist;
   no ingestion pipeline.
3. **Future: a `query-data-file` calling tool** — let the model run SQL over
   a CSV/Parquet/JSONL the user attaches (ChatGPT-style data analysis)
   without loading it into PGlite. DuckDB is the natural engine; the wrapper
   built for the audit console (`src/main/lib/analytics/duckdb.ts`) is
   reusable as-is.
4. **Future: Parquet export in Data Controls** — `COPY messages TO
   'chats.parquet'` for external analysis; one statement.

## What it should not replace

- **PGlite stays the system of record.** DuckDB here is a read-only mirror
  rebuilt on demand; it never becomes a write path. Two engines sharing one
  truth would be a bug factory.
- **Not for the searchbar / hot paths.** The 100 MB library is lazy-loaded
  on first use of the audit page and never at boot.

## Alternatives considered

- **A SQL console straight on PGlite** — zero new dependency, but it exposes
  the live OLTP database to ad-hoc queries (a stray `DELETE` is a data-loss
  bug), has no file-reading, and produces nothing portable.
- **`@duckdb/duckdb-wasm` in the main process** — avoids the native binary,
  but the WASM build needs file-system shims for local files, is slower, and
  the Node bundle is not the project's supported target.
