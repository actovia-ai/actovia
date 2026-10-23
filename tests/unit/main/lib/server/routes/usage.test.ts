import { afterEach, describe, expect, it, vi } from 'vitest'

const getUsageRows = vi.fn()
vi.mock('@main/lib/db/queries', () => ({ getUsageRows }))

const { default: usage } = await import('@main/lib/server/routes/usage')

const originalTz = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTz
})

describe('GET /usage', () => {
  it('buckets a request by the day it was made on where the user is', async () => {
    process.env.TZ = 'Asia/Shanghai'
    getUsageRows.mockResolvedValue([
      {
        model: 'm',
        provider: 'p',
        usage: { totalTokens: 10, cost: { total: 0.1 } },
        // 04:30 on 2 May in Shanghai.
        createdAt: new Date('2026-05-01T20:30:00.000Z')
      }
    ])
    const res = await usage.request('/')
    const body = (await res.json()) as { daily: Array<{ date: string }> }
    expect(body.daily.map((d) => d.date)).toEqual(['2026-05-02'])
  })
})
