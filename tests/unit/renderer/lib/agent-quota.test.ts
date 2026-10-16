import { describe, expect, it } from 'vitest'

import { quotaParts } from '@/lib/agent-quota'

describe('quotaParts', () => {
  it('names the account windows, keeps the others, marks a limit', () => {
    expect(
      quotaParts(
        {
          cli: 'claude-code',
          state: 'rejected',
          rejectedWindow: 'seven_day_opus',
          overage: false,
          asOf: 1,
          windows: [
            { name: 'five_hour', usedPercent: 5.2, resetsAt: 10 },
            { name: 'seven_day', usedPercent: 85, resetsAt: 20 },
            {
              name: 'seven_day_opus',
              usedPercent: 100,
              resetsAt: 30,
              model: 'opus'
            }
          ]
        },
        0
      )
    ).toEqual([
      {
        key: 'fiveHour',
        name: 'five_hour',
        percent: 5,
        limited: false,
        reset: false,
        resetsAt: 10
      },
      {
        key: 'sevenDay',
        name: 'seven_day',
        percent: 85,
        limited: false,
        reset: false,
        resetsAt: 20
      },
      {
        key: 'other',
        name: 'opus',
        percent: 100,
        limited: true,
        reset: false,
        resetsAt: 30
      }
    ])
  })

  it('a window past its reset is not limited, and says it reset', () => {
    const [part] = quotaParts(
      {
        cli: 'claude-code',
        state: 'rejected',
        rejectedWindow: 'five_hour',
        overage: false,
        asOf: 1,
        windows: [
          { name: 'five_hour', usedPercent: 100, resetsAt: 10, rejected: true }
        ]
      },
      11
    )
    expect(part).toMatchObject({ limited: false, reset: true, percent: 100 })
  })

  it('a carried-over rejected window is limited in an ok record; Codex windows by length', () => {
    const parts = quotaParts(
      {
        cli: 'codex',
        state: 'ok',
        rejectedWindow: null,
        overage: false,
        asOf: 1,
        windows: [
          { name: 'primary', usedPercent: 3, resetsAt: 50, durationMins: 300 },
          {
            name: 'secondary',
            usedPercent: 9,
            resetsAt: 60,
            durationMins: 10080
          },
          {
            name: 'GPT-5.6 Pro secondary',
            usedPercent: 100,
            resetsAt: 70,
            durationMins: 10080,
            model: 'gpt-5.6-pro',
            rejected: true
          }
        ]
      },
      5
    )
    expect(parts.map((p) => [p.key, p.name, p.limited])).toEqual([
      ['fiveHour', 'primary', false],
      ['sevenDay', 'secondary', false],
      ['other', 'gpt-5.6-pro', true]
    ])
  })
})
