import { describe, expect, it } from 'vitest'

import { quotaParts } from '@/lib/agent-quota'

describe('quotaParts', () => {
  it('names the account windows, keeps the others, marks a limit', () => {
    expect(
      quotaParts({
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
      })
    ).toEqual([
      {
        key: 'fiveHour',
        name: 'five_hour',
        percent: 5,
        limited: false,
        resetsAt: 10
      },
      {
        key: 'sevenDay',
        name: 'seven_day',
        percent: 85,
        limited: false,
        resetsAt: 20
      },
      { key: 'other', name: 'opus', percent: 100, limited: true, resetsAt: 30 }
    ])
  })
})
