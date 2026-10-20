// src/main/lib/analytics/snapshot.ts (+ duckdb.ts through a real DuckDB)
//
// Runs the real @duckdb/node-api under vitest against a temp analytics dir:
// builds a snapshot from fixture rows (PGlite is mocked out — `source` is
// injected), then executes every Chat Audit preset against it. A preset that
// references a column the snapshot doesn't have fails here, not in the UI.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { CHAT_AUDIT_PRESETS } from '@actovia/shared/constants/chat-audit-presets'
import { afterAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'actovia-analytics-'))
const analyticsDir = join(root, 'analytics')
const logsDir = join(root, 'logs')
mkdirSync(analyticsDir, { recursive: true })
mkdirSync(logsDir, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/paths', () => ({
  getAnalyticsDir: () => analyticsDir,
  getAnalyticsDbPath: () => join(analyticsDir, 'actovia.duckdb'),
  getLogsDir: () => logsDir
}))

const noSecrets = async () => [] as string[]

const now = new Date('2026-09-19T10:00:00.000Z')
const usage = {
  input: 120,
  output: 40,
  cacheRead: 10,
  cacheWrite: 0,
  totalTokens: 170,
  cost: {
    input: 0.001,
    output: 0.002,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.003
  }
}

const GROUP_SECRET = 'sk-group-LEAKED-secret-4d3c2b1a'
const ROUND = '11111111-1111-4111-8111-111111111111'
const CONV = '22222222-2222-4222-8222-222222222222'

