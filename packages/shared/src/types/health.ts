// The phone's daily health snapshot (aggregates only — never raw samples) and
// the report the desktop writes from it. actovia-ios mirrors both in
// Sources/Models/HealthWire.swift.
import { z } from 'zod'

const hhmm = z.string().regex(/^\d{2}:\d{2}$/)
const count = z.number().int().nonnegative()

export const odyStateSchema = z.enum([
  'permission',
  'noData',
  'tired',
  'recovering',
  'active',
  'rested',
  'calm',
  'happy'
])

export const moodLabelSchema = z.enum([
  'veryUnpleasant',
  'unpleasant',
  'slightlyUnpleasant',
  'neutral',
  'slightlyPleasant',
  'pleasant',
  'veryPleasant'
])

export const healthSnapshotSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    localTime: hhmm,
    locale: z.string().min(2).max(16),
    sleep: z
      .object({
        asleepMin: count,
        baselineMin: count.nullish(),
        deepMin: count,
        coreMin: count,
        remMin: count,
        awakeMin: count,
        bedtime: hhmm,
        wake: hhmm
      })
      .strict()
      .nullish(),
    activity: z
      .object({
        steps: count,
        stepGoal: count,
        activeKcal: count,
        kcalGoal: count.nullish(),
        exerciseMin: count,
        standHours: count,
        workouts: z
          .array(
            z
              .object({
                type: z.string().max(40),
                minutes: count,
                kcal: count.nullish()
              })
              .strict()
          )
          .max(20)
      })
      .strict()
      .nullish(),
    recovery: z
      .object({
        level: z.enum(['good', 'fair', 'low']).nullish(),
        hrvMs: z.number().nonnegative().nullish(),
        hrvBaselineMs: z.number().nonnegative().nullish(),
        restingHr: z.number().nonnegative().nullish(),
        restingHrBaseline: z.number().nonnegative().nullish(),
        respRate: z.number().nonnegative().nullish()
      })
      .strict()
      .nullish(),
    body: z
      .object({
        waterCups: count,
        weightKg: z.number().nonnegative().nullish(),
        weightTrend30d: z.number().nullish(),
        mood: moodLabelSchema.nullish()
      })
      .strict()
      .nullish(),
    odyState: odyStateSchema
  })
  .strict()

const line = z.string().min(1).max(200).nullable()

export const healthCategorySchema = z.enum([
  'sleep',
  'activity',
  'recovery',
  'body'
])

export const healthStatSchema = z
  .object({
    value: z.string().min(1).max(12),
    unit: z.string().min(1).max(16),
    caption: z.string().min(1).max(40).optional()
  })
  .strict()

export const healthInsightSchema = z
  .object({
    category: healthCategorySchema,
    text: z.string().min(1).max(160),
    // Exact substrings of `text`; the phone colours them.
    highlights: z.array(z.string().min(1).max(40)).max(3),
    stat: healthStatSchema.optional()
  })
  .strict()

export const healthSummarySchema = z.object({
  // The prompt asks for 60; the slack keeps a slightly long headline in a wordy language.
  headline: z.string().min(1).max(80),
  // An exact substring of `headline`, coloured as `headlineCategory`.
  headlineHighlight: z.string().min(1).max(80).optional(),
  headlineCategory: healthCategorySchema.optional(),
  // Most important first, at most one per category. Absent only in reports from before the redesign.
  insights: z.array(healthInsightSchema).min(1).max(4).optional(),
  nudge: z.string().min(1).max(140).optional(),
  // Markdown for phones that predate `insights`; the desktop builds it when the model leaves it out.
  summary: z.string().min(1).max(1200),
  categories: z.object({
    sleep: line,
    activity: line,
    recovery: line,
    body: line
  }),
  memorySuggestion: z
    .object({
      section: z.literal('profile'),
      key: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(48),
      summary: z.string().min(1).max(120)
    })
    .nullable()
})

export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>
export type HealthSummary = z.infer<typeof healthSummarySchema>
export type HealthInsight = z.infer<typeof healthInsightSchema>

