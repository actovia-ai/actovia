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
    expect(q.state).toBe('ok')
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
            resetsAt: NOW,
            model: 'opus'
          }
        ]
      }),
      'claude-code',
      NOW
    )
    expect(line).toContain('opus only: seven_day_opus 100 % (LIMIT REACHED')
  })
})
