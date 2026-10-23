import { describe, expect, it } from 'vitest'

import { describeSchedule } from '@/components/philharmonic/schedule/recurring-list'

const t = ((key: string, params?: { time?: string }) =>
  params?.time ? `${key}(${params.time})` : key) as never
const dateTime = () => 'WHEN'

describe('describeSchedule', () => {
  it('names a schedule the form offers instead of showing its cron line', () => {
    expect(
      describeSchedule(
        { cronExpression: '0 9 * * 1', lastRunAt: null },
        t,
        dateTime
      )
    ).toBe(
      'schedule.form.cronPresets.mondayNine · schedule.recurringList.nextRun(WHEN)'
    )
  })

  it('shows a custom line as written, with when it last ran', () => {
    expect(
      describeSchedule(
        { cronExpression: '30 7 * * 1-5', lastRunAt: '2026-10-21T07:30:00Z' },
        t,
        dateTime
      )
    ).toBe(
      'schedule.recurringList.lastRun(WHEN) · 30 7 * * 1-5 · schedule.recurringList.nextRun(WHEN)'
    )
  })

  it('keeps an unparsable line without a next run', () => {
    expect(
      describeSchedule(
        { cronExpression: 'nonsense', lastRunAt: null },
        t,
        dateTime
      )
    ).toBe('nonsense')
  })
})
