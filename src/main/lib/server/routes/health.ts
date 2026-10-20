// src/main/lib/server/routes/health.ts
// actovia-ios's Health workspace: one report a day, written from the phone's
// aggregated snapshot, and one for each finished week, month, quarter and
// year, written from that period's aggregates. Stateless — nothing is stored,
// and the logs carry timings, never the numbers.
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { AIError } from '@actovia/shared/errors/app-error'
import {
  healthSnapshotSchema,
  parseHealthSummary,
  parsePeriodReport,
  periodAverage,
  periodReportRequestSchema,
  type HealthSnapshot,
  type PeriodReportRequest
} from '@actovia/shared/types/health'
import { Hono } from 'hono'

import {
  callLlm,
  loadRelevantMemories,
  parseJsonFromResponse
} from '../../ai/memory/manager'
import { getModelFromProvider } from '../../ai/utils/model-util'
import type { MemoryRow } from '../../db/memory-queries'
import { logger } from '../../logger'
import { Variables } from '../types'
import { validateSchema } from '../utils'

export const HEALTH_SUMMARY_SYSTEM = `You write a short, warm daily health note for one person from the numbers you are given. The phone shows it as a headline, a few one-sentence insights, and one small idea; it colours the phrases you mark.
Rules:
- Write in the language named by "locale" (a BCP-47 tag).
- Use only the numbers in the snapshot and quote them exactly. A category that is null has no data: say nothing about it and set its line to null.
- Never diagnose, never name a condition, never give medical advice beyond everyday habits (sleep, walking, water, rest).
- "headline": one short sentence that sets the tone of the day, at most 60 characters.
- "headlineHighlight": the key phrase of the headline, copied verbatim from it (character for character); "headlineCategory" is the category it is about (sleep, activity, recovery or body).
- "insights": 1 to 4, most important first, at most one per category, only for categories with data. Each has:
  - "category": sleep, activity, recovery or body;
  - "text": one sentence, at most 160 characters, built around the numbers that matter;
  - "highlights": 0 to 3 short phrases (at most 40 characters each) copied verbatim from that same "text" — usually the numbers and the verdict;
  - "stat" (optional): the one number of the insight, {"value": at most 12 characters, "unit": at most 16, "caption": a few words of context, at most 40}.
- "nudge": one everyday habit to try today, one sentence, at most 140 characters. No medical advice.
- "categories": one short sentence per category, or null.
- "memorySuggestion": only when the snapshot and the known memories show a lasting pattern worth remembering long-term — never a one-day event, never something the memories already say. Shape: {"section":"profile","key":"kebab-case-key","summary":"one sentence"}. Otherwise null.
Example (for a different person; write your own from the snapshot):
{"headline":"睡得很足，动得有点少。","headlineHighlight":"动得有点少","headlineCategory":"activity","insights":[{"category":"sleep","text":"昨晚睡了 11 小时 22 分，比平时多出将近 5 小时。","highlights":["11 小时 22 分"],"stat":{"value":"11:22","unit":"小时","caption":"比平时 +5h"}},{"category":"recovery","text":"HRV 56.7 ms，高于你的 46.9 基线，身体恢复得不错。","highlights":["56.7 ms","身体恢复得不错"],"stat":{"value":"56.7","unit":"ms HRV","caption":"高于基线 46.9"}},{"category":"activity","text":"今天只走了 1,198 步，离 8,000 的目标还差不少。","highlights":["1,198 步"],"stat":{"value":"1,198","unit":"步","caption":"目标 8,000"}}],"nudge":"傍晚前散步 20 分钟，给这一天收个尾。","categories":{"sleep":"睡得比平时久很多。","activity":"步数离目标还远。","recovery":"HRV 高于基线。","body":null},"memorySuggestion":null}
Respond ONLY with JSON in exactly that shape.`

