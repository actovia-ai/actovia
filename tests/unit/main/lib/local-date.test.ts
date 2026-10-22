import { localDateStr } from '@main/lib/local-date'
import { afterEach, describe, expect, it } from 'vitest'

const originalTz = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTz
})

// 20:30 UTC on 1 May is already 2 May in Shanghai, still 1 May in New York.
const lateUtc = new Date('2026-05-01T20:30:00.000Z')

describe('localDateStr', () => {
  it('is the day in the process zone, not the UTC day', () => {
    process.env.TZ = 'Asia/Shanghai'
    expect(localDateStr(lateUtc)).toBe('2026-05-02')
    process.env.TZ = 'America/New_York'
    expect(localDateStr(lateUtc)).toBe('2026-05-01')
  })
})