const source = async () => ({
  groupMessages: [
    {
      id: 'g1',
      conversationId: CONV,
      role: 'employee',
      agentId: 'a1',
      taskId: 't1',
      roundId: null,
      content: `report with ${GROUP_SECRET} inside`,
      createdAt: now
    },
    {
      id: 'g2',
      conversationId: CONV,
      role: 'pm',
      agentId: null,
      taskId: null,
      roundId: ROUND,
      content: 'delegated',
      createdAt: now
    }
  ],
  roundEvents: [
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 0,
      kind: 'input',
      payload: { text: 'go' },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 1,
      kind: 'tool_call',
      payload: {
        toolCallId: 'c1',
        name: 'delegateTask',
        args: { instructions: `use ${GROUP_SECRET}` }
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 2,
      kind: 'tool_result',
      payload: {
        toolCallId: 'c1',
        name: 'delegateTask',
        text: 'Started task t1',
        isError: false
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 3,
      kind: 'tool_call',
      payload: {
        toolCallId: 'c2',
        name: 'waitForQuota',
        args: { stepId: 's1', employeeId: 'a1', reason: 'week used up' }
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 4,
      kind: 'tool_result',
      payload: {
        toolCallId: 'c2',
        name: 'waitForQuota',
        text: 'Step parked. You will be woken at Tue 07:00.',
        isError: false
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 5,
      kind: 'tool_call',
      payload: {
        toolCallId: 'c3',
        name: 'waitForQuota',
        args: { stepId: 's2', employeeId: 'a1', reason: 'again' }
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 6,
      kind: 'tool_result',
      payload: {
        toolCallId: 'c3',
        name: 'waitForQuota',
        text: "Refused: no step s2 in this group's active plan.",
        isError: false
      },
      createdAt: now
    },
    {
      conversationId: CONV,
      roundId: ROUND,
      seq: 7,
      kind: 'usage',
      payload: {
        inputTokens: 900,
        outputTokens: 70,
        cacheReadTokens: 5,
        costUsd: 0.0123
      },
      createdAt: now
    }
  ],
  chats: [
    {
      id: 'c1',
      title: 'Hello',
      favorite: true,
      createdAt: now
    },
    {
      id: 'c2',
      title: 'Second',
      favorite: null,
      createdAt: now
    }
  ],
  messages: [
    {
      id: 'm1',
      chatId: 'c1',
      runId: 'm1',
      role: 'user',
      provider: null,
      model: null,
      api: null,
      stopReason: null,
      errorMessage: null,
      toolName: null,
      toolCallId: null,
      isError: null,
      searchText: 'hi there keyword',
      usage: null,
      durationMs: null,
      createdAt: now,
      content: [{ type: 'text', text: 'hi there keyword' }]
    },
    {
      id: 'm2',
      chatId: 'c1',
      runId: 'm1',
      role: 'assistant',
      provider: 'anthropic',
      model: 'claude-x',
      api: 'anthropic-messages',
      stopReason: 'stop',
      errorMessage: null,
      toolName: null,
      toolCallId: null,
      isError: null,
      searchText: 'hello!',
      usage,
      durationMs: 1200,
      createdAt: now,
      content: [{ type: 'text', text: 'hello!' }]
    },
    {
      id: 'm3',
      chatId: 'c1',
      runId: 'm1',
      role: 'toolResult',
      provider: null,
      model: null,
      api: null,
      stopReason: null,
      errorMessage: null,
      toolName: 'weather',
      toolCallId: 'call-1',
      isError: false,
      searchText: null,
      usage: null,
      durationMs: null,
      createdAt: now,
      content: { ok: true }
    }
  ]
})

afterAll(async () => {
  const { closeDuckDB } = await import('@main/lib/analytics/duckdb')
  closeDuckDB()
  rmSync(root, { recursive: true, force: true })
})

describe('snapshot row mappers', () => {
  it('flattens usage into typed columns and ISO timestamps', async () => {
    const { toMessageRow, toChatRow } =
      await import('@main/lib/analytics/snapshot')
    const rows = await source()
    const m = toMessageRow(rows.messages[1])
    expect(m).toMatchObject({
      id: 'm2',
      chat_id: 'c1',
      run_id: 'm1',
      role: 'assistant',
      input_tokens: 120,
      output_tokens: 40,
      cache_read_tokens: 10,
      total_tokens: 170,
      cost_usd: 0.003,
      duration_ms: 1200,
      created_at: '2026-09-19T10:00:00.000Z'
    })
    expect(toMessageRow(rows.messages[0]).input_tokens).toBeNull()
    expect(toChatRow(rows.chats[1])).toMatchObject({ favorite: false })
  })

  it('emits typed DDL for empty tables and read_json with columns otherwise', async () => {
    const { loadTableSql, CHAT_COLUMNS } =
      await import('@main/lib/analytics/snapshot')
    expect(loadTableSql('chats', '/x.ndjson', CHAT_COLUMNS, 0)).toBe(
      'CREATE OR REPLACE TABLE chats (id VARCHAR, title VARCHAR, favorite BOOLEAN, created_at TIMESTAMP)'
    )
    const sql = loadTableSql('chats', "/it's.ndjson", CHAT_COLUMNS, 3)
    expect(sql).toContain("read_json('/it''s.ndjson'")
    expect(sql).toContain("'created_at': 'TIMESTAMP'")
  })
})

describe('buildSnapshot + runQuery (real DuckDB)', () => {
  it('builds the file, exposes the logs view, and runs every preset', async () => {
    writeFileSync(
      join(logsDir, '2026-09-19.jsonl'),
      JSON.stringify({
        timestamp: '2026-09-19T07:34:02.819Z',
        severityNumber: 9,
        severityText: 'INFO',
        body: 'hello',
        scope: { name: 'mcp' },
        attributes: { name: 'x' },
        resource: { 'service.name': 'actovia' },
        traceId: 't1'
      }) + '\n'
    )
    const { buildSnapshot, readSnapshotMeta } =
      await import('@main/lib/analytics/snapshot')
    const { runQuery, MAX_RESULT_ROWS } =
      await import('@main/lib/analytics/duckdb')

    const meta = await buildSnapshot({ source, secrets: noSecrets })
    expect(meta.tables).toEqual([
      { name: 'chats', rows: 2 },
      { name: 'messages', rows: 3 }
    ])
    expect(meta.logsIncluded).toBe(true)
    expect(meta.sizeBytes).toBeGreaterThan(0)
    expect((await readSnapshotMeta())?.builtAt).toBe(meta.builtAt)
    // What the page compares to know a snapshot predates the tables.
    expect(meta.schemaVersion).toBe(
      (await import('@actovia/shared/constants/chat-audit-schema'))
        .CHAT_AUDIT_SCHEMA_VERSION
    )

    const count = await runQuery('select count(*) as n from messages')
    expect(count.rows[0].n).toBe(3) // BigInt → JSON number
    expect(count.columns[0]).toEqual({ name: 'n', type: 'BIGINT' })

    const logs = await runQuery(
      'select scope.name as s, count(*) as n from logs group by all'
    )
    expect(logs.rows).toEqual([{ s: 'mcp', n: 1 }])

    for (const preset of CHAT_AUDIT_PRESETS) {
      await expect(runQuery(preset.sql), preset.id).resolves.toBeTruthy()
    }

    // The prompt cache of each run's first model call — what the 2026-10-01
    // stable-prefix work is measured by. Fixture: 120 uncached, 10 read, 0
    // written → 7.7 % read; 120 + 1.25×0 + 0.1×10 = 121 input-cost units.
    const cache = CHAT_AUDIT_PRESETS.find((p) => p.id === 'cacheByRun')
    expect(cache).toBeDefined()
    const byRun = await runQuery(cache!.sql)
    expect(byRun.rows).toHaveLength(1)
    expect(byRun.rows[0]).toMatchObject({
      title: 'Hello',
      cache_read: 10,
      hit_pct: 7.7,
      input_cost_units: 121
    })

    const big = await runQuery(`select * from range(${MAX_RESULT_ROWS + 50})`)
    expect(big.truncated).toBe(true)
    expect(big.rowCount).toBe(MAX_RESULT_ROWS)

    // Read-only: the console cannot mutate the snapshot.
    await expect(runQuery('delete from messages')).rejects.toThrow(/read-only/i)
    await expect(runQuery('select nope from messages')).rejects.toThrow(/nope/)

    // No file access from the console (ledger ruling R2): the snapshot is all
    // it can read — not the PGlite files, not the keys, not /etc.
    await expect(
      runQuery("select * from read_text('/etc/hosts')")
    ).rejects.toThrow(/disabled by configuration|Permission/i)
    await expect(
      runQuery(`select * from read_json('${join(logsDir, '*.jsonl')}')`)
    ).rejects.toThrow(/disabled by configuration|Permission/i)
    await expect(
      runQuery("attach '/tmp/actovia-attach-probe.db' as x")
    ).rejects.toThrow()
    await expect(runQuery('set enable_external_access = true')).rejects.toThrow(
      /locked/i
    )
  }, 60_000)

  it('a rebuild over a snapshot that still has the old logs view', async () => {
    const { buildSnapshot } = await import('@main/lib/analytics/snapshot')
    const { runQuery, withReadWrite, closeDuckDB } =
      await import('@main/lib/analytics/duckdb')
    await withReadWrite(async (conn) => {
      await conn.run('DROP TABLE IF EXISTS logs')
      await conn.run('CREATE OR REPLACE VIEW logs AS SELECT 1 AS old')
    })
    closeDuckDB()
    const meta = await buildSnapshot({ source, secrets: noSecrets })
    expect(meta.logsIncluded).toBe(true)
    const logs = await runQuery('select count(*) as n from logs')
    expect(logs.rows[0].n).toBe(1)
  }, 60_000)

  // Review S2 M3: a log line written before S1's secret-safe errors could
  // quote a key (drizzle's `params: …`); the logs table outlives the file, so
  // the copy scrubs every current secret value to its mask.
  it('scrubs current secret values out of the copied logs', async () => {
    const LEAK = 'sk-proj-LOGGED-secret-value-9f8e7d6c'
    const QUOTE = 'pa"ss\\word-LOGGED-5a4b3c2d'
    writeFileSync(
      join(logsDir, '2026-09-20.jsonl'),
      JSON.stringify({
        timestamp: '2026-09-20T07:34:02.819Z',
        severityNumber: 17,
        severityText: 'ERROR',
        body: `Failed query: update "settings" params: ${LEAK},${QUOTE}`,
        scope: { name: 'database' },
        attributes: { error: `cause ${LEAK}`, nested: { v: QUOTE } },
        resource: { 'service.name': 'actovia' },
        traceId: 't2'
      }) + '\n'
    )
    const { buildSnapshot } = await import('@main/lib/analytics/snapshot')
    const { runQuery } = await import('@main/lib/analytics/duckdb')
    const { maskSecret } = await import('@main/lib/secrets/mask')
    await buildSnapshot({ source, secrets: async () => [LEAK, QUOTE] })

    const rows = await runQuery(
      "select body, attributes::varchar as a from logs where scope.name = 'database'"
    )
    const text = JSON.stringify(rows.rows)
    expect(text).not.toContain('LOGGED-secret-value')
    expect(text).not.toContain('LOGGED-5a4b3c2d')
    expect(text).toContain(maskSecret(LEAK)!)
    const { readFileSync } = await import('fs')
    const file = readFileSync(join(analyticsDir, 'actovia.duckdb'))
    expect(file.includes(Buffer.from(LEAK))).toBe(false)
  }, 60_000)

  // Re-review S2 N3: the logs table is optional. If the current secrets
  // cannot be read, the rebuild goes on without it rather than failing, and
  // never copies the logs unscrubbed.
  it('rebuilds without the logs table when the secrets cannot be read', async () => {
    const { buildSnapshot } = await import('@main/lib/analytics/snapshot')
    const { runQuery } = await import('@main/lib/analytics/duckdb')
    const { logger } = await import('@main/lib/logger')
    const meta = await buildSnapshot({
      source,
      secrets: async () => {
        throw new Error('settings unreadable')
      }
    })
    expect(meta.logsIncluded).toBe(false)
    await expect(runQuery('select count(*) from logs')).rejects.toThrow()
    expect(
      (await runQuery('select count(*) as n from messages')).rows[0].n
    ).toBe(3)
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toMatch(/logs/u)
    // The group tables are there, and empty: nothing is copied unmasked.
    expect(
      (await runQuery('select count(*) as n from group_messages')).rows[0].n
    ).toBe(0)
    expect(
      (await runQuery('select count(*) as n from pm_round_events')).rows[0].n
    ).toBe(0)
  }, 60_000)

  it('copies group messages and PM round events, masked, and answers pmDecisions', async () => {
    const { buildSnapshot } = await import('@main/lib/analytics/snapshot')
    const { runQuery } = await import('@main/lib/analytics/duckdb')
    const { maskSecret } = await import('@main/lib/secrets/mask')
    await buildSnapshot({ source, secrets: async () => [GROUP_SECRET] })

    expect(
      (await runQuery('select count(*) as n from group_messages')).rows[0].n
    ).toBe(2)
    const msgs = await runQuery(
      "select text from group_messages where role = 'employee'"
    )
    expect(JSON.stringify(msgs.rows)).not.toContain('LEAKED')
    expect(msgs.rows[0].text).toContain(maskSecret(GROUP_SECRET)!)

    const ev = await runQuery(
      'select tool_name, payload::varchar as p from pm_round_events order by seq'
    )
    expect(ev.rows).toHaveLength(8)
    expect(JSON.stringify(ev.rows)).not.toContain('LEAKED')
    expect(ev.rows[1].tool_name).toBe('delegateTask')
    expect(ev.rows[0].tool_name).toBeNull()

    const preset = CHAT_AUDIT_PRESETS.find((p) => p.id === 'pmDecisions')
    expect(preset).toBeDefined()
    const out = await runQuery(preset!.sql)
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({
      round_id: ROUND,
      delegations: 1,
      refused: 0,
      // A refused wait waited for nothing.
      waits: 1,
      input_tokens: 900,
      output_tokens: 70,
      cost_usd: 0.0123
    })
  }, 60_000)
})
