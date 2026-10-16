import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { CliQuota } from '@exodus/shared/types/agents'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))

const {
  blockedUntil,
  forgetAllQuotas,
  formatQuotaForPm,
  getQuota,
  listQuotas,
  recordQuota,
  resetQuotaStoreForTests,
  quotaWindowLabel,
  toMs
} = await import('@main/lib/agents/quota')
const { getExodusHome } = await import('@main/lib/paths')

const file = () => join(getExodusHome(), 'agent-quota.json')
const NOW = Date.UTC(2026, 9, 16, 10, 0)
const claude = (over: Partial<CliQuota> = {}): CliQuota => ({
  cli: 'claude-code',
  windows: [
    { name: 'five_hour', usedPercent: 5, resetsAt: NOW + 3 * 3600_000 },
    { name: 'seven_day', usedPercent: 85, resetsAt: NOW + 4 * 86400_000 }
  ],
  state: 'warning',
  rejectedWindow: null,
  overage: false,
  asOf: NOW,
  ...over
})

beforeEach(async () => {
  await forgetAllQuotas()
  resetQuotaStoreForTests()
})

describe('quota store', () => {
  it('converts CLI seconds to ms and leaves ms alone', () => {
    expect(toMs(1792450800)).toBe(1792450800_000)
    expect(toMs(1792450800_000)).toBe(1792450800_000)
  })

  it('keeps the latest record per CLI and survives a restart', () => {
    recordQuota(claude())
    expect(getQuota('claude-code')?.state).toBe('warning')
    resetQuotaStoreForTests() // a new process reads the file
    expect(getQuota('claude-code')?.windows).toHaveLength(2)
    expect(listQuotas().map((q) => q.cli)).toEqual(['claude-code'])
    expect(getQuota('codex')).toBeNull()
  })

  it('merges a sparse update into the stored record', () => {
    recordQuota(claude())
    recordQuota(
      claude({
        windows: [{ name: 'five_hour', usedPercent: 40, resetsAt: null }],
        state: 'ok',
        asOf: NOW + 1
      }),
      { merge: true }
    )
    const q = getQuota('claude-code')!
    expect(q.windows.find((w) => w.name === 'five_hour')?.usedPercent).toBe(40)
    expect(q.windows.find((w) => w.name === 'seven_day')?.usedPercent).toBe(85)
    // A sparse update that reaches no limit keeps the stored verdict.
    expect(q.state).toBe('warning')
    expect(q.asOf).toBe(NOW)
  })

  it('a sparse update keeps a rejection unless it reports a reached limit itself', () => {
    const codex = (over: Partial<CliQuota>): CliQuota => ({
      ...claude(),
      cli: 'codex',
      ...over
    })
    recordQuota(
      codex({
        state: 'rejected',
        rejectedWindow: 'secondary',
        overage: true,
        windows: [
          { name: 'primary', usedPercent: 40, resetsAt: NOW + 1000 },
          {
            name: 'secondary',
            usedPercent: 100,
            resetsAt: NOW + 9000,
            rejected: true
          }
        ]
      })
    )
    recordQuota(
      codex({
        state: 'ok',
        overage: false,
        asOf: NOW + 5,
        windows: [{ name: 'primary', usedPercent: 45, resetsAt: NOW + 1000 }]
      }),
      { merge: true }
    )
    let q = getQuota('codex')!
    expect(q).toMatchObject({
      state: 'rejected',
      rejectedWindow: 'secondary',
      overage: true,
      asOf: NOW
    })
    expect(q.windows.find((w) => w.name === 'primary')?.usedPercent).toBe(45)
    recordQuota(
      codex({
        state: 'rejected',
        rejectedWindow: 'primary',
        overage: false,
        asOf: NOW + 7,
        windows: [
          {
            name: 'primary',
            usedPercent: 100,
            resetsAt: NOW + 1000,
            rejected: true
          }
        ]
      }),
      { merge: true }
    )
    q = getQuota('codex')!
    expect(q).toMatchObject({
      state: 'rejected',
      rejectedWindow: 'primary',
      overage: false,
      asOf: NOW + 7
    })
    expect(q.windows).toHaveLength(2)
  })

  it('drops malformed windows from the file', () => {
    writeFileSync(
      file(),
      JSON.stringify([
        {
          ...claude(),
          windows: [
            { name: 'five_hour', usedPercent: 5, resetsAt: null },
            'junk',
            null,
            { name: 7, usedPercent: 5, resetsAt: null },
            { name: 'seven_day', usedPercent: 'lots', resetsAt: null },
            { name: 'x', usedPercent: null, resetsAt: null }
          ]
        }
      ])
    )
    resetQuotaStoreForTests()
    expect(getQuota('claude-code')?.windows.map((w) => w.name)).toEqual([
      'five_hour'
    ])
  })

  it('a missing or corrupt file is no records, never a throw', () => {
    writeFileSync(file(), '{not json')
    resetQuotaStoreForTests()
    expect(listQuotas()).toEqual([])
    recordQuota(claude())
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toHaveLength(1)
  })

  it('forgetAllQuotas removes the file', async () => {
    recordQuota(claude())
    await forgetAllQuotas()
    expect(existsSync(file())).toBe(false)
    expect(listQuotas()).toEqual([])
  })
})