type Loose = Record<string, unknown>
const isObject = (v: unknown): v is Loose =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function normaliseInsight(raw: unknown): HealthInsight | null {
  if (!isObject(raw) || typeof raw.text !== 'string') return null
  const text = raw.text
  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .filter(
      (h): h is string =>
        typeof h === 'string' &&
        h.length > 0 &&
        h.length <= 40 &&
        text.includes(h)
    )
    .slice(0, 3)
  const stat = healthStatSchema.safeParse(raw.stat)
  const insight = healthInsightSchema.safeParse({
    category: raw.category,
    text,
    highlights,
    ...(stat.success ? { stat: stat.data } : {})
  })
  return insight.success ? insight.data : null
}

/** The insight with its highlights in bold, for the Markdown `summary`. Overlapping highlights keep the first. */
function boldHighlights({ text, highlights }: HealthInsight): string {
  const ranges: Array<[number, number]> = []
  for (const h of highlights) {
    const start = text.indexOf(h)
    const end = start + h.length
    if (ranges.some(([s, e]) => start < e && s < end)) continue
    ranges.push([start, end])
  }
  ranges.sort((a, b) => b[0] - a[0])
  let out = text
  for (const [s, e] of ranges)
    out = `${out.slice(0, s)}**${out.slice(s, e)}**${out.slice(e)}`
  return out
}

/**
 * Brings a structured report into shape: what can't be trusted (a highlight that isn't in its sentence, a stat
 * too long, a second insight for one category) is dropped on its own rather than failing the report. Returns
 * null when insights were given but none survive.
 */
function normaliseStructured(value: Loose): Loose | null {
  if (value.insights === null || value.insights === undefined) {
    // An explicit null is the older shape too; the schema's optional() takes absent, not null.
    const { insights: _absent, ...older } = value
    return older
  }
  const seen = new Set<string>()
  const insights: HealthInsight[] = []
  for (const raw of Array.isArray(value.insights) ? value.insights : []) {
    const insight = normaliseInsight(raw)
    if (!insight || seen.has(insight.category)) continue
    seen.add(insight.category)
    insights.push(insight)
  }
  if (insights.length === 0) return null

  const { headlineHighlight, headlineCategory, nudge, summary, ...rest } = value
  const headline = typeof value.headline === 'string' ? value.headline : ''
  const highlightOk =
    typeof headlineHighlight === 'string' &&
    headlineHighlight.length > 0 &&
    headline.includes(headlineHighlight) &&
    healthCategorySchema.safeParse(headlineCategory).success
  const nudgeOk =
    typeof nudge === 'string' && nudge.length > 0 && nudge.length <= 140
  return {
    ...rest,
    insights: insights.slice(0, 4),
    ...(highlightOk ? { headlineHighlight, headlineCategory } : {}),
    ...(nudgeOk ? { nudge } : {}),
    summary:
      typeof summary === 'string' &&
      summary.length > 0 &&
      summary.length <= 1200
        ? summary
        : [headline, ...insights.map((i) => boldHighlights(i))].join('\n\n')
  }
}

/**
 * Reads a model's report. Optional parts (a suggestion, a highlight, a stat, a nudge, one insight among several)
 * that are malformed are dropped rather than failing the whole report; anything else wrong is still a failure
 * (null). A report without `insights` is the older shape and is accepted on its `summary` alone.
 */
export function parseHealthSummary(value: unknown): HealthSummary | null {
  if (!isObject(value)) return null
  const normalised = normaliseStructured(value)
  if (!normalised) return null
  const parsed = healthSummarySchema.safeParse(normalised)
  if (parsed.success) return parsed.data
  const withoutSuggestion = healthSummarySchema.safeParse({
    ...normalised,
    memorySuggestion: null
  })
  return withoutSuggestion.success ? withoutSuggestion.data : null
}

// ── Period reports (actovia-ios trends, phase 2) ─────────────────────────────
// A finished week, month, quarter or year: the phone sends that period's
// aggregates (and the period before's), the daily notes it kept, and the
// habits it tracks; the desktop answers with the report and keeps nothing.
// actovia-ios mirrors both in Sources/HealthFeature/Report/PeriodReport.swift
// and PeriodReportInput.swift.

const wireDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const dayCount = count.max(366)

export const periodKindSchema = z.enum(['week', 'month', 'quarter', 'year'])

// `end` is the period's last day, inclusive.
export const reportPeriodSchema = z
  .object({ kind: periodKindSchema, start: wireDay, end: wireDay })
  .strict()

// One number over the period; the phone leaves out what it has not got.
const metricSummarySchema = z
  .object({
    average: z.number().nullish(),
    min: z.number().nullish(),
    max: z.number().nullish(),
    days: dayCount
  })
  .strict()

export const periodAggregatesSchema = z
  .object({
    elapsedDays: dayCount,
    daysWithData: dayCount,
    sleepMin: metricSummarySchema,
    steps: metricSummarySchema,
    exerciseMin: metricSummarySchema,
    hrvMs: metricSummarySchema,
    restingHr: metricSummarySchema,
    waterCups: metricSummarySchema,
    stepGoalRate: z.number().min(0).max(1).nullish(),
    sleepTargetRate: z.number().min(0).max(1).nullish()
  })
  .strict()

export const habitKindSchema = z.enum([
  'steps',
  'sleep',
  'bedtime',
  'exercise',
  'water'
])

export const periodReportRequestSchema = z
  .object({
    period: reportPeriodSchema,
    current: periodAggregatesSchema,
    previous: periodAggregatesSchema.nullish(),
    notes: z
      .array(
        z
          .object({
            day: wireDay,
            headline: z.string().min(1).max(120),
            insights: z
              .array(
                z
                  .object({
                    category: z.string().min(1).max(20),
                    title: z.string().min(1).max(200)
                  })
                  .strict()
              )
              .max(4)
          })
          .strict()
      )
      .max(366),
    // A bedtime target is minutes after midnight.
    habits: z
      .array(
        z
          .object({
            kind: habitKindSchema,
            target: z.number().nonnegative(),
            daysHit: dayCount,
            streak: dayCount,
            dayOfTwentyOne: z.number().int().min(1).max(21)
          })
          .strict()
      )
      .max(3),
    locale: z.string().min(2).max(16)
  })
  .strict()

export const periodMetricSchema = z.enum([
  'sleep',
  'steps',
  'exercise',
  'hrv',
  'restingHr',
  'water'
])

export const periodInsightSchema = z
  .object({
    category: healthCategorySchema,
    title: z.string().min(1).max(160),
    // Exact substrings of `title`; the phone colours them.
    highlights: z.array(z.string().min(1).max(40)).max(3),
    stat: healthStatSchema.optional()
  })
  .strict()

export const periodComparisonSchema = z
  .object({
    metric: periodMetricSchema,
    current: z.string().min(1).max(24),
    previous: z.string().min(1).max(24).nullable(),
    direction: z.enum(['up', 'down', 'flat'])
  })
  .strict()

export const periodReportSchema = z
  .object({
    period: reportPeriodSchema,
    headline: z.string().min(1).max(80),
    headlineHighlight: z.string().min(1).max(80).optional(),
    headlineCategory: healthCategorySchema.optional(),
    // Empty when none survived: the report is then its headline.
    insights: z.array(periodInsightSchema).max(5),
    comparisons: z.array(periodComparisonSchema).max(6),
    nudge: z.string().min(1).max(140).optional()
  })
  .strict()

export type PeriodReportRequest = z.infer<typeof periodReportRequestSchema>
export type PeriodAggregates = z.infer<typeof periodAggregatesSchema>
export type PeriodMetric = z.infer<typeof periodMetricSchema>
export type PeriodReport = z.infer<typeof periodReportSchema>
export type PeriodInsight = z.infer<typeof periodInsightSchema>
export type PeriodComparison = z.infer<typeof periodComparisonSchema>

const AGGREGATE_OF: Record<
  PeriodMetric,
  'sleepMin' | 'steps' | 'exerciseMin' | 'hrvMs' | 'restingHr' | 'waterCups'
