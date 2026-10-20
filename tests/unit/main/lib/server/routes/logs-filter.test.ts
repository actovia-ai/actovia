import type { LogRecord } from '@main/lib/logger'
import {
  filterRecords,
  minSeverityFromLevel
} from '@main/lib/server/routes/logs-filter'
import { describe, expect, it } from 'vitest'

const rec = (over: Partial<LogRecord> = {}): LogRecord =>
  ({
    timestamp: '2026-09-06T00:00:00.000Z',
    severityNumber: 9,
    severityText: 'INFO',
    body: 'hello world',
    scope: { name: 'chat' },
    attributes: {},
    resource: {} as LogRecord['resource'],
    ...over
  }) as LogRecord

describe('minSeverityFromLevel', () => {
  it('maps level names to their severity floor', () => {
    expect(minSeverityFromLevel('debug')).toBe(5)
    expect(minSeverityFromLevel('warn')).toBe(13)
    expect(minSeverityFromLevel('error')).toBe(17)
    expect(minSeverityFromLevel('bogus')).toBe(0)
    expect(minSeverityFromLevel()).toBe(0)
  })
})

describe('filterRecords', () => {
  it('filters by minimum severity', () => {
    const out = filterRecords(
      [rec({ severityNumber: 9 }), rec({ severityNumber: 17 })],
      { minSeverity: minSeverityFromLevel('warn') }
    )
    expect(out).toHaveLength(1)
    expect(out[0].severityNumber).toBe(17)
  })

  it('filters by scope name', () => {
    expect(
      filterRecords(
        [rec({ scope: { name: 'chat' } }), rec({ scope: { name: 'jobs' } })],
        { scope: 'jobs' }
      )
    ).toHaveLength(1)
  })

  it('filters by body keyword, case-insensitive', () => {
    expect(
      filterRecords([rec({ body: 'Hello World' }), rec({ body: 'nope' })], {
        keyword: 'world'
      })
    ).toHaveLength(1)
  })

  it('filters by exact traceId', () => {
    expect(
      filterRecords([rec({ traceId: 'aaaa' }), rec({ traceId: 'bbbb' })], {
        traceId: 'bbbb'
      })
    ).toHaveLength(1)
  })

  it('combines every filter', () => {
    const out = filterRecords(
      [
        rec({
          severityNumber: 17,
          scope: { name: 'jobs' },
          body: 'boom',
          traceId: 't1'
        }),
        rec({
          severityNumber: 17,
          scope: { name: 'jobs' },
          body: 'boom',
          traceId: 't2'
        }),
        rec({
          severityNumber: 9,
          scope: { name: 'jobs' },
          body: 'boom',
          traceId: 't1'
        })
      ],
      { minSeverity: 13, scope: 'jobs', keyword: 'boom', traceId: 't1' }
    )
    expect(out).toHaveLength(1)
  })

  it('returns everything when no options are set', () => {
    expect(filterRecords([rec(), rec()], {})).toHaveLength(2)
  })
})

describe('levelsFromParam', () => {
  it('reads a comma list, none for a param naming no level', async () => {
    const { levelsFromParam } =
      await import('@main/lib/server/routes/logs-filter')
    expect(levelsFromParam()).toBeUndefined()
    expect([...levelsFromParam('error,warn,bogus')!]).toEqual(['error', 'warn'])
    expect(levelsFromParam('none')!.size).toBe(0)
  })
})

describe('filterRecords — the chart and the search box', () => {
  it('keeps exactly the levels asked for', () => {
    const out = filterRecords(
      [
        rec({ severityNumber: 5 }),
        rec({ severityNumber: 9 }),
        rec({ severityNumber: 17 })
      ],
      { levels: new Set(['error', 'debug'] as const) }
    )
    expect(out.map((r) => r.severityNumber)).toEqual([5, 17])
    expect(filterRecords([rec()], { levels: new Set() })).toEqual([])
  })

  it('keeps a time window, from inclusive and to exclusive', () => {
    const from = Date.parse('2026-09-06T00:00:00.000Z')
    const out = filterRecords(
      [
        rec({ timestamp: '2026-09-06T00:00:00.000Z', body: 'a' }),
        rec({ timestamp: '2026-09-06T00:00:59.999Z', body: 'b' }),
        rec({ timestamp: '2026-09-06T00:01:00.000Z', body: 'c' })
      ],
      { from, to: from + 60_000 }
    )
    expect(out.map((r) => r.body)).toEqual(['a', 'b'])
  })

  it('applies a parsed query', async () => {
    const { parseLogQuery } = await import('@actovia/shared/utils/log-query')
    const out = filterRecords(
      [
        rec({ body: 'tool failed', scope: { name: 'chat' } }),
        rec({ body: 'tool ok', scope: { name: 'chat' } }),
        rec({ body: 'tool failed', scope: { name: 'jobs' } })
      ],
      { query: parseLogQuery('tool -ok scope:chat') }
    )
    expect(out).toHaveLength(1)
    expect(out[0].body).toBe('tool failed')
  })
})