describe('a model’s own rejection outlives a reading of another model', () => {
  const opusRejected = claude({
    state: 'rejected',
    rejectedWindow: 'seven_day_opus',
    windows: [
      { name: 'five_hour', usedPercent: 20, resetsAt: NOW + 3600_000 },
      { name: 'seven_day', usedPercent: 70, resetsAt: NOW + 86400_000 },
      {
        name: 'seven_day_opus',
        usedPercent: 100,
        resetsAt: NOW + 2 * 86400_000,
        model: 'opus',
        rejected: true
      }
    ]
  })
  const sonnetAllowed = claude({
    state: 'ok',
    asOf: NOW + 60_000,
    windows: [
      { name: 'five_hour', usedPercent: 25, resetsAt: NOW + 3600_000 },
      { name: 'seven_day', usedPercent: 71, resetsAt: NOW + 86400_000 }
    ]
  })

  it('a sonnet reading keeps the opus window; opus stays blocked, sonnet runs', () => {
    recordQuota(opusRejected, {}, NOW)
    recordQuota(sonnetAllowed, {}, NOW + 60_000)
    const q = getQuota('claude-code')!
    expect(q.state).toBe('ok')
    expect(q.windows.find((w) => w.name === 'five_hour')?.usedPercent).toBe(25)
    expect(blockedUntil(q, 'opus', NOW + 60_000)?.name).toBe('seven_day_opus')
    expect(blockedUntil(q, 'claude-sonnet-4-6', NOW + 60_000)).toBeNull()
    expect(blockedUntil(q, null, NOW + 60_000)).toBeNull()
  })

  it('after the opus reset it is gone', () => {
    recordQuota(opusRejected, {}, NOW)
    const after = NOW + 2 * 86400_000 + 1
    expect(blockedUntil(getQuota('claude-code'), 'opus', after)).toBeNull()
    recordQuota({ ...sonnetAllowed, asOf: after }, {}, after)
    const q = getQuota('claude-code')!
    expect(q.windows.some((w) => w.name === 'seven_day_opus')).toBe(false)
    expect(blockedUntil(q, 'opus', after)).toBeNull()
  })

  it('a window marked rejected blocks even when the record is not, unless overage', () => {
    const q = claude({
      state: 'ok',
      windows: [
        {
          name: 'seven_day_opus',
          usedPercent: 100,
          resetsAt: NOW + 1000,
          model: 'opus',
          rejected: true
        }
      ]
    })
    expect(blockedUntil(q, 'opus', NOW)?.name).toBe('seven_day_opus')
    expect(blockedUntil({ ...q, overage: true }, 'opus', NOW)).toBeNull()
  })
})

