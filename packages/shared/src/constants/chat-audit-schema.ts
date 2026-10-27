/**
 * Columns of the Chat Audit snapshot (`~/.actovia/analytics/actovia.duckdb`),
 * as DuckDB types. One definition serves both sides: the main process builds
 * the tables from it (`src/main/lib/analytics/snapshot.ts`) and the SQL
 * editor's autocomplete offers exactly these names.
 */
export const CHAT_AUDIT_SCHEMA = {
  chats: {
    id: 'VARCHAR',
    title: 'VARCHAR',
    favorite: 'BOOLEAN',
    created_at: 'TIMESTAMP'
  },
  messages: {
    id: 'VARCHAR',
    chat_id: 'VARCHAR',
    run_id: 'VARCHAR',
    role: 'VARCHAR',
    provider: 'VARCHAR',
    model: 'VARCHAR',
    api: 'VARCHAR',
    stop_reason: 'VARCHAR',
    error_message: 'VARCHAR',
    tool_name: 'VARCHAR',
    tool_call_id: 'VARCHAR',
    is_error: 'BOOLEAN',
    text: 'VARCHAR',
    input_tokens: 'BIGINT',
    output_tokens: 'BIGINT',
    cache_read_tokens: 'BIGINT',
    cache_write_tokens: 'BIGINT',
    total_tokens: 'BIGINT',
    duration_ms: 'BIGINT',
    created_at: 'TIMESTAMP',
    content: 'JSON'
  },
  /** Philharmonic Group transcripts; `text` has every current secret masked. */
  group_messages: {
    id: 'VARCHAR',
    conversation_id: 'VARCHAR',
    role: 'VARCHAR',
    agent_id: 'VARCHAR',
    task_id: 'VARCHAR',
    round_id: 'VARCHAR',
    text: 'VARCHAR',
    created_at: 'TIMESTAMP'
  },
  /** One PM round's decision trail, in `seq` order; `payload` is masked. */
  pm_round_events: {
    conversation_id: 'VARCHAR',
    round_id: 'VARCHAR',
    seq: 'INTEGER',
    kind: 'VARCHAR',
    tool_name: 'VARCHAR',
    payload: 'JSON',
    created_at: 'TIMESTAMP'
  },
  /** A view over ~/.actovia/logs/*.jsonl; typed so ragged `attributes` never break inference. */
  logs: {
    timestamp: 'TIMESTAMP',
    severityNumber: 'INTEGER',
    severityText: 'VARCHAR',
    body: 'VARCHAR',
    scope: 'STRUCT(name VARCHAR)',
    attributes: 'JSON',
    resource: 'JSON',
    traceId: 'VARCHAR',
    originTraceId: 'VARCHAR'
  }
} as const

export type ChatAuditTable = keyof typeof CHAT_AUDIT_SCHEMA

/**
 * A short fingerprint of the tables and their columns. A snapshot records the
 * one it was built with (`SnapshotMeta.schemaVersion`); one built before a
 * column was added cannot run the presets that read it, so the page asks for
 * a rebuild when the two differ.
 */
export function schemaFingerprint(
  schema: Record<string, Record<string, string>>
): string {
  const text = Object.entries(schema)
    .map(([table, columns]) => `${table}(${Object.keys(columns).join(',')})`)
    .join(';')
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + (text.codePointAt(i) ?? 0)) >>> 0
  }
  return hash.toString(36)
}

export const CHAT_AUDIT_SCHEMA_VERSION = schemaFingerprint(CHAT_AUDIT_SCHEMA)