> = {
  sleep: 'sleepMin',
  steps: 'steps',
  exercise: 'exerciseMin',
  hrv: 'hrvMs',
  restingHr: 'restingHr',
  water: 'waterCups'
}

/** A metric's average over a period; null when it was not recorded. */
export function periodAverage(
  a: PeriodAggregates | null | undefined,
  metric: PeriodMetric
): number | null {
  const v = a?.[AGGREGATE_OF[metric]]?.average
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Which way a number moved, as the phone's TrendMath reads it: under 3 % either way is flat. */
export function periodDirection(
  current: number,
  previous: number
): 'up' | 'down' | 'flat' {
  if (previous === 0)
    return current === 0 ? 'flat' : current > 0 ? 'up' : 'down'
  const relative = (current - previous) / Math.abs(previous)
  if (Math.abs(relative) < 0.03) return 'flat'
  return relative > 0 ? 'up' : 'down'
}

function normalisePeriodInsight(raw: unknown): PeriodInsight | null {
  if (!isObject(raw) || typeof raw.title !== 'string') return null
  const title = raw.title
  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .filter(
      (h): h is string =>
        typeof h === 'string' &&
        h.length > 0 &&
        h.length <= 40 &&
        title.includes(h)
    )
    .slice(0, 3)
  const stat = healthStatSchema.safeParse(raw.stat)
  const insight = periodInsightSchema.safeParse({
    category: raw.category,
    title,
    highlights,
    ...(stat.success ? { stat: stat.data } : {})
  })
  return insight.success ? insight.data : null
}

/**
 * A comparison the request backs: its metric has an average this period and the period before, and its direction
 * is worked out from those averages — the model's own is never trusted.
 */
function normaliseComparison(
  raw: unknown,
  request: PeriodReportRequest
): PeriodComparison | null {
  if (!isObject(raw)) return null
  const metric = periodMetricSchema.safeParse(raw.metric)
  if (!metric.success) return null
  const current = periodAverage(request.current, metric.data)
  const before = periodAverage(request.previous, metric.data)
  if (current === null || before === null) return null
  const parsed = periodComparisonSchema.safeParse({
    metric: metric.data,
    current: raw.current,
    previous: raw.previous ?? null,
    direction: periodDirection(current, before)
  })
  return parsed.success ? parsed.data : null
}

/**
 * Reads a model's period report against the request it answers. What can't be trusted is dropped on its own — an
 * insight it can't draw, a highlight not in its sentence, a comparison the numbers don't back, a headline phrase or
 * nudge out of shape — and a report whose insights all fall away is still its headline. Null only without a usable
 * headline. The period is always the request's.
 */
export function parsePeriodReport(
  value: unknown,
  request: PeriodReportRequest
): PeriodReport | null {
  if (!isObject(value) || typeof value.headline !== 'string') return null
  const headline = value.headline.trim()
  const insights = (Array.isArray(value.insights) ? value.insights : [])
    .map(normalisePeriodInsight)
    .filter((i): i is PeriodInsight => i !== null)
    .slice(0, 5)
  const seen = new Set<PeriodMetric>()
  const comparisons: PeriodComparison[] = []
  for (const raw of Array.isArray(value.comparisons) ? value.comparisons : []) {
    const c = normaliseComparison(raw, request)
    if (!c || seen.has(c.metric)) continue
    seen.add(c.metric)
    comparisons.push(c)
  }
  const { headlineHighlight, headlineCategory, nudge } = value
  const highlightOk =
    typeof headlineHighlight === 'string' &&
    headlineHighlight.length > 0 &&
    headline.includes(headlineHighlight) &&
    healthCategorySchema.safeParse(headlineCategory).success
  const nudgeOk =
    typeof nudge === 'string' && nudge.length > 0 && nudge.length <= 140
  const parsed = periodReportSchema.safeParse({
    period: request.period,
    headline,
    ...(highlightOk ? { headlineHighlight, headlineCategory } : {}),
    insights,
    comparisons: comparisons.slice(0, 6),
    ...(nudgeOk ? { nudge } : {})
  })
  return parsed.success ? parsed.data : null
}
