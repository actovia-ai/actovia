import {
  healthSnapshotSchema,
  healthSummarySchema,
  parseHealthSummary
} from '@actovia/shared/types/health'
import { describe, expect, it } from 'vitest'

import { REPORT, SNAPSHOT, SUMMARY } from './health-fixtures'

describe('healthSnapshotSchema', () => {
  it('accepts the spec example', () => {
    expect(healthSnapshotSchema.parse(SNAPSHOT)).toEqual(SNAPSHOT)
  })

  it('accepts a category that is null or absent', () => {
    const { body: _b, ...withoutBody } = SNAPSHOT
    expect(
      healthSnapshotSchema.safeParse({ ...SNAPSHOT, sleep: null }).success
    ).toBe(true)
    expect(healthSnapshotSchema.safeParse(withoutBody).success).toBe(true)
  })

  it('rejects fields it does not know (no raw samples sneak in)', () => {
    const r = healthSnapshotSchema.safeParse({
      ...SNAPSHOT,
      samples: [{ v: 1 }]
    })
    expect(r.success).toBe(false)
  })

  it('rejects a bad date and an unknown Ody state', () => {
    expect(
      healthSnapshotSchema.safeParse({ ...SNAPSHOT, date: '1/10/2026' }).success
    ).toBe(false)
    expect(
      healthSnapshotSchema.safeParse({ ...SNAPSHOT, odyState: 'sad' }).success
    ).toBe(false)
  })
})

describe('healthSummarySchema', () => {
  it('accepts the spec example and a null suggestion', () => {
    expect(healthSummarySchema.parse(SUMMARY)).toEqual(SUMMARY)
    expect(
      healthSummarySchema.safeParse({ ...SUMMARY, memorySuggestion: null })
        .success
    ).toBe(true)
  })

  it('only suggests profile memories with a kebab-case key', () => {
    const bad = {
      ...SUMMARY,
      memorySuggestion: { section: 'topic', key: 'x', summary: 'y' }
    }
    expect(healthSummarySchema.safeParse(bad).success).toBe(false)
    const badKey = {
      ...SUMMARY,
      memorySuggestion: { ...SUMMARY.memorySuggestion, key: 'Weekday Sleep' }
    }
    expect(healthSummarySchema.safeParse(badKey).success).toBe(false)
  })
})

describe('parseHealthSummary', () => {
  it('keeps a long headline in a wordy language', () => {
    const sixty = 'Wenig Schlaf, aber dein Herz hat sich erholt – geh spazieren'
    expect(sixty).toHaveLength(60)
    expect(parseHealthSummary({ ...SUMMARY, headline: sixty })?.headline).toBe(
      sixty
    )
  })

  it('drops a bad suggestion but keeps the report', () => {
    const r = parseHealthSummary({
      ...SUMMARY,
      memorySuggestion: { section: 'topic', key: 'Bad Key', summary: '' }
    })
    expect(r).not.toBeNull()
    expect(r?.memorySuggestion).toBeNull()
    expect(r?.headline).toBe(SUMMARY.headline)
  })

  it('still rejects a bad report', () => {
    expect(parseHealthSummary({ ...SUMMARY, headline: '' })).toBeNull()
    expect(parseHealthSummary('not an object')).toBeNull()
    expect(parseHealthSummary(null)).toBeNull()
  })
})

const insight = (i: number) => REPORT.insights[i]