/** What the memory read-filter is asked about: the day in one line. */
export function memoryQuestion(s: HealthSnapshot): string {
  const parts: string[] = []
  if (s.sleep) parts.push(`sleep ${s.sleep.asleepMin} min`)
  if (s.activity) parts.push(`steps ${s.activity.steps}/${s.activity.stepGoal}`)
  if (s.recovery?.level) parts.push(`recovery ${s.recovery.level}`)
  if (s.body) parts.push(`water ${s.body.waterCups} cups`)
  return `Daily health report. ${parts.join('; ')}`
}

function knownMemories(memories: MemoryRow[]): string {
  return memories.length
    ? memories.map((m) => `- [${m.section}] ${m.key} — ${m.summary}`).join('\n')
    : '(none)'
}

function userText(s: HealthSnapshot, memories: MemoryRow[]): string {
  return `Snapshot:\n${JSON.stringify(s)}\n\nKnown memories:\n${knownMemories(memories)}`
}

export const HEALTH_PERIOD_REPORT_SYSTEM = `You write a short, warm health report about one finished period — a week, a month, a quarter or a year — for one person, from the numbers you are given. The phone shows it like the daily note: a headline, a few insight cards, how each number moved, and one small idea; it colours the phrases you mark.
What you get:
- "period": its kind and its first and last day.
- "current": the period in numbers. Each of sleepMin (minutes a night), steps (a day), exerciseMin (minutes a day), hrvMs (milliseconds), restingHr (beats per minute) and waterCups (cups a day) has its average, lowest and highest, and on how many days it was recorded ("days"; 0 means not recorded). "elapsedDays" is the period's length, "daysWithData" how many days had any number, "stepGoalRate" and "sleepTargetRate" the share of days (0 to 1) at the step goal and at 7 hours of sleep.
- "previous": the same for the period just before, or absent when there is nothing to compare.
- "notes": the daily notes written in the period, oldest first (a headline, and for a week or a month its insight sentences); may be empty.
- "habits": habits the person is building; may be empty.
- "Known memories": what the person has told the assistant; use them for context only, never repeat them.
Rules:
- Write in the language named by "locale" (a BCP-47 tag).
- What matters most is the direction against the person's own past: compare "current" with "previous" wherever both have the number, and say which way it went and by how much; under 3 % either way is "about the same". Without "previous", describe the period on its own.
- Use only these numbers, rounded the way people say them (hours and minutes for sleep, whole steps). Never invent one.
- When "daysWithData" is less than "elapsedDays", say how many days had data.
- Never diagnose, never name a condition, never give medical advice beyond everyday habits (sleep, walking, water, rest).
- "headline": one short sentence about the period's direction, at most 60 characters.
- "headlineHighlight": the key phrase of the headline, copied verbatim from it (character for character); "headlineCategory" is the category it is about (sleep, activity, recovery or body).
- "insights": 1 to 5, most important first, only about numbers that were recorded. Each has:
  - "category": sleep, activity, recovery or body;
  - "title": one sentence, at most 160 characters, built around the change;
  - "highlights": 0 to 3 short phrases (at most 40 characters each) copied verbatim from that same "title";
  - "stat" (optional): {"value": at most 12 characters, "unit": at most 16, "caption": a few words of context such as the value before, at most 40}.
- "comparisons": one per number recorded in both periods. "metric" is sleep, steps, exercise, hrv, restingHr or water; "current" and "previous" are the two averages as the person reads them (at most 24 characters each); "direction" is up, down or flat.
- "nudge": one everyday habit for the next period, one sentence, at most 140 characters. No medical advice.
Example (for a different person and period; write your own from the numbers):
{"headline":"More sleep, fewer steps than in August.","headlineHighlight":"More sleep","headlineCategory":"sleep","insights":[{"category":"sleep","title":"You slept 7 h 12 min a night on average, 25 minutes more than in August.","highlights":["7 h 12 min","25 minutes more"],"stat":{"value":"7:12","unit":"hr","caption":"August 6:47"}},{"category":"activity","title":"Daily steps fell 12 % to 7,040; you reached your goal on 9 of 28 days.","highlights":["fell 12 %","9 of 28 days"],"stat":{"value":"7,040","unit":"steps","caption":"August 8,000"}}],"comparisons":[{"metric":"sleep","current":"7 h 12 min","previous":"6 h 47 min","direction":"up"},{"metric":"steps","current":"7,040","previous":"8,000","direction":"down"}],"nudge":"Take a short walk after lunch on workdays."}
Respond ONLY with JSON in exactly that shape.`