describe('a rejected model window with no reset time', () => {
  const MIN = 60_000
  const T = NOW
  const opusNoReset = claude({
    state: 'rejected',
    rejectedWindow: 'seven_day_opus',
    asOf: T,
    windows: [
      { name: 'five_hour', usedPercent: 20, resetsAt: T + 3600_000 },
      {
        name: 'seven_day_opus',
        usedPercent: 100,
        resetsAt: null,
        model: 'opus',
        rejected: true
      }
    ]
  })
  const sonnetAt = (min: number) =>
    claude({
      state: 'ok',
      asOf: T + min * MIN,
      windows: [
        { name: 'five_hour', usedPercent: 25, resetsAt: T + 3600_000 * 5 }
      ]
    })

  it('blocks for an hour after the reading that carried it, not forever', () => {
    recordQuota(opusNoReset, {}, T)
    recordQuota(sonnetAt(10), {}, T + 10 * MIN)
    const q = getQuota('claude-code')!
    expect(blockedUntil(q, 'opus', T + 10 * MIN)?.name).toBe('seven_day_opus')
    expect(blockedUntil(q, 'opus', T + 61 * MIN)).toBeNull()
  })

  it('a carried window keeps its own origin across later readings', () => {
    recordQuota(opusNoReset, {}, T)
    recordQuota(sonnetAt(10), {}, T + 10 * MIN)
    recordQuota(sonnetAt(30), {}, T + 30 * MIN)
    const q = getQuota('claude-code')!
    expect(q.windows.find((w) => w.model === 'opus')?.seenAt).toBe(T)
    expect(blockedUntil(q, 'opus', T + 30 * MIN)?.name).toBe('seven_day_opus')
    expect(blockedUntil(q, 'opus', T + 61 * MIN)).toBeNull()
  })

  it('is dropped from the record once an hour has passed since it was seen', () => {
    recordQuota(opusNoReset, {}, T)
    recordQuota(sonnetAt(61), {}, T + 61 * MIN)
    expect(
      getQuota('claude-code')!.windows.some((w) => w.model === 'opus')
    ).toBe(false)
  })
})

describe('blockedUntil', () => {
  it('nothing blocks without a record, while not rejected, or with overage', () => {
    expect(blockedUntil(null, 'opus', NOW)).toBeNull()
    expect(blockedUntil(claude(), 'opus', NOW)).toBeNull()
    expect(
      blockedUntil(claude({ state: 'rejected', overage: true }), 'opus', NOW)
    ).toBeNull()
  })

  it('a full account window blocks every model', () => {
    const q = claude({
      state: 'rejected',
      rejectedWindow: 'seven_day',
      windows: [{ name: 'seven_day', usedPercent: 100, resetsAt: NOW + 1000 }]
    })
    expect(blockedUntil(q, 'sonnet', NOW)?.name).toBe('seven_day')
    expect(blockedUntil(q, null, NOW)?.resetsAt).toBe(NOW + 1000)
  })

  it('a model’s own window blocks only that model', () => {
    const q = claude({
      state: 'rejected',
      rejectedWindow: 'seven_day_opus',
      windows: [
        { name: 'seven_day', usedPercent: 85, resetsAt: NOW + 5000 },
        {
          name: 'seven_day_opus',
          usedPercent: 100,
          resetsAt: NOW + 9000,
          model: 'opus'
        }
      ]
    })
    expect(blockedUntil(q, 'claude-opus-4-8', NOW)?.name).toBe('seven_day_opus')
    expect(blockedUntil(q, 'opus', NOW)?.resetsAt).toBe(NOW + 9000)
    expect(blockedUntil(q, 'sonnet', NOW)).toBeNull()
    expect(blockedUntil(q, null, NOW)).toBeNull()
  })

  it('a rejection with no window detail still blocks, reset unknown', () => {
    const q = claude({ state: 'rejected', rejectedWindow: null, windows: [] })
    expect(blockedUntil(q, 'opus', NOW)).toEqual({
      name: 'limit',
      usedPercent: 100,
      resetsAt: null
    })
  })

  it('a window whose reset has passed no longer blocks', () => {
    const q = claude({
      state: 'rejected',
      rejectedWindow: 'seven_day',
      windows: [{ name: 'seven_day', usedPercent: 100, resetsAt: NOW - 1000 }]
    })
    expect(blockedUntil(q, 'opus', NOW)).toBeNull()
  })

  it('a rejectedWindow missing from the windows falls back to a full one', () => {
    const q = claude({
      state: 'rejected',
      rejectedWindow: 'seven_day_gone',
      windows: [{ name: 'seven_day', usedPercent: 100, resetsAt: NOW + 1000 }]
    })
    expect(blockedUntil(q, 'opus', NOW)?.name).toBe('seven_day')
  })

  it('a no-detail rejection blocks for an hour, then is stale', () => {
    const q = claude({ state: 'rejected', rejectedWindow: null, windows: [] })
    expect(blockedUntil(q, 'opus', NOW + 10 * 60_000)?.name).toBe('limit')
    expect(blockedUntil(q, 'opus', NOW + 61 * 60_000)).toBeNull()
  })
})

