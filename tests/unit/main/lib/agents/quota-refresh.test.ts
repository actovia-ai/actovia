import { beforeEach, describe, expect, it, vi } from 'vitest'

const recorded: unknown[] = []
let stored: { asOf: number } | null = null
vi.mock('@main/lib/agents/quota', () => ({
  getQuota: () => stored,
  recordQuota: (q: unknown) => recorded.push(q)
}))
// The defaults reach the settings DB and the login shell; every test passes its own deps.
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: vi.fn(),
  readCodexQuota: vi.fn()
}))
vi.mock('@main/lib/agents/login-shell', () => ({ loginShellEnv: vi.fn() }))
vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))
const { refreshQuotas, resetQuotaRefreshForTests } =
  await import('@main/lib/agents/quota-refresh')

const deps = (read: () => Promise<unknown>, now = 100_000) => ({
  status: async () => ({ state: 'ready', path: '/bin/codex' }) as never,
  env: async () => ({}),
  read: vi.fn(read) as never,
  now: () => now
})

beforeEach(() => resetQuotaRefreshForTests())

describe('refreshQuotas', () => {
  it('asks Codex when its reading is older than a minute, never Claude Code', async () => {
    const d = deps(async () => ({ cli: 'codex', asOf: 100_000 }))
    await refreshQuotas(['claude-code', 'codex'], d)
    expect(d.read).toHaveBeenCalledTimes(1)
    expect(recorded).toEqual([{ cli: 'codex', asOf: 100_000 }])
  })

  it('a fresh reading, a CLI not ready or a failed read changes nothing', async () => {
    recorded.length = 0
    stored = { asOf: 90_000 }
    const fresh = deps(async () => ({ cli: 'codex' }))
    await refreshQuotas(['codex'], fresh)
    expect(fresh.read).not.toHaveBeenCalled()
    stored = null
    await refreshQuotas(['codex'], {
      ...deps(async () => null),
      status: async () => ({ state: 'missing', path: null }) as never
    })
    await refreshQuotas(
      ['codex'],
      deps(async () => {
        throw new Error('boom')
      })
    )
    expect(recorded).toEqual([])
  })

  it('after a failed or empty read, does not ask again for a minute', async () => {
    recorded.length = 0
    stored = null
    for (const failing of [
      async () => null,
      async () => {
        throw new Error('boom')
      }
    ]) {
      resetQuotaRefreshForTests()
      await refreshQuotas(['codex'], deps(failing, 100_000))
      const soon = deps(async () => ({ cli: 'codex', asOf: 130_000 }), 130_000)
      await refreshQuotas(['codex'], soon)
      expect(soon.read).not.toHaveBeenCalled()
      const later = deps(async () => ({ cli: 'codex', asOf: 160_001 }), 160_001)
      await refreshQuotas(['codex'], later)
      expect(later.read).toHaveBeenCalledTimes(1)
    }
    expect(recorded).toHaveLength(2)
  })
})