/** What the memory read-filter is asked about: the period in one line. */
export function periodMemoryQuestion(r: PeriodReportRequest): string {
  const parts: string[] = []
  const sleep = periodAverage(r.current, 'sleep')
  const steps = periodAverage(r.current, 'steps')
  const hrv = periodAverage(r.current, 'hrv')
  if (sleep !== null) parts.push(`sleep ${Math.round(sleep)} min a night`)
  if (steps !== null) parts.push(`steps ${Math.round(steps)} a day`)
  if (hrv !== null) parts.push(`HRV ${Math.round(hrv)} ms`)
  return `Health report for a ${r.period.kind}. ${parts.join('; ')}`
}

function periodUserText(r: PeriodReportRequest, memories: MemoryRow[]): string {
  return `Period:\n${JSON.stringify(r)}\n\nKnown memories:\n${knownMemories(memories)}`
}

const health = new Hono<{ Variables: Variables }>()

health.post('/summary', async (c) => {
  const snapshot = validateSchema(
    healthSnapshotSchema,
    await c.req.json(),
    'Invalid health snapshot'
  )
  const setting = c.get('settings')
  const { model, apiKey } = getModelFromProvider(setting)
  const started = Date.now()
  const session = `health:${snapshot.date}`
  const memories =
    setting.memory?.useInChat !== false
      ? await loadRelevantMemories(
          memoryQuestion(snapshot),
          model,
          apiKey,
          session,
          session
        )
      : []
  const prompt = userText(snapshot, memories)

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await callLlm(model, apiKey, HEALTH_SUMMARY_SYSTEM, prompt)
    const parsed = parseHealthSummary(parseJsonFromResponse(text))
    // The older summary-only shape is not what we ask for, so the first answer in it is retried; on the last
    // attempt it still beats no note at all (the phone shows its Markdown summary).
    if (parsed && (parsed.insights || attempt === 2)) {
      logger.info('health', 'Summary written', {
        ms: Date.now() - started,
        attempt,
        stories: Boolean(parsed.insights)
      })
      return c.json(parsed)
    }
  }
  logger.warn('health', 'Summary output invalid twice', {
    ms: Date.now() - started
  })
  throw new AIError(
    ErrorCode.AI_GENERATION_FAILED,
    'The health summary could not be written.'
  )
})

health.post('/period-report', async (c) => {
  const request = validateSchema(
    periodReportRequestSchema,
    await c.req.json(),
    'Invalid period report request'
  )
  const setting = c.get('settings')
  const { model, apiKey } = getModelFromProvider(setting)
  const started = Date.now()
  const session = `health:${request.period.kind}:${request.period.start}`
  const memories =
    setting.memory?.useInChat !== false
      ? await loadRelevantMemories(
          periodMemoryQuestion(request),
          model,
          apiKey,
          session,
          session
        )
      : []
  const prompt = periodUserText(request, memories)

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await callLlm(
      model,
      apiKey,
      HEALTH_PERIOD_REPORT_SYSTEM,
      prompt
    )
    const parsed = parsePeriodReport(parseJsonFromResponse(text), request)
    // A report without insights is asked for again; on the last attempt its
    // headline still beats no report at all.
    if (parsed && (parsed.insights.length > 0 || attempt === 2)) {
      logger.info('health', 'Period report written', {
        ms: Date.now() - started,
        attempt,
        kind: request.period.kind,
        insights: parsed.insights.length,
        comparisons: parsed.comparisons.length
      })
      return c.json(parsed)
    }
  }
  logger.warn('health', 'Period report output invalid twice', {
    ms: Date.now() - started,
    kind: request.period.kind
  })
  throw new AIError(
    ErrorCode.AI_GENERATION_FAILED,
    'The health period report could not be written.'
  )
})

export default health
