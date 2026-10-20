// The numbers a question from the phone's Health workspace carried, as the
// bubble draws them. The chips follow actovia-ios's `HealthContextCard.chips`.
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import {
  formatMinutes,
  type HealthFormat,
  healthChips,
  healthDetails
} from '@/components/chat/health/health-context'

const en: unknown = JSON.parse(
  readFileSync(
    join(process.cwd(), 'packages/shared/src/i18n/locales/en/chat.json'),
    'utf8'
  )
)

// The English catalog, read the way i18next reads it (plurals by `count`).
function t(key: string, options: Record<string, unknown> = {}): string {
  const lookup = (k: string) =>
    k
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        en
      )
  let template = lookup(key)
  if (template === undefined && typeof options.count === 'number') {
    template = lookup(`${key}_${options.count === 1 ? 'one' : 'other'}`)
  }
  if (typeof template !== 'string') throw new Error(`missing key ${key}`)
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options[name])
  )
}
const f: HealthFormat = { t, locale: 'en' }

const snapshot = {
  date: '2026-10-01',
  localTime: '08:12',
  locale: 'en_US',
  sleep: {
    asleepMin: 432,
    baselineMin: 440,
    deepMin: 61,
    coreMin: 250,
    remMin: 98,
    awakeMin: 23,
    bedtime: '23:10',
    wake: '06:40'
  },
  activity: {
    steps: 8123,
    stepGoal: 10000,
    activeKcal: 320,
    exerciseMin: 32,
    standHours: 9,
    workouts: [{ type: 'running', minutes: 30, kcal: 280 }]
  },
  recovery: {
    level: 'good',
    hrvMs: 45.2,
    hrvBaselineMs: 41,
    restingHr: 58.7,
    respRate: 14.46
  },
  body: {
    waterCups: 6,
    weightKg: 70.24,
    weightTrend30d: -0.4,
    mood: 'pleasant'
  },
  odyState: 'rested'
}
const json = (v: unknown) => JSON.stringify(v)

describe('formatMinutes', () => {
  it('reads as hours and minutes, narrow, as iOS does', () => {
    expect(formatMinutes(432, 'en')).toBe('7h 12m')
    expect(formatMinutes(42, 'en')).toBe('42m')
    expect(formatMinutes(0, 'en')).toBe('0m')
  })
})

describe('healthChips', () => {
  it('draws sleep, steps, resting heart rate and water from a snapshot', () => {
    expect(healthChips(json(snapshot), f)).toEqual([
      { icon: 'sleep', text: '7h 12m' },
      { icon: 'steps', text: '8,123' },
      { icon: 'heart', text: '58 bpm' },
      { icon: 'water', text: '6 cups' }
    ])
  })

  it('leaves out what the day does not have', () => {
    const { sleep: _s, recovery: _r, ...rest } = snapshot
    expect(
      healthChips(
        json({ ...rest, body: { ...snapshot.body, waterCups: 1 } }),
        f
      )
    ).toEqual([
      { icon: 'steps', text: '8,123' },
      { icon: 'water', text: '1 cup' }
    ])
  })

  it('names a snapshot with nothing in it by its date', () => {
    expect(
      healthChips(
        json({
          date: '2026-10-01',
          localTime: '08:12',
          locale: 'en',
          odyState: 'noData'
        }),
        f
      )
    ).toEqual([{ icon: 'health', text: '2026-10-01' }])
  })

  it('names a detail page’s week by its category', () => {
    expect(healthChips(json({ category: 'recovery', days: [] }), f)).toEqual([
      { icon: 'health', text: 'Heart & recovery' }
    ])
    expect(healthChips(json({ category: 'mindfulness', days: [] }), f)).toEqual(
      [{ icon: 'health', text: 'mindfulness' }]
    )
  })

  it('falls back to “Health” for anything else', () => {
    expect(healthChips('not json', f)).toEqual([
      { icon: 'health', text: 'Health' }
    ])
    expect(healthChips('[1,2]', f)).toEqual([
      { icon: 'health', text: 'Health' }
    ])
  })
})

describe('healthDetails', () => {
  it('lists a snapshot by category, labelled', () => {
    const d = healthDetails(json(snapshot), f)
    expect(d?.heading).toBe('Thu, Oct 1, 08:12')
    expect(d?.sections.map((s) => s.title)).toEqual([
      'Sleep',
      'Activity',
      'Heart & recovery',
      'Body & mood'
    ])
    const rows = Object.fromEntries(
      d!.sections.flatMap((s) => s.rows).map((r) => [r.label, r.value])
    )
    expect(rows).toMatchObject({
      Asleep: '7h 12m · usual 7h 20m',
      'In bed': '23:10–06:40',
      Deep: '1h 1m',
      Steps: '8,123 of 10,000',
      'Active energy': '320 kcal',
      Stand: '9 hours',
      Workouts: 'running · 30m · 280 kcal',
      Recovery: 'Good',
      HRV: '45 ms · usual 41 ms',
      'Resting heart rate': '58 bpm',
      'Respiratory rate': '14.5/min',
      Water: '6 cups',
      Weight: '70.2 kg',
      '30-day change': '-0.4 kg',
      Mood: 'Pleasant'
    })
  })

  it('lists a detail page’s week by day', () => {
    const d = healthDetails(
      json({
        category: 'sleep',
        days: [
          {
            date: '2026-09-30',
            values: { remMin: 90, asleepHours: 7.5 },
            wake: '06:30'
          },
          { date: '2026-10-01', values: {} }
        ]
      }),
      f
    )
    expect(d?.heading).toBe('Sleep, last 2 days')
    expect(d?.sections).toEqual([
      {
        title: 'Wed, Sep 30',
        rows: [
          { label: 'Asleep', value: '7h 30m' },
          { label: 'REM', value: '1h 30m' },
          { label: 'Woke up', value: '06:30' }
        ]
      },
      { title: 'Thu, Oct 1', rows: [{ label: 'No data', value: '' }] }
    ])
  })

  it('is null for what reads as neither, so the card shows it as sent', () => {
    expect(healthDetails('not json', f)).toBeNull()
    expect(healthDetails(json({ hello: 1 }), f)).toBeNull()
  })
})
