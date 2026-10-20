import type {
  AnalyticsStatus,
  QueryResult,
  SnapshotMeta
} from '@actovia/shared/types/analytics'
import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/analytics'

export type { AnalyticsStatus, QueryResult, SnapshotMeta }

export function getAnalyticsStatus(): Promise<AnalyticsStatus> {
  return fetcher<AnalyticsStatus>(`${BASE}/status`)
}

export function buildSnapshot(): Promise<SnapshotMeta> {
  return fetcher<SnapshotMeta>(`${BASE}/snapshot`, { method: 'POST' })
}

export function runAuditQuery(sql: string): Promise<QueryResult> {
  return fetcher<QueryResult>(`${BASE}/query`, {
    method: 'POST',
    body: { sql }
  })
}

/** RFC 4180-ish CSV of a result; objects/arrays are JSON-encoded in their cell. */
export function resultToCsv(result: QueryResult): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const header = result.columns.map((c) => escape(c.name)).join(',')
  const lines = result.rows.map((row) =>
    result.columns.map((c) => escape(row[c.name])).join(',')
  )
  return [header, ...lines].join('\n')
}
