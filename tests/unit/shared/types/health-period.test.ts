import {
  parsePeriodReport,
  periodDirection,
  periodReportRequestSchema,
  periodReportSchema
} from '@actovia/shared/types/health'
import { describe, expect, it } from 'vitest'

import { PERIOD_REPORT, PERIOD_REQUEST } from './health-period-fixtures'

const REQUEST = periodReportRequestSchema.parse(PERIOD_REQUEST)

describe('periodReportRequestSchema', () => {
  it('accepts the fixture the phone also encodes', () => {
    expect(periodReportRequestSchema.parse(PERIOD_REQUEST)).toEqual(
      PERIOD_REQUEST
    )
  })

  it('takes no period before, as null or left out', () => {
    const { previous: _p, ...withoutPrevious } = PERIOD_REQUEST
    expect(
      periodReportRequestSchema.safeParse({ ...PERIOD_REQUEST, previous: null })
        .success
    ).toBe(true)
    expect(periodReportRequestSchema.safeParse(withoutPrevious).success).toBe(
      true
    )
  })

  it('rejects fields it does not know, at any depth (no raw samples sneak in)', () => {
    const bad = [
      { ...PERIOD_REQUEST, samples: [] },
      { ...PERIOD_REQUEST, current: { ...PERIOD_REQUEST.current, raw: [1] } },
      {
        ...PERIOD_REQUEST,
        notes: [{ ...PERIOD_REQUEST.notes[0], snapshot: {} }]
      }
    ]
    for (const body of bad)
      expect(periodReportRequestSchema.safeParse(body).success).toBe(false)
  })

  it('rejects an N-day window, too many notes or habits, and an oversized note', () => {
    const note = PERIOD_REQUEST.notes[0]
    const habit = {
      kind: 'steps',
      target: 8000,
      daysHit: 5,
      streak: 3,
      dayOfTwentyOne: 9
    }
    const bad = [
      { ...PERIOD_REQUEST, period: { ...PERIOD_REQUEST.period, kind: 'days' } },
      { ...PERIOD_REQUEST, notes: Array.from({ length: 367 }, () => note) },
      { ...PERIOD_REQUEST, habits: [habit, habit, habit, habit] },
      { ...PERIOD_REQUEST, notes: [{ ...note, headline: 'x'.repeat(121) }] },
      {
        ...PERIOD_REQUEST,
        notes: [
          { ...note, insights: [{ category: 'sleep', title: 'x'.repeat(201) }] }
        ]
      }
    ]
    for (const body of bad)
      expect(periodReportRequestSchema.safeParse(body).success).toBe(false)
    expect(
      periodReportRequestSchema.safeParse({
        ...PERIOD_REQUEST,
        habits: [habit]
      }).success
    ).toBe(true)
  })
})

describe('periodDirection', () => {
  it('reads under 3 % either way as flat, like the phone', () => {
    expect(periodDirection(432, 407)).toBe('up')
    expect(periodDirection(7040, 8000)).toBe('down')
    expect(periodDirection(44, 43)).toBe('flat')
    expect(periodDirection(97.1, 100)).toBe('flat')
    expect(periodDirection(96.9, 100)).toBe('down')
  })

  it('compares against zero by sign', () => {
    expect(periodDirection(5, 0)).toBe('up')
    expect(periodDirection(0, 0)).toBe('flat')
  })
})

describe('parsePeriodReport', () => {
  it('reads the model report and takes the period from the request', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        period: { kind: 'year', start: '1999-01-01', end: '1999-12-31' }
      },
      REQUEST
    )
    expect(report?.period).toEqual(PERIOD_REQUEST.period)
    expect(report?.insights).toEqual(PERIOD_REPORT.insights)
    expect(report?.comparisons).toEqual(PERIOD_REPORT.comparisons)
    expect(report?.headlineHighlight).toBe('More sleep')
    expect(report?.nudge).toBe(PERIOD_REPORT.nudge)
    expect(periodReportSchema.safeParse(report).success).toBe(true)
  })

  it('drops an insight it cannot draw and a highlight not in its sentence', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        insights: [
          { ...PERIOD_REPORT.insights[0], highlights: ['7 小時'] },
          { ...PERIOD_REPORT.insights[1], category: 'mood' },
          { title: 42 }
        ]
      },
      REQUEST
    )
    expect(report?.insights).toEqual([
      { ...PERIOD_REPORT.insights[0], highlights: [] }
    ])
  })

  it('is its headline alone when no insight survives', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        insights: [{ category: 'mood', title: 'x', highlights: [] }]
      },
      REQUEST
    )
    expect(report?.headline).toBe(PERIOD_REPORT.headline)
    expect(report?.insights).toEqual([])
  })

  it('works out each direction from the numbers sent, not from the model', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        comparisons: PERIOD_REPORT.comparisons.map((c) => ({
          ...c,
          direction: 'up'
        }))
      },
      REQUEST
    )
    expect(report?.comparisons.map((c) => c.direction)).toEqual([
      'up',
      'down',
      'flat',
      'down'
    ])
  })

  it('drops a comparison the numbers do not back, and a second one for a metric', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        comparisons: [
          ...PERIOD_REPORT.comparisons,
          {
            metric: 'water',
            current: '6 cups',
            previous: '5 cups',
            direction: 'up'
          },
          {
            metric: 'weight',
            current: '70 kg',
            previous: '71 kg',
            direction: 'down'
          },
          { ...PERIOD_REPORT.comparisons[0], current: '9 h' }
        ]
      },
      REQUEST
    )
    expect(report?.comparisons.map((c) => c.metric)).toEqual([
      'sleep',
      'steps',
      'hrv',
      'restingHr'
    ])
    expect(report?.comparisons[0].current).toBe('7 h 12 min')
  })

  it('has no comparisons without a period before', () => {
    const report = parsePeriodReport(PERIOD_REPORT, {
      ...REQUEST,
      previous: null
    })
    expect(report?.comparisons).toEqual([])
    expect(report?.insights).toHaveLength(3)
  })

  it('drops a headline phrase not in the headline and a nudge too long', () => {
    const report = parsePeriodReport(
      {
        ...PERIOD_REPORT,
        headlineHighlight: 'Less sleep',
        nudge: 'x'.repeat(141)
      },
      REQUEST
    )
    expect(report?.headline).toBe(PERIOD_REPORT.headline)
    expect(report?.headlineHighlight).toBeUndefined()
    expect(report?.headlineCategory).toBeUndefined()
    expect(report?.nudge).toBeUndefined()
  })

  it('fails without a usable headline', () => {
    expect(
      parsePeriodReport({ ...PERIOD_REPORT, headline: '' }, REQUEST)
    ).toBeNull()
    expect(
      parsePeriodReport({ ...PERIOD_REPORT, headline: 'x'.repeat(81) }, REQUEST)
    ).toBeNull()
    expect(
      parsePeriodReport({ insights: PERIOD_REPORT.insights }, REQUEST)
    ).toBeNull()
    expect(parsePeriodReport('not json', REQUEST)).toBeNull()
  })
})
