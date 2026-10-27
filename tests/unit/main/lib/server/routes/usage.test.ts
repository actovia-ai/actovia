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
  // ISSUE-235: tokens only — an older row's stored cost is not read.
  it('answers no cost at any depth, and sorts models by tokens', async () => {
    const at = new Date('2026-05-01T08:00:00.000Z')
    getUsageRows.mockResolvedValue([
      {
        model: 'small',
        provider: 'p',
        usage: { input: 5, output: 5, totalTokens: 10, cost: { total: 9 } },
        createdAt: at
      },
      {
        model: 'big',
        provider: 'p',
        usage: { input: 50, output: 50, totalTokens: 100, cost: { total: 1 } },
        createdAt: at
      }
    ])
    const res = await usage.request('/')
    const body = (await res.json()) as {
      totalTokens: number
      models: Array<{ model: string }>
    }
    const keys: string[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          keys.push(k)
          walk(x)
        }
    }
    walk(body)
    expect(keys.filter((k) => /cost/i.test(k))).toEqual([])
    expect(body.totalTokens).toBe(110)
    expect(body.models.map((m) => m.model)).toEqual(['big', 'small'])
  })
})
