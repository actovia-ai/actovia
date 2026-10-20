import {
  buildLogHistogram,
  levelOfSeverity,
  matchesLogQuery,
  MAX_BUCKETS,
  parseLogQuery
} from '@actovia/shared/utils/log-query'
import { describe, expect, it } from 'vitest'

const rec = (over: Partial<Parameters<typeof matchesLogQuery>[0]> = {}) => ({
  body: 'Hono is running on 60223',
  scope: { name: 'server' },
  attributes: {},
  ...over
})

describe('parseLogQuery', () => {
  it('reads words, phrases, exclusions and the two fields', () => {
    expect(
      parseLogQuery(
        'Timeout "inventory service" -healthcheck scope:chat trace:4bf9'
      )
    ).toEqual({
      terms: ['timeout', 'inventory service'],
      excludes: ['healthcheck'],
      scope: 'chat',
      trace: '4bf9'
    })
  })

  it('searches an unknown field as it was typed', () => {
    expect(parseLogQuery('env:production https://x.dev')).toEqual({
      terms: ['env:production', 'https://x.dev'],
      excludes: []
    })
  })

  it('reads nothing from nothing', () => {
    expect(parseLogQuery('')).toEqual({ terms: [], excludes: [] })
    expect(parseLogQuery()).toEqual({ terms: [], excludes: [] })
    expect(parseLogQuery('   scope:  ""')).toEqual({ terms: [], excludes: [] })
  })

  it('tolerates an unclosed quote', () => {
    expect(parseLogQuery('"half typed').terms).toEqual(['half typed'])
  })
})

describe('matchesLogQuery', () => {
  it('needs every word, in the message, the scope or the attributes', () => {
    const r = rec({ attributes: { chatId: 'c-42' } })
    expect(matchesLogQuery(r, parseLogQuery('hono 60223'))).toBe(true)
    expect(matchesLogQuery(r, parseLogQuery('server c-42'))).toBe(true)
    expect(matchesLogQuery(r, parseLogQuery('hono missing'))).toBe(false)
  })

  it('leaves out a line with an excluded word', () => {
    expect(matchesLogQuery(rec(), parseLogQuery('-hono'))).toBe(false)
    expect(matchesLogQuery(rec(), parseLogQuery('-nothing'))).toBe(true)
  })

  it('matches a scope and every scope under it', () => {
    const q = parseLogQuery('scope:renderer')
    expect(matchesLogQuery(rec({ scope: { name: 'renderer' } }), q)).toBe(true)
    expect(matchesLogQuery(rec({ scope: { name: 'renderer/route' } }), q)).toBe(
      true
    )
    expect(matchesLogQuery(rec({ scope: { name: 'renderer-x' } }), q)).toBe(
      false
    )
  })

  it('matches a trace by its first characters, origin included', () => {
    const q = parseLogQuery('trace:abcd')
    expect(matchesLogQuery(rec({ traceId: 'abcdef12' }), q)).toBe(true)
    expect(matchesLogQuery(rec({ originTraceId: 'abcd9999' }), q)).toBe(true)
    expect(matchesLogQuery(rec({ traceId: 'ffff' }), q)).toBe(false)
    expect(matchesLogQuery(rec(), q)).toBe(false)
  })
})

describe('levelOfSeverity', () => {
  it('maps OpenTelemetry severity numbers to the four levels', () => {
    expect([5, 9, 13, 17, 21].map(levelOfSeverity)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'error'
    ])
  })
})

describe('buildLogHistogram', () => {
  const at = (iso: string, severityNumber = 9) => ({
    timestamp: iso,
    severityNumber
  })

  it('is empty without records', () => {
    expect(buildLogHistogram([])).toEqual({ bucketMinutes: 1, buckets: [] })
  })

  it('counts by level per minute over a short span, gaps kept', () => {
    const h = buildLogHistogram([
      at('2026-10-09T08:00:10.000Z', 17),
      at('2026-10-09T08:00:50.000Z', 9),
      at('2026-10-09T08:03:00.000Z', 13)
    ])
    expect(h.bucketMinutes).toBe(1)
    expect(h.buckets.map((b) => [b.error, b.warn, b.info, b.debug])).toEqual([
      [1, 0, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 1, 0, 0]
    ])
    expect(h.buckets[0].start).toBe('2026-10-09T08:00:00.000Z')
  })

  it('widens the buckets to keep the chart within its bar count', () => {
    const h = buildLogHistogram([
      at('2026-10-09T00:00:00.000Z'),
      at('2026-10-09T23:59:00.000Z')
    ])
    expect(h.bucketMinutes).toBe(30)
    expect(h.buckets.length).toBeLessThanOrEqual(MAX_BUCKETS)
    expect(h.buckets.reduce((n, b) => n + b.info, 0)).toBe(2)
  })

  it('skips an unreadable timestamp', () => {
    const h = buildLogHistogram([at('nope'), at('2026-10-09T08:00:00.000Z')])
    expect(h.buckets).toHaveLength(1)
    expect(h.buckets[0].info).toBe(1)
  })
})
