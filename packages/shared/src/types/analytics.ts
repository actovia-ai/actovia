/** `/api/v1/analytics` — the DuckDB-backed Chat Audit (Settings → Developer). */

export interface SnapshotTable {
  name: string
  rows: number
}

export interface SnapshotMeta {
  builtAt: string
  durationMs: number
  tables: SnapshotTable[]
  /** Whether a `logs` view over ~/.actovia/logs/*.jsonl was created. */
  logsIncluded: boolean
  sizeBytes: number
  /** `CHAT_AUDIT_SCHEMA_VERSION` when it was built; absent before 2026-10-01. */
  schemaVersion?: string
}

export interface AnalyticsStatus {
  /** DuckDB loaded (the native library is lazy-loaded on first use). */
  available: boolean
  version?: string
  /** Why `available` is false, if it is. */
  error?: string
  snapshot: SnapshotMeta | null
  path: string
}

export type QueryCell =
  | null
  | boolean
  | number
  | string
  | QueryCell[]
  | {
      [key: string]: QueryCell
    }

export interface QueryColumn {
  name: string
  type: string
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, QueryCell>[]
  rowCount: number
  /** True when the result was cut at the row cap. */
  truncated: boolean
  durationMs: number
}