describe('formatQuotaForPm', () => {
  it('says unknown without a record', () => {
    expect(formatQuotaForPm(null, 'codex', NOW)).toBe(
      'Codex quota: unknown (it has not reported any).'
    )
  })

  it('names every window with its percentage, the warning and overage', () => {
    const line = formatQuotaForPm(
      claude({ asOf: NOW - 2 * 3600_000 }),
      'claude-code',
      NOW
    )
    expect(line).toMatch(/^Claude Code quota \(as of 2 h ago\): /)
    expect(line).toContain('5-hour 5 %')
    expect(line).toContain('week 85 % (warning)')
    expect(line).toContain('no overage')
  })

  it('marks a model’s own window and a rejection', () => {
    const line = formatQuotaForPm(
      claude({
        state: 'rejected',
        rejectedWindow: 'seven_day_opus',
        windows: [
          {
            name: 'seven_day_opus',
            usedPercent: 100,
            resetsAt: NOW + 1000,
            model: 'opus'
          }
        ]
      }),
      'claude-code',
      NOW
    )
    expect(line).toContain('opus only: week 100 % (LIMIT REACHED')
  })

  it('a window past its reset is shown as reset, never as LIMIT REACHED', () => {
    const line = formatQuotaForPm(
      claude({
        state: 'rejected',
        rejectedWindow: 'five_hour',
        windows: [
          {
            name: 'five_hour',
            usedPercent: 100,
            resetsAt: NOW - 60_000,
            rejected: true
          },
          { name: 'seven_day', usedPercent: 95, resetsAt: NOW + 86400_000 }
        ]
      }),
      'claude-code',
      NOW
    )
    expect(line).toMatch(/5-hour: reset at .* \(not re-read since\)/)
    expect(line).not.toContain('LIMIT REACHED')
    expect(line).toContain('week 95 %')
  })

  it('a carried-over rejected window says LIMIT REACHED in an ok record', () => {
    const line = formatQuotaForPm(
      claude({
        state: 'ok',
        windows: [
          {
            name: 'seven_day_opus',
            usedPercent: 100,
            resetsAt: NOW + 1000,
            model: 'opus',
            rejected: true
          }
        ]
      }),
      'claude-code',
      NOW
    )
    expect(line).toContain('opus only: week 100 % (LIMIT REACHED')
  })
})

describe('quotaWindowLabel', () => {
  it('names a window as the owner says it', () => {
    expect(
      quotaWindowLabel({ name: 'five_hour', usedPercent: 0, resetsAt: null })
    ).toBe('5-hour')
    expect(
      quotaWindowLabel({ name: 'seven_day', usedPercent: 0, resetsAt: null })
    ).toBe('week')
    expect(
      quotaWindowLabel({
        name: 'seven_day_opus',
        usedPercent: 0,
        resetsAt: null,
        model: 'opus'
      })
    ).toBe('opus only: week')
    expect(
      quotaWindowLabel({ name: 'primary', usedPercent: 0, resetsAt: null })
    ).toBe('primary')
    expect(
      quotaWindowLabel({
        name: 'primary',
        usedPercent: 0,
        resetsAt: null,
        durationMins: 300
      })
    ).toBe('5-hour')
    expect(
      quotaWindowLabel({
        name: 'GPT-5.6 Pro secondary',
        usedPercent: 0,
        resetsAt: null,
        durationMins: 10080,
        model: 'gpt-5.6-pro'
      })
    ).toBe('gpt-5.6-pro only: week')
    expect(
      quotaWindowLabel({
        name: 'secondary',
        usedPercent: 0,
        resetsAt: null,
        durationMins: 60
      })
    ).toBe('secondary')
  })
})
