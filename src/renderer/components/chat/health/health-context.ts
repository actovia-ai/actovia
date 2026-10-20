// What a question asked from the phone's Health workspace carried (the JSON
// of `splitHealth`), as the bubble draws it: a row of chips, and a list of
// labelled values behind them. The chips follow actovia-ios's
// `HealthContextCard.chips` rule for rule. Display only.
import type { HealthSnapshot } from '@actovia/shared/types/health'

import {
  categoryTitle,
  formatDay,
  formatMinutes,
  has,
  type HealthChip,
  type HealthDetailRow,
  type HealthDetailSection,
  type HealthFormat,
  isRecord,
  number,
  parse,
  snapshotOf
} from '@/components/chat/health/health-format'
import { weekDetails } from '@/components/chat/health/health-week'

export {
  formatMinutes,
  type HealthChip,
  type HealthChipIcon,
  type HealthFormat
} from '@/components/chat/health/health-format'

/** The chips over the question — actovia-ios `HealthContextCard.chips`. */
export function healthChips(json: string, f: HealthFormat): HealthChip[] {
  const value = parse(json)
  const s = snapshotOf(value)
  if (s) {
    const out: HealthChip[] = []
    if (s.sleep) {
      out.push({
        icon: 'sleep',
        text: formatMinutes(s.sleep.asleepMin, f.locale)
      })
    }
    if (s.activity) {
      out.push({ icon: 'steps', text: number(s.activity.steps, f.locale) })
    }
    const hr = s.recovery?.restingHr
    if (has(hr) && Number.isFinite(hr)) {
      out.push({
        icon: 'heart',
        text: f.t('health.bpm', { value: Math.trunc(hr) })
      })
    }
    if (s.body) {
      out.push({
        icon: 'water',
        text: f.t('health.cups', { count: s.body.waterCups })
      })
    }
    return out.length > 0 ? out : [{ icon: 'health', text: s.date }]
  }
  if (isRecord(value) && typeof value.category === 'string') {
    return [{ icon: 'health', text: categoryTitle(value.category, f) }]
  }
  return [{ icon: 'health', text: f.t('health.fallback') }]
}

function withUsual(
  value: string,
  usual: string | null,
  f: HealthFormat
): string {
  return usual === null ? value : f.t('health.withUsual', { value, usual })
}

function snapshotDetails(
  s: HealthSnapshot,
  f: HealthFormat
): HealthDetailSection[] {
  const { t, locale } = f
  const dur = (m: number) => formatMinutes(m, locale)
  const sections: HealthDetailSection[] = []
  const push = (category: string, rows: HealthDetailRow[]) => {
    if (rows.length > 0)
      sections.push({ title: categoryTitle(category, f), rows })
  }

  if (s.sleep) {
    const sl = s.sleep
    push('sleep', [
      {
        label: t('health.field.asleep'),
        value: withUsual(
          dur(sl.asleepMin),
          has(sl.baselineMin) ? dur(sl.baselineMin) : null,
          f
        )
      },
      { label: t('health.field.inBed'), value: `${sl.bedtime}–${sl.wake}` },
      { label: t('health.field.deep'), value: dur(sl.deepMin) },
      { label: t('health.field.core'), value: dur(sl.coreMin) },
      { label: t('health.field.rem'), value: dur(sl.remMin) },
      { label: t('health.field.awake'), value: dur(sl.awakeMin) }
    ])
  }
  if (s.activity) {
    const a = s.activity
    const rows: HealthDetailRow[] = [
      {
        label: t('health.field.steps'),
        value: t('health.ofGoal', {
          value: number(a.steps, locale),
          goal: number(a.stepGoal, locale)
        })
      },
      {
        label: t('health.field.activeEnergy'),
        value: has(a.kcalGoal)
          ? t('health.ofGoal', {
              value: number(a.activeKcal, locale),
              goal: t('health.kcal', { value: number(a.kcalGoal, locale) })
            })
          : t('health.kcal', { value: number(a.activeKcal, locale) })
      },
      { label: t('health.field.exercise'), value: dur(a.exerciseMin) },
      {
        label: t('health.field.stand'),
        value: t('health.hours', { count: a.standHours })
      }
    ]
    if (a.workouts.length > 0) {
      rows.push({
        label: t('health.field.workouts'),
        value: a.workouts
          .map((w) =>
            has(w.kcal)
              ? `${w.type} · ${dur(w.minutes)} · ${t('health.kcal', { value: number(w.kcal, locale) })}`
              : `${w.type} · ${dur(w.minutes)}`
          )
          .join('\n')
      })
    }
    push('activity', rows)
  }
  if (s.recovery) {
    const r = s.recovery
    const rows: HealthDetailRow[] = []
    if (r.level) {
      rows.push({
        label: t('health.field.level'),
        value: t(`health.level.${r.level}`)
      })
    }
    if (has(r.hrvMs)) {
      rows.push({
        label: t('health.field.hrv'),
        value: withUsual(
          t('health.ms', { value: number(r.hrvMs, locale) }),
          has(r.hrvBaselineMs)
            ? t('health.ms', { value: number(r.hrvBaselineMs, locale) })
            : null,
          f
        )
      })
    }
    if (has(r.restingHr)) {
      rows.push({
        label: t('health.field.restingHr'),
        value: withUsual(
          t('health.bpm', { value: Math.trunc(r.restingHr) }),
          has(r.restingHrBaseline)
            ? t('health.bpm', { value: Math.trunc(r.restingHrBaseline) })
            : null,
          f
        )
      })
    }
    if (has(r.respRate)) {
      rows.push({
        label: t('health.field.respRate'),
        value: t('health.perMin', { value: number(r.respRate, locale, 1) })
      })
    }
    push('recovery', rows)
  }
  if (s.body) {
    const b = s.body
    const rows: HealthDetailRow[] = [
      {
        label: t('health.field.water'),
        value: t('health.cups', { count: b.waterCups })
      }
    ]
    if (has(b.weightKg)) {
      rows.push({
        label: t('health.field.weight'),
        value: t('health.kg', { value: number(b.weightKg, locale, 1) })
      })
    }
    if (has(b.weightTrend30d)) {
      const sign = b.weightTrend30d > 0 ? '+' : ''
      rows.push({
        label: t('health.field.weightTrend'),
        value: t('health.kg', {
          value: `${sign}${number(b.weightTrend30d, locale, 1)}`
        })
      })
    }
    if (b.mood) {
      rows.push({
        label: t('health.field.mood'),
        value: t(`health.mood.${b.mood}`)
      })
    }
    push('body', rows)
  }
  return sections
}

/**
 * Everything the block carried, as labelled values: a day's snapshot by
 * category, a detail page's week by day. Null when it reads as neither —
 * the card then shows what was sent as it was sent.
 */
export function healthDetails(
  json: string,
  f: HealthFormat
): { heading: string | null; sections: HealthDetailSection[] } | null {
  const value = parse(json)
  const s = snapshotOf(value)
  if (s) {
    return {
      heading: f.t('health.asOf', {
        date: formatDay(s.date, f.locale),
        time: s.localTime
      }),
      sections: snapshotDetails(s, f)
    }
  }
  if (
    isRecord(value) &&
    typeof value.category === 'string' &&
    Array.isArray(value.days)
  ) {
    return {
      heading: f.t('health.lastDays', {
        category: categoryTitle(value.category, f),
        count: value.days.length
      }),
      sections: weekDetails(value.days, f)
    }
  }
  return null
}
