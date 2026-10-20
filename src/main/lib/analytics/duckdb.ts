import type { QueryResult } from '@actovia/shared/types/analytics'

import { logger } from '../logger'
import { getAnalyticsDbPath } from '../paths'

/**
 * DuckDB wrapper for the chat-audit snapshot (`~/.actovia/analytics/actovia.duckdb`).
 *
 * - Lazy: the native library is ~100 MB and takes seconds to load cold, so it
 *   is `import()`ed on first use (Settings → Developer → Chat Audit), never at
 *   boot. The package is a Vite external (see vite.main.config.mts).
 * - Read-only by construction: queries run on an instance opened with
 *   `access_mode: READ_ONLY`; only `buildSnapshot()` opens the file
 *   read-write, and every DuckDB operation is serialised on one promise chain
 *   so the two modes never overlap (DuckDB refuses to open one file twice in
 *   the same process anyway).
 * - No file access from the console: the read-only instance — opened only
 *   after the snapshot's tables exist — runs with `enable_external_access =
 *   false` and `lock_configuration = true`, so `read_text` / `read_blob` /
 *   `read_json` / `COPY` / `ATTACH` of any path (the PGlite files, `~/.ssh`)
 *   fail, and no query can turn it back on. The snapshot is all it can read;
 *   that is why `logs` is a table copied at rebuild, not a view over the files.
 */

type DuckDBModule = typeof import('@duckdb/node-api')
type DuckDBInstance = import('@duckdb/node-api').DuckDBInstance
type DuckDBConnection = import('@duckdb/node-api').DuckDBConnection

export type AccessMode = 'READ_ONLY' | 'READ_WRITE'

/** Rows returned to the renderer per query; the result flags truncation. */
export const MAX_RESULT_ROWS = 500

const WIDE_INTEGER_TYPES = new Set(['BIGINT', 'UBIGINT', 'HUGEINT', 'UHUGEINT'])

let modulePromise: Promise<DuckDBModule> | null = null
let instance: DuckDBInstance | null = null
let instanceMode: AccessMode | null = null
let chain: Promise<unknown> = Promise.resolve()

/** The native library failed to load (missing platform package, dlopen error). */
export class DuckDBUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'DuckDBUnavailableError'
  }
}

export function loadDuckDB(): Promise<DuckDBModule> {
  if (!modulePromise) {
    modulePromise = import('@duckdb/node-api').then(
      (mod) => {
        // Rolldown keeps the external dynamic import as a real `import()`;
        // Node then exposes a CJS package's exports both as named exports
        // and under `default`. Prefer whichever carries the class.
        const api = (
          'DuckDBInstance' in mod
            ? mod
            : (mod as { default: DuckDBModule }).default
        ) as DuckDBModule
        return api
      },
      (err) => {
        modulePromise = null
        throw new DuckDBUnavailableError(err)
      }
    )
  }
  return modulePromise
}

/** Serialises DuckDB work so a snapshot rebuild never races a console query. */
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work)
  chain = next.catch(() => undefined)
  return next
}

async function openInstance(mode: AccessMode): Promise<DuckDBInstance> {
  if (instance && instanceMode === mode) return instance
  closeInstanceSync()
  const { DuckDBInstance } = await loadDuckDB()
  instance = await DuckDBInstance.create(
    getAnalyticsDbPath(),
    mode === 'READ_ONLY'
      ? {
          access_mode: mode,
          enable_external_access: 'false',
          lock_configuration: 'true'
        }
      : { access_mode: mode }
  )
  instanceMode = mode
  return instance
}

function closeInstanceSync(): void {
  if (!instance) return
  try {
    instance.closeSync()
  } catch (err) {
    logger.warn('analytics', 'duckdb close failed', { error: err })
  }
  instance = null
  instanceMode = null
}

async function withConnection<T>(
  mode: AccessMode,
  work: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  return serialize(async () => {
    const db = await openInstance(mode)
    const conn = await db.connect()
    try {
      return await work(conn)
    } finally {
      conn.closeSync()
    }
  })
}

export function withReadOnly<T>(
  work: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  return withConnection('READ_ONLY', work)
}

export function withReadWrite<T>(
  work: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  return withConnection('READ_WRITE', work)
}

/** Drops the open instance (app quit, or after a rebuild so the next query reopens read-only). */
export function closeDuckDB(): void {
  serialize(async () => closeInstanceSync()).catch(() => undefined)
}

export async function duckdbVersion(): Promise<string> {
  const { DuckDBInstance } = await loadDuckDB()
  const mem = await DuckDBInstance.create(':memory:')
  try {
    const conn = await mem.connect()
    try {
      const reader = await conn.runAndReadAll('select version() as v')
      return String(reader.getRowObjectsJson()[0]?.v ?? '')
    } finally {
      conn.closeSync()
    }
  } finally {
    mem.closeSync()
  }
}

/**
 * Runs one SQL text against a connection and shapes the result for the
 * renderer: JSON-safe cells (BigInt, timestamps, structs handled by
 * `getRowObjectsJson`), column types by name, a row cap with a flag.
 */
export async function readResult(
  conn: DuckDBConnection,
  sql: string
): Promise<QueryResult> {
  const { DuckDBTypeId } = await loadDuckDB()
  const started = performance.now()
  const reader = await conn.runAndReadUntil(sql, MAX_RESULT_ROWS + 1)
  const all = reader.getRowObjectsJson()
  const truncated = all.length > MAX_RESULT_ROWS
  const rows = truncated ? all.slice(0, MAX_RESULT_ROWS) : all
  const names = reader.columnNames()
  const types = reader.columnTypes()
  const columns = names.map((name, i) => ({
    name,
    type: types[i]?.alias ?? DuckDBTypeId[types[i]?.typeId] ?? 'UNKNOWN'
  }))
  // getRowObjectsJson renders 64-bit+ integers as strings so nothing is ever
  // silently rounded; `count(*)` is one of those. Hand back a number where
  // it is exact, which is every value the renderer's tables will ever see.
  const wide = new Set(
    columns.filter((c) => WIDE_INTEGER_TYPES.has(c.type)).map((c) => c.name)
  )
  for (const row of rows) {
    for (const name of wide) {
      const v = row[name]
      if (typeof v === 'string' && /^-?\d+$/.test(v)) {
        const n = Number(v)
        if (Number.isSafeInteger(n)) row[name] = n
      }
    }
  }
  return {
    columns,
    rows: rows as QueryResult['rows'],
    rowCount: rows.length,
    truncated,
    durationMs: Math.round(performance.now() - started)
  }
}

/** The console path: read-only instance, capped result. */
export function runQuery(sql: string): Promise<QueryResult> {
  return withReadOnly((conn) => readResult(conn, sql))
}