describe('parseHealthSummary — structured report', () => {
  it('keeps a valid structured report and fills in the summary', () => {
    const r = parseHealthSummary(REPORT)
    expect(r).not.toBeNull()
    expect(r?.headlineHighlight).toBe('有點沒睡飽')
    expect(r?.headlineCategory).toBe('sleep')
    expect(r?.insights).toEqual(REPORT.insights)
    expect(r?.nudge).toBe(REPORT.nudge)
    expect(r?.summary).toBe(
      [
        REPORT.headline,
        '昨晚只睡了 **6 小時 12 分**，比平時少了將近一小時。',
        'HRV **38 ms**，低於你的 44 基線，**身體還在恢復**。',
        '今天走了 **5,840 步**，離 8,000 的目標還差 2,160 步。'
      ].join('\n\n')
    )
  })

  it("keeps the model's own summary when it wrote one", () => {
    expect(parseHealthSummary({ ...REPORT, summary: 'Mine.' })?.summary).toBe(
      'Mine.'
    )
  })

  it('drops a highlight that is not in its sentence, keeps the insight', () => {
    const r = parseHealthSummary({
      ...REPORT,
      insights: [{ ...insight(0), highlights: ['6 小時 12 分', '7 小時'] }]
    })
    expect(r?.insights).toEqual([
      { ...insight(0), highlights: ['6 小時 12 分'] }
    ])
  })

  it('drops a headline highlight that is not in the headline, with its category', () => {
    const r = parseHealthSummary({ ...REPORT, headlineHighlight: '睡得很好' })
    expect(r).not.toBeNull()
    expect(r?.headlineHighlight).toBeUndefined()
    expect(r?.headlineCategory).toBeUndefined()
    const badCategory = parseHealthSummary({
      ...REPORT,
      headlineCategory: 'mood'
    })
    expect(badCategory?.headlineHighlight).toBeUndefined()
    expect(badCategory?.headlineCategory).toBeUndefined()
  })

  it('drops a second insight for the same category and keeps the order', () => {
    const r = parseHealthSummary({
      ...REPORT,
      insights: [insight(0), { ...insight(2), category: 'sleep' }, insight(1)]
    })
    expect(r?.insights?.map((i) => i.category)).toEqual(['sleep', 'recovery'])
  })

  it('drops an insight that is too long or has an unknown category', () => {
    const r = parseHealthSummary({
      ...REPORT,
      insights: [
        { ...insight(0), text: 'x'.repeat(161), highlights: [] },
        { ...insight(1), category: 'mood' },
        insight(2)
      ]
    })
    expect(r?.insights?.map((i) => i.category)).toEqual(['activity'])
  })

  it('drops a bad stat but keeps its insight', () => {
    const r = parseHealthSummary({
      ...REPORT,
      insights: [{ ...insight(0), stat: { value: '1234567890123', unit: 'h' } }]
    })
    expect(r?.insights?.[0].text).toBe(insight(0).text)
    expect(r?.insights?.[0].stat).toBeUndefined()
  })

  it('keeps at most three highlights', () => {
    const r = parseHealthSummary({
      ...REPORT,
      insights: [
        { ...insight(1), highlights: ['HRV', '38 ms', '44', '身體還在恢復'] }
      ]
    })
    expect(r?.insights?.[0].highlights).toEqual(['HRV', '38 ms', '44'])
  })

  it('drops a nudge that is too long', () => {
    const r = parseHealthSummary({ ...REPORT, nudge: 'x'.repeat(141) })
    expect(r).not.toBeNull()
    expect(r?.nudge).toBeUndefined()
  })

  it('rejects a structured report whose insights all fail', () => {
    expect(
      parseHealthSummary({
        ...REPORT,
        insights: [{ ...insight(0), category: 'mood' }]
      })
    ).toBeNull()
    expect(parseHealthSummary({ ...REPORT, insights: [] })).toBeNull()
  })

  it('still accepts the old shape (summary only)', () => {
    const r = parseHealthSummary(SUMMARY)
    expect(r).toEqual(SUMMARY)
    expect(r?.insights).toBeUndefined()
  })

  it('reads "insights": null as the old shape', () => {
    const r = parseHealthSummary({ ...SUMMARY, insights: null })
    expect(r).not.toBeNull()
    expect(r && 'insights' in r).toBe(false)
  })

  it('rejects a report with neither insights nor a summary', () => {
    const { summary: _s, ...bare } = SUMMARY
    expect(parseHealthSummary(bare)).toBeNull()
  })
})
