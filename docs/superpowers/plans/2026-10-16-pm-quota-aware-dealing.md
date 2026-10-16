# Quota-aware dealing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Philharmonic PM sees every CLI employee's model and the CLIs' reported quota, deals steps by difficulty, and when a skilled hand is out of quota it downgrades or waits for the reset (a one-off scheduled task) on its own.

**Architecture:** The drivers turn what each CLI reports (Claude Code's `rate_limit_event`, Codex's `account/rateLimits/*`) into one `CliQuota` shape via a new `quota` agent event; `agents/quota.ts` keeps the latest record per CLI in memory and in `~/.exodus/agent-quota.json`. The PM coordinator reads it into its roster and system prompt, guards `delegateTask`, and gets a `waitForQuota` tool that schedules a one-off task the existing scheduler fires at the reset. The members panel shows one quota line per CLI member.

**Tech Stack:** TypeScript, Electron main (Hono, Drizzle/PGlite), pi-agent-core tools (TypeBox), React 19 + React Query, Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-10-16-pm-quota-aware-dealing-design.md`

## Global Constraints

- Branch `maintenance`; never push. Pre-commit gate: `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test` (the husky hook runs it). Run typecheck as `env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck` (shell PWD casing).
- Data source: only what the CLIs report. No scraping of claude.ai / chatgpt.com.
- The model stays on the employee (`agent.model`). No per-step model; no `model` argument on `delegateTask`.
- A CLI's `state` is the CLI's own verdict, never inferred from percentages (Claude Code `status`; Codex `rateLimitReachedType` / `ordinaryUsageAllowed`).
- A stale reading never blocks; only `state: 'rejected'` without overage blocks a delegation.
- `~/.exodus/agent-quota.json`: not secret, machine-local, not in `db-io` export/import or backups; "reset all data" removes it.
- No migration.
- New user-facing strings are catalog keys in `packages/shared/src/i18n/locales/<id>/philharmonic.json` for **all 10 locales** (`de en es fr it ja ko pt-BR zh-Hant-HK zh-Hant-TW`) in the same commit, authored by hand. Text the PM model reads is not user-facing and stays English in code.
- Tests: `tests/unit/**` mirroring `src/`, imports via `@main/...` / `@/...` / `@exodus/shared/...`; a DOM test starts with `// @vitest-environment happy-dom`. Nothing talks to a real model or CLI.
- Times are epoch **milliseconds** inside Exodus; CLIs give seconds — convert with `toMs()` (Task 1).

## Review Focus

1. **A CLI that reports nothing** (logged out, offline, older version, Codex read times out) — no record, the PM is told "unknown", delegation proceeds. Pinned in Task 1 (`blockedUntil(null)`), Task 3 (`readCodexQuota` → null), Task 5 (roster says unknown).
2. **A model-specific window for a different model** (Fable's weekly limit at 100 % while the employee runs sonnet) must not block that employee. Pinned in Task 1 (`blockedUntil` model matching).
3. **Seconds vs milliseconds** — `resetsAt: 1792450800` must become a date in 2026, not 1970. Pinned in Tasks 2 and 3.
4. **A corrupt or missing `agent-quota.json`** must not crash the PM or the app. Pinned in Task 1.
5. **`waitForQuota` twice for one step** moves the existing wait instead of scheduling two wake-ups; a step with nothing blocking is refused. Pinned in Task 5.

---

### Task 1: The quota shape and store

**Files:**

- Modify: `packages/shared/src/types/agents.ts` (append types)
- Create: `src/main/lib/agents/quota.ts`
- Modify: `src/main/lib/server/routes/db-io.ts:136-146` (reset removes the file)
- Test: `tests/unit/main/lib/agents/quota.test.ts`, `tests/unit/main/lib/server/routes/db-io.test.ts`

**Interfaces:**

- Produces (shared): `QuotaWindow`, `CliQuota`, `QuotaState`
- Produces (`agents/quota.ts`): `toMs(n: number): number`, `recordQuota(q: CliQuota, opts?: { merge?: boolean }): void`, `getQuota(cli: CliId): CliQuota | null`, `listQuotas(): CliQuota[]`, `forgetAllQuotas(): Promise<void>`, `blockedUntil(q: CliQuota | null, model: string | null | undefined): QuotaWindow | null`, `formatQuotaForPm(q: CliQuota | null, cli: CliId, now: number): string`, `resetQuotaStoreForTests(): void`

- [ ] **Step 1: Add the shared types** — append to `packages/shared/src/types/agents.ts`:

```ts
/** One window of a CLI's quota, as the CLI reported it. Times in epoch ms. */
export interface QuotaWindow {
  /** `five_hour`, `seven_day`, a model's own window, Codex `primary` / `secondary` / `<limit> primary`. */
  name: string
  /** 0–100. */
  usedPercent: number
  resetsAt: number | null
  /** Set when the window counts one model only (e.g. `opus`); absent for the account's windows. */
  model?: string
}

/** The CLI's own verdict, never inferred from the percentages. */
export type QuotaState = 'ok' | 'warning' | 'rejected'

export interface CliQuota {
  cli: CliId
  windows: QuotaWindow[]
  state: QuotaState
  /** The window the CLI named when it rejected, when it named one. */
  rejectedWindow: string | null
  /** May the CLI run past the limit at a cost. */
  overage: boolean
  /** When this was reported (epoch ms). */
  asOf: number
}
```

- [ ] **Step 2: Write the failing store tests** — `tests/unit/main/lib/agents/quota.test.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { CliQuota } from '@exodus/shared/types/agents'
import { beforeEach, describe, expect, it } from 'vitest'

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
    expect(blockedUntil(null, 'opus')).toBeNull()
    expect(blockedUntil(claude(), 'opus')).toBeNull()
    expect(
      blockedUntil(claude({ state: 'rejected', overage: true }), 'opus')
    ).toBeNull()
  })

  it('a full account window blocks every model', () => {
    const q = claude({
      state: 'rejected',
      rejectedWindow: 'seven_day',
      windows: [{ name: 'seven_day', usedPercent: 100, resetsAt: NOW + 1000 }]
    })
    expect(blockedUntil(q, 'sonnet')?.name).toBe('seven_day')
    expect(blockedUntil(q, null)?.resetsAt).toBe(NOW + 1000)
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
    expect(blockedUntil(q, 'claude-opus-4-8')?.name).toBe('seven_day_opus')
    expect(blockedUntil(q, 'opus')?.resetsAt).toBe(NOW + 9000)
    expect(blockedUntil(q, 'sonnet')).toBeNull()
    expect(blockedUntil(q, null)).toBeNull()
  })

  it('a rejection with no window detail still blocks, reset unknown', () => {
    const q = claude({ state: 'rejected', rejectedWindow: null, windows: [] })
    expect(blockedUntil(q, 'opus')).toEqual({
      name: 'limit',
      usedPercent: 100,
      resetsAt: null
    })
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `bunx vitest run tests/unit/main/lib/agents/quota.test.ts`
Expected: FAIL — `Cannot find module '@main/lib/agents/quota'`.

- [ ] **Step 4: Implement `src/main/lib/agents/quota.ts`**

```ts
// src/main/lib/agents/quota.ts — what each CLI last said of the owner's quota
// (spec 2026-10-16 §3). Kept per CLI, in memory and in ~/.exodus/agent-quota.json:
// Claude Code only reports during a run, so a restart must not forget it.
import { existsSync, readFileSync } from 'fs'
import { rm, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  CLI_NAMES,
  type CliId,
  type CliQuota,
  type QuotaWindow
} from '@exodus/shared/types/agents'

import { logger } from '../logger'
import { getExodusHome } from '../paths'

const fileOf = () => join(getExodusHome(), 'agent-quota.json')
let store: Map<CliId, CliQuota> | null = null

/** CLIs give epoch seconds; Exodus keeps ms. */
export const toMs = (n: number) => (n < 1e12 ? n * 1000 : n)

function load(): Map<CliId, CliQuota> {
  if (store) return store
  store = new Map()
  try {
    if (existsSync(fileOf())) {
      const rows = JSON.parse(readFileSync(fileOf(), 'utf8')) as unknown
      if (Array.isArray(rows))
        for (const q of rows as CliQuota[])
          if (q && typeof q.cli === 'string' && Array.isArray(q.windows))
            store.set(q.cli, q)
    }
  } catch (error) {
    logger.warn('agents', 'agent-quota.json unreadable; starting empty', {
      error
    })
  }
  return store
}

function save() {
  const rows = [...load().values()]
  void writeFile(fileOf(), JSON.stringify(rows, null, 2)).catch((error) =>
    logger.warn('agents', 'agent-quota.json not written', { error })
  )
}

/** `merge`: a sparse update (Codex's `updated`) keeps windows it does not name. */
export function recordQuota(q: CliQuota, opts: { merge?: boolean } = {}) {
  const prev = load().get(q.cli)
  let next = q
  if (opts.merge && prev) {
    const byName = new Map(prev.windows.map((w) => [w.name, w]))
    for (const w of q.windows) byName.set(w.name, w)
    next = { ...q, windows: [...byName.values()] }
  }
  load().set(q.cli, next)
  save()
}

export const getQuota = (cli: CliId): CliQuota | null => load().get(cli) ?? null
export const listQuotas = (): CliQuota[] => [...load().values()]

export async function forgetAllQuotas() {
  load().clear()
  await rm(fileOf(), { force: true })
}

export function resetQuotaStoreForTests() {
  store = null
}

const modelMatches = (windowModel: string, model: string | null | undefined) =>
  !!model && model.toLowerCase().includes(windowModel.toLowerCase())

/**
 * The window that stops `model` from running now, or null. Only the CLI's own
 * `rejected` without overage blocks — a stale or high reading never does.
 */
export function blockedUntil(
  q: CliQuota | null,
  model: string | null | undefined
): QuotaWindow | null {
  if (!q || q.state !== 'rejected' || q.overage) return null
  const applies = (w: QuotaWindow) => !w.model || modelMatches(w.model, model)
  const named = q.windows.find((w) => w.name === q.rejectedWindow)
  if (named) return applies(named) ? named : null
  const full = q.windows.filter((w) => w.usedPercent >= 100 && applies(w))
  if (full.length)
    return full.reduce((a, b) =>
      (b.resetsAt ?? 0) > (a.resetsAt ?? 0) ? b : a
    )
  // Rejected with no window detail: block, reset unknown.
  return q.windows.length
    ? null
    : { name: 'limit', usedPercent: 100, resetsAt: null }
}

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'week'
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

/** One line for the PM's roster (English: the model reads it, not the owner). */
export function formatQuotaForPm(
  q: CliQuota | null,
  cli: CliId,
  now: number
): string {
  const name = CLI_NAMES[cli]
  if (!q) return `${name} quota: unknown (it has not reported any).`
  const parts = q.windows.map((w) => {
    const label = `${w.model ? `${w.model} only: ` : ''}${LABELS[w.name] ?? w.name}`
    const limited =
      q.state === 'rejected' &&
      (w.name === q.rejectedWindow || w.usedPercent >= 100)
    const flag = limited
      ? ` (LIMIT REACHED${w.resetsAt ? `, resets ${when(w.resetsAt)}` : ''})`
      : q.state === 'warning' && w.usedPercent >= 75
        ? ' (warning)'
        : ''
    const reset = !limited && w.resetsAt ? `, resets ${when(w.resetsAt)}` : ''
    return `${label} ${Math.round(w.usedPercent)} %${flag}${reset}`
  })
  if (!parts.length && q.state === 'rejected') parts.push('LIMIT REACHED')
  parts.push(q.overage ? 'overage allowed' : 'no overage')
  return `${name} quota (as of ${ago(now - q.asOf)}): ${parts.join(' · ')}`
}
```

(The `when()` text is locale-fixed English and not asserted in tests, so the suite does not depend on the machine's time zone.)

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run tests/unit/main/lib/agents/quota.test.ts`
Expected: PASS. If `'5-hour 5 %'` fails because a `resets …` suffix was expected inside it, adjust nothing in the test — the assertion uses `toContain` on the prefix.

- [ ] **Step 6: The data reset removes it** — in `src/main/lib/server/routes/db-io.ts` add `import { forgetAllQuotas } from '../../agents/quota'` and, in `dbIo.delete('/reset', …)` after `await removeAllMedia()`:

```ts
// What the CLIs said of the quota is this machine's, and starts over too.
await forgetAllQuotas()
```

In `tests/unit/main/lib/server/routes/db-io.test.ts` add `vi.mock('@main/lib/agents/quota', () => ({ forgetAllQuotas: vi.fn(async () => {}) }))` beside the existing mocks, and to the `DELETE /api/v1/db-io/reset` describe:

```ts
it('forgets the CLIs’ quota readings', async () => {
  const { forgetAllQuotas } = await import('@main/lib/agents/quota')
  await app.request('/reset', { method: 'DELETE' })
  expect(forgetAllQuotas).toHaveBeenCalled()
})
```

(Use the file's existing `app` / request helper name and path — read the file first; the reset test above it shows both.)

- [ ] **Step 7: Run both and commit**

Run: `bunx vitest run tests/unit/main/lib/agents/quota.test.ts tests/unit/main/lib/server/routes/db-io.test.ts` → PASS.

```bash
git add packages/shared/src/types/agents.ts src/main/lib/agents/quota.ts src/main/lib/server/routes/db-io.ts tests/unit/main/lib/agents/quota.test.ts tests/unit/main/lib/server/routes/db-io.test.ts
git commit -m "feat(agents): a quota store — what each CLI last said of the owner's quota, per CLI, in ~/.exodus/agent-quota.json; blockedUntil() is the CLI's own rejection only, a model's window blocks that model only; a reset forgets it"
```

---

### Task 2: Claude Code reports its quota

**Files:**

- Modify: `src/main/lib/agents/driver.ts` (event union)
- Modify: `src/main/lib/agents/card.ts:51-123` (ignore the new event)
- Modify: `src/main/lib/agents/claude-code/protocol.ts:233-248`
- Test: `tests/unit/main/lib/agents/claude-code/protocol.test.ts`, `tests/unit/main/lib/agents/card.test.ts`

**Interfaces:**

- Consumes: `CliQuota`, `toMs` (Task 1)
- Produces: `AgentEvent` member `{ type: 'quota'; quota: CliQuota; merge?: boolean }`; `quotaFromClaudeInfo(info: Record<string, unknown>, now: number): CliQuota | null` exported from `claude-code/protocol.ts`

- [ ] **Step 1: Write the failing parser test** — in `claude-code/protocol.test.ts`, replace the existing rate-limit test's first expectation (an `allowed` event no longer yields nothing — it yields a `quota` event and no notice) and add the probe:

```ts
const PROBE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1792450800,"rateLimitType":"seven_day","utilization":0.85,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.05,"resetsAt":1792159800},"seven_day":{"utilization":0.85,"resetsAt":1792450800}},"overageEnabled":false},"uuid":"u","session_id":"s"}'

it('turns every rate_limit_event into a quota reading (the 2026-10-16 probe)', () => {
  const { events } = parseLine(PROBE)
  const q = events.find((e) => e.type === 'quota')
  expect(q).toMatchObject({
    type: 'quota',
    quota: {
      cli: 'claude-code',
      state: 'warning',
      overage: false,
      rejectedWindow: null,
      windows: [
        { name: 'five_hour', usedPercent: 5, resetsAt: 1792159800_000 },
        { name: 'seven_day', usedPercent: 85, resetsAt: 1792450800_000 }
      ]
    }
  })
  // allowed_warning is not `allowed`: the card keeps its quiet notice line.
  expect(events.some((e) => e.type === 'notice')).toBe(true)
})

it('an allowed reading is a quota event and no notice', () => {
  const { events } = parseLine(
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1792159800}}}}'
  )
  expect(events.map((e) => e.type)).toEqual(['quota'])
})

it('keeps a window it does not know by name, a model’s own one marked', () => {
  const { events } = parseLine(
    '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"seven_day_opus","utilization":1,"resetsAt":1792450800}}'
  )
  const q = events.find((e) => e.type === 'quota') as Extract<
    AgentEvent,
    { type: 'quota' }
  >
  expect(q.quota.state).toBe('rejected')
  expect(q.quota.rejectedWindow).toBe('seven_day_opus')
  expect(q.quota.windows).toEqual([
    {
      name: 'seven_day_opus',
      usedPercent: 100,
      resetsAt: 1792450800_000,
      model: 'opus'
    }
  ])
})
```

Delete the old assertion `expect(parseLine('…"status":"allowed"}}').events).toEqual([])` from the existing test (keep its `rejected` → notice part). Add `import type { AgentEvent } from '@main/lib/agents/driver'` if the file lacks it.

- [ ] **Step 2: Run to see it fail**

Run: `bunx vitest run tests/unit/main/lib/agents/claude-code/protocol.test.ts`
Expected: FAIL — no `quota` event.

- [ ] **Step 3: Add the event** — in `src/main/lib/agents/driver.ts` import `CliQuota` from `@exodus/shared/types/agents` (extend the existing type import) and add to `AgentEvent`:

```ts
  /** What the CLI said of the owner's quota; `merge`: a sparse update. */
  | { type: 'quota'; quota: CliQuota; merge?: boolean }
```

In `src/main/lib/agents/card.ts`'s `switch (e.type)` add, before `case 'exit':`

```ts
    case 'quota':
      // Kept by the quota store; the card shows the CLI's notice line only.
      return card
```

and in `tests/unit/main/lib/agents/card.test.ts` add:

```ts
it('a quota reading leaves the card as it is', () => {
  const card =
    /* the file's existing helper that builds a working card */
    expect(
      applyAgentEvent(card, {
        type: 'quota',
        quota: {
          cli: 'claude-code',
          windows: [],
          state: 'ok',
          rejectedWindow: null,
          overage: false,
          asOf: 1
        }
      })
    ).toBe(card)
})
```

(Read `card.test.ts` first and use its own card-building helper in place of the comment.)

- [ ] **Step 4: Parse it** — in `claude-code/protocol.ts` add `import type { CliQuota, QuotaState } from '@exodus/shared/types/agents'` and `import { toMs } from '../quota'`, add above `parseLine`:

```ts
const STATES: Record<string, QuotaState> = {
  allowed: 'ok',
  allowed_warning: 'warning',
  rejected: 'rejected'
}

/** A model's own window is named after it: `seven_day_opus` → `opus`. */
const modelOfWindow = (name: string) =>
  /^(?:five_hour|seven_day)_([a-z][\w-]*)$/u.exec(name)?.[1]

/** `rate_limit_info` → the store's shape (spec 2026-10-16 §2). */
export function quotaFromClaudeInfo(info: Json, now: number): CliQuota | null {
  const status = str(info.status)
  if (!status) return null
  const windows: CliQuota['windows'] = []
  const add = (name: string, utilization: unknown, resetsAt: unknown) => {
    if (typeof utilization !== 'number') return
    const model = modelOfWindow(name)
    windows.push({
      name,
      usedPercent: Math.round(utilization * 1000) / 10,
      resetsAt: typeof resetsAt === 'number' ? toMs(resetsAt) : null,
      ...(model ? { model } : {})
    })
  }
  if (isObj(info.unifiedWindows))
    for (const [name, w] of Object.entries(info.unifiedWindows))
      if (isObj(w)) add(name, w.utilization, w.resetsAt)
  const type = str(info.rateLimitType)
  if (type && !windows.some((w) => w.name === type))
    add(type, info.utilization, info.resetsAt)
  const state = STATES[status] ?? 'ok'
  return {
    cli: 'claude-code',
    windows,
    state,
    rejectedWindow: state === 'rejected' ? type : null,
    overage: info.overageEnabled === true && info.overageStatus !== 'rejected',
    asOf: now
  }
}
```

and replace the `case 'rate_limit_event'` body:

```ts
    case 'rate_limit_event': {
      const info = isObj(e.rate_limit_info) ? e.rate_limit_info : {}
      const quota = quotaFromClaudeInfo(info, Date.now())
      const events: AgentEvent[] = quota ? [{ type: 'quota', quota }] : []
      if (info.status === 'allowed' || !str(info.status)) return { events }
      const resets =
        typeof info.resetsAt === 'number'
          ? ` · resets ${new Date(toMs(info.resetsAt)).toLocaleString()}`
          : ''
      events.push({
        type: 'notice',
        text: `Rate limit (${str(info.rateLimitType) ?? 'usage'}): ${str(info.status)}${resets}`
      })
      return { events }
    }
```

- [ ] **Step 5: Run the tests** — `bunx vitest run tests/unit/main/lib/agents/claude-code tests/unit/main/lib/agents/card.test.ts` → PASS. Then `env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck:node` → no errors (any other exhaustive `switch` over `AgentEvent` that now fails gets a `case 'quota':` that does nothing, with a one-line comment).

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/agents/driver.ts src/main/lib/agents/card.ts src/main/lib/agents/claude-code/protocol.ts tests/unit/main/lib/agents
git commit -m "feat(agents): Claude Code's rate_limit_event becomes a quota reading — every window's utilization and reset, its own verdict, overage; a model's own window is kept and marked; the notice line is unchanged"
```

---

### Task 3: Codex reports its quota, and is asked for it

**Files:**

- Modify: `src/main/lib/agents/codex/protocol.ts:450-464`
- Modify: `src/main/lib/agents/cli-check.ts` (add `readCodexQuota` after `listCodexModels`)
- Create: `src/main/lib/agents/quota-refresh.ts`
- Test: `tests/unit/main/lib/agents/codex/protocol.test.ts`, `tests/unit/main/lib/agents/cli-check.test.ts`, `tests/unit/main/lib/agents/quota-refresh.test.ts`

**Interfaces:**

- Consumes: `CliQuota`, `toMs`, `recordQuota`, `getQuota` (Task 1); the `quota` event (Task 2)
- Produces: `quotaFromCodex(body: Record<string, unknown>, now: number): CliQuota | null` (from `codex/protocol.ts`); `readCodexQuota(path: string, env: Record<string, string>, timeoutMs?: number): Promise<CliQuota | null>` (from `cli-check.ts`); `refreshQuotas(clis: CliId[], deps?: RefreshDeps): Promise<void>` (from `quota-refresh.ts`)

- [ ] **Step 1: Write the failing parser test** — add to `codex/protocol.test.ts`:

```ts
import { quotaFromCodex } from '@main/lib/agents/codex/protocol'

describe('Codex quota', () => {
  const READ = {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      normalModelSlug: null,
      primary: {
        usedPercent: 12,
        windowDurationMins: 300,
        resetsAt: 1792159800
      },
      secondary: {
        usedPercent: 64,
        windowDurationMins: 10080,
        resetsAt: 1792450800
      },
      credits: { hasCredits: false, unlimited: false, balance: null },
      rateLimitReachedType: null
    },
    rateLimitsByLimitId: {
      codex: null,
      'gpt-5.6-pro': {
        limitId: 'gpt-5.6-pro',
        limitName: 'GPT-5.6 Pro',
        normalModelSlug: 'gpt-5.6-pro',
        primary: null,
        secondary: {
          usedPercent: 100,
          windowDurationMins: 10080,
          resetsAt: 1792450800
        },
        credits: null,
        rateLimitReachedType: 'rate_limit_reached'
      }
    }
  }

  it('reads the account windows and a per-model bucket (account/rateLimits/read)', () => {
    const q = quotaFromCodex(READ, 5)!
    expect(q).toMatchObject({
      cli: 'codex',
      state: 'rejected',
      overage: false,
      asOf: 5
    })
    expect(q.windows).toEqual([
      { name: 'primary', usedPercent: 12, resetsAt: 1792159800_000 },
      { name: 'secondary', usedPercent: 64, resetsAt: 1792450800_000 },
      {
        name: 'GPT-5.6 Pro secondary',
        usedPercent: 100,
        resetsAt: 1792450800_000,
        model: 'gpt-5.6-pro'
      }
    ])
    expect(q.rejectedWindow).toBe('GPT-5.6 Pro secondary')
  })

  it('is ok while nothing is reached, whatever the percentages', () => {
    const q = quotaFromCodex(
      {
        rateLimits: {
          ...READ.rateLimits,
          primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 }
        }
      },
      1
    )!
    expect(q.state).toBe('ok')
  })

  it('a rolling update becomes a merge quota event', () => {
    const parser = createCodexParser('n')
    const { events } = parser.parse(
      JSON.stringify({
        method: 'account/rateLimits/updated',
        params: {
          rateLimits: {
            primary: {
              usedPercent: 30,
              windowDurationMins: 300,
              resetsAt: 1792159800
            }
          }
        }
      })
    )
    expect(events).toMatchObject([
      {
        type: 'quota',
        merge: true,
        quota: { cli: 'codex', windows: [{ name: 'primary', usedPercent: 30 }] }
      }
    ])
  })
})
```

- [ ] **Step 2: Run to see it fail** — `bunx vitest run tests/unit/main/lib/agents/codex/protocol.test.ts` → FAIL (`quotaFromCodex` not exported).

- [ ] **Step 3: Implement** — in `codex/protocol.ts` add `import type { CliQuota } from '@exodus/shared/types/agents'` and `import { toMs } from '../quota'`, then:

```ts
/**
 * `account/rateLimits/read`'s result, or an `updated` notification's params
 * (a sparse snapshot — spec 2026-10-16 §2). A bucket of its own (a model with
 * its own quota) gets its windows prefixed with its name and marked with its model.
 */
export function quotaFromCodex(body: Json, now: number): CliQuota | null {
  const windows: CliQuota['windows'] = []
  let reached = false
  let overage = false
  const take = (snap: unknown, prefix: string) => {
    if (!isObj(snap)) return
    if (snap.rateLimitReachedType != null) reached = true
    if (isObj(snap.credits))
      overage ||=
        snap.credits.hasCredits === true || snap.credits.unlimited === true
    const model = str(snap.normalModelSlug) ?? undefined
    for (const k of ['primary', 'secondary'] as const) {
      const w = snap[k]
      if (!isObj(w) || typeof w.usedPercent !== 'number') continue
      windows.push({
        name: prefix ? `${prefix} ${k}` : k,
        usedPercent: w.usedPercent,
        resetsAt: typeof w.resetsAt === 'number' ? toMs(w.resetsAt) : null,
        ...(prefix && model ? { model } : {})
      })
    }
  }
  const main = isObj(body.rateLimits) ? body.rateLimits : null
  take(main, '')
  if (isObj(body.rateLimitsByLimitId))
    for (const [id, snap] of Object.entries(body.rateLimitsByLimitId)) {
      if (!isObj(snap) || id === (main && str(main.limitId))) continue
      take(snap, str(snap.limitName) ?? id)
    }
  if (!windows.length && !reached && body.ordinaryUsageAllowed !== false)
    return null
  const state =
    reached || body.ordinaryUsageAllowed === false ? 'rejected' : 'ok'
  return {
    cli: 'codex',
    windows,
    state,
    rejectedWindow:
      state === 'rejected'
        ? (windows.find((w) => w.usedPercent >= 100)?.name ?? null)
        : null,
    overage,
    asOf: now
  }
}
```

and replace the `case 'account/rateLimits/updated'` body so it still emits the old notice when a window is full, plus the quota:

```ts
        case 'account/rateLimits/updated': {
          const limits = isObj(params.rateLimits) ? params.rateLimits : {}
          const quota = quotaFromCodex({ rateLimits: limits }, Date.now())
          const events: AgentEvent[] = quota
            ? [{ type: 'quota', quota, merge: true }]
            : []
          const full = ['primary', 'secondary'].some(
            (k) =>
              isObj(limits[k]) &&
              typeof (limits[k] as Json).usedPercent === 'number' &&
              ((limits[k] as Json).usedPercent as number) >= 100
          )
          if (full)
            events.push(notice(`Rate limit reached: ${JSON.stringify(limits)}`))
          return { events }
        }
```

Run: `bunx vitest run tests/unit/main/lib/agents/codex` → PASS (the existing fixtures' replays still pass: they gained only `quota` events if they carry `updated` lines — if a replay test asserts the exact event list, add the `quota` event to its expectation).

- [ ] **Step 4: Failing test for `readCodexQuota`** — in `cli-check.test.ts`, import `readCodexQuota` and add (the file's `fakeAppServer` helper exists):

```ts
it('reads the quota from a short-lived app-server, null when refused or silent', async () => {
  const ok = fakeAppServer(`
  if (m.method === 'initialize') out({ id: m.id, result: {} })
  if (m.method === 'account/rateLimits/read') out({ id: m.id, result: { ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 1792159800 } } } })`)
  expect(await readCodexQuota(ok, {})).toMatchObject({
    cli: 'codex',
    state: 'ok',
    windows: [{ name: 'primary', usedPercent: 7, resetsAt: 1792159800_000 }]
  })
  const refusing = fakeAppServer(`
  if (m.method === 'initialize') out({ id: m.id, result: {} })
  if (m.method === 'account/rateLimits/read') out({ id: m.id, error: { code: -32603, message: 'failed to fetch codex rate limits' } })`)
  expect(await readCodexQuota(refusing, {})).toBeNull()
  expect(await readCodexQuota('/nonexistent/codex', {})).toBeNull()
})
```

Run it → FAIL (not exported).

- [ ] **Step 5: Implement `readCodexQuota`** — refactor `listCodexModels`'s body into a private `askAppServer<T>(path, env, method, pick: (result: unknown) => T | null, timeoutMs): Promise<T | null>` (same process handling, log file and timeout as now; `id: 2` carries `method` with `params: {}`), then:

```ts
export function listCodexModels(
  path: string,
  env: Record<string, string>,
  timeoutMs = MODEL_LIST_TIMEOUT_MS
) {
  return askAppServer(path, env, 'model/list', pickModels, timeoutMs)
}

/** The owner's Codex quota (`account/rateLimits/read` spends none); null when it cannot say. */
export function readCodexQuota(
  path: string,
  env: Record<string, string>,
  timeoutMs = MODEL_LIST_TIMEOUT_MS
) {
  return askAppServer(
    path,
    env,
    'account/rateLimits/read',
    (r) =>
      r && typeof r === 'object'
        ? quotaFromCodex(r as Record<string, unknown>, Date.now())
        : null,
    timeoutMs
  )
}
```

where `pickModels(result)` is the existing `data` → names code moved out unchanged (returning null for a non-array `data`). Import `quotaFromCodex` from `./codex/protocol`. Run all of `cli-check.test.ts` → PASS (the model-list tests prove the refactor kept behaviour, including the "silent app-server is ended" test).

- [ ] **Step 6: `refreshQuotas`** — test first, `tests/unit/main/lib/agents/quota-refresh.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

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
const { refreshQuotas } = await import('@main/lib/agents/quota-refresh')

const deps = (read: () => Promise<unknown>) => ({
  status: async () => ({ state: 'ready', path: '/bin/codex' }) as never,
  env: async () => ({}),
  read: vi.fn(read) as never,
  now: () => 100_000
})

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
})
```

Then `src/main/lib/agents/quota-refresh.ts`:

```ts
// Read the quotas that can be read without spending any before the PM deals
// (spec 2026-10-16 §3): Codex answers any time; Claude Code only reports in a run.
import type { CliId, CliQuota, CliStatus } from '@exodus/shared/types/agents'

import { logger } from '../logger'
import { getCliStatus, readCodexQuota } from './cli-check'
import { loginShellEnv } from './login-shell'
import { getQuota, recordQuota } from './quota'

const FRESH_MS = 60_000

export interface RefreshDeps {
  status(cli: CliId): Promise<CliStatus>
  env(): Promise<Record<string, string>>
  read(path: string, env: Record<string, string>): Promise<CliQuota | null>
  now(): number
}

const defaultDeps: RefreshDeps = {
  status: (cli) => getCliStatus(cli),
  env: loginShellEnv,
  read: (path, env) => readCodexQuota(path, env),
  now: () => Date.now()
}

/** Never throws: a CLI that cannot say keeps what it said last. */
export async function refreshQuotas(
  clis: CliId[],
  deps: RefreshDeps = defaultDeps
) {
  if (!clis.includes('codex')) return
  const last = getQuota('codex')
  if (last && deps.now() - last.asOf < FRESH_MS) return
  try {
    const status = await deps.status('codex')
    if (status.state !== 'ready' || !status.path) return
    const quota = await deps.read(status.path, await deps.env())
    if (quota) recordQuota(quota)
  } catch (error) {
    logger.warn('agents', 'Codex quota read failed', { error })
  }
}
```

(Check `loginShellEnv`'s export name in `login-shell.ts` — `run-agent-employee.ts` imports it — and match it.)

Run: `bunx vitest run tests/unit/main/lib/agents` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/lib/agents/codex/protocol.ts src/main/lib/agents/cli-check.ts src/main/lib/agents/quota-refresh.ts tests/unit/main/lib/agents
git commit -m "feat(agents): Codex's quota — account/rateLimits/read on a short-lived app-server (spends none) and the rolling updates merged in, per-model buckets kept; refreshQuotas() reads it at most once a minute"
```

---

### Task 4: A run's readings reach the store

**Files:**

- Modify: `src/main/lib/agents/run-agent-employee.ts:55-66` (deps), `:316-338` (start block)
- Test: `tests/unit/main/lib/agents/run-agent-employee.test.ts`

**Interfaces:**

- Consumes: `recordQuota` (Task 1), the `quota` event (Tasks 2–3)
- Produces: `RunAgentEmployeeDeps.recordQuota(q: CliQuota, merge: boolean): void`

- [ ] **Step 1: Failing test** — read `run-agent-employee.test.ts` for how it builds `deps` (a fake `start` returning a scripted `AgentRun`) and add a case where the fake run emits, before its `turn_end`:

```ts
it('hands every quota reading of the process to the store, the step’s or not', async () => {
  const recordQuota = vi.fn()
  // …the file's own fake run, scripted to emit:
  //   { type: 'quota', quota: Q, merge: false } then turn_end
  // and after the step resolves, one more { type: 'quota', quota: Q2, merge: true }
  // …run the step with deps = { ...theFilesDeps, recordQuota }
  expect(recordQuota).toHaveBeenNthCalledWith(1, Q, false)
  expect(recordQuota).toHaveBeenNthCalledWith(2, Q2, true)
})
```

Write it concretely with the file's helpers (`Q` / `Q2` are `CliQuota` literals like Task 1's `claude()`). Run → FAIL.

- [ ] **Step 2: Implement** — add to `RunAgentEmployeeDeps`:

```ts
  /** Every `quota` event of a process, for the life of the process (spec 2026-10-16 §3). */
  recordQuota(q: CliQuota, merge: boolean): void
```

default `recordQuota: (q, merge) => recordQuota(q, { merge })` (import `recordQuota` from `./quota`, `CliQuota` from shared). In the `if (!run) { … }` block, right after `deps.registry.attach(…)`:

```ts
// Its own listener: the step's listener comes and goes, the process stays.
run.on((e) => {
  if (e.type === 'quota') deps.recordQuota(e.quota, e.merge === true)
})
```

Update every test in the file that builds `deps` without `recordQuota` to add `recordQuota: vi.fn()` (typecheck lists them). Run the file → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/lib/agents/run-agent-employee.ts tests/unit/main/lib/agents/run-agent-employee.test.ts
git commit -m "feat(agents): a CLI process's quota readings go to the store for as long as it runs"
```

---

### Task 5: The PM deals with the quota in view

**Files:**

- Modify: `src/main/lib/ai/philharmonic/pm-coordinator.ts` (prompt, roster, delegate guard, wait tool)
- Modify: `src/main/lib/ai/philharmonic/pm-tools.ts` (`createWaitForQuotaTool`)
- Test: `tests/unit/main/lib/ai/philharmonic/pm-tools.test.ts`, `tests/unit/main/lib/ai/philharmonic/pm-coordinator.test.ts`

**Interfaces:**

- Consumes: `getQuota`, `blockedUntil`, `formatQuotaForPm` (Task 1), `refreshQuotas` (Task 3); `getUpcomingOneOffTasks`, `createTask`, `updateTask` (`db/philharmonic-queries.ts`); `updateStep` (`db/plan-queries.ts`)
- Produces: `createWaitForQuotaTool(onWait: (p: { stepId: string; employeeId: string; reason: string }) => Promise<string>): AgentTool`; `quotaWaitRunAt(resetsAt: number | null, now: number): Date`

- [ ] **Step 1: Failing tool test** — add to `pm-tools.test.ts` (extend the `Type` mock with nothing new — the tool uses `Object` / `String` only), importing `createWaitForQuotaTool`:

```ts
it('wait tool passes step, employee and reason through', async () => {
  const onWait = vi.fn(async () => 'waiting until Tue 07:02')
  const tool = createWaitForQuotaTool(onWait)
  expect(tool.name).toBe('waitForQuota')
  const res = await tool.execute('id', {
    stepId: 's1',
    employeeId: 'a1',
    reason: 'needs opus'
  })
  expect(onWait).toHaveBeenCalledWith({
    stepId: 's1',
    employeeId: 'a1',
    reason: 'needs opus'
  })
  expect(JSON.stringify(res)).toContain('waiting until')
})
```

Run → FAIL. Implement in `pm-tools.ts`:

```ts
/** Park a step until the quota that blocks its employee resets (spec 2026-10-16 §5). */
export function createWaitForQuotaTool(
  onWait: (p: {
    stepId: string
    employeeId: string
    reason: string
  }) => Promise<string>
): AgentTool {
  return {
    name: 'waitForQuota',
    label: 'Wait for Quota',
    description:
      'The step needs an employee whose quota is used up and no other employee can do it well: leave the step pending and get woken when the quota resets. Then end your turn with one line saying what you are waiting for. Do not use it while the employee can still run, or when another employee could do the step.',
    parameters: Type.Object({
      stepId: Type.String({ description: 'the plan step that waits' }),
      employeeId: Type.String({
        description: 'the employee the step waits for'
      }),
      reason: Type.String({
        description:
          'one line for the owner: what waits for what, and why not someone else'
      })
    }),
    execute: async (
      _id: string,
      p: { stepId: string; employeeId: string; reason: string }
    ) => {
      const result = await onWait(p)
      return {
        content: [{ type: 'text' as const, text: result }],
        details: { ...p, result }
      }
    }
  } as AgentTool
}

/** Two minutes after the reset; an unknown reset is checked again in an hour. */
export const quotaWaitRunAt = (resetsAt: number | null, now: number) =>
  new Date(resetsAt ? Math.max(resetsAt, now) + 2 * 60_000 : now + 60 * 60_000)
```

with a test `quotaWaitRunAt(1000, 0)` → `new Date(121_000)`, `quotaWaitRunAt(null, 0)` → `new Date(3_600_000)`, `quotaWaitRunAt(0, 5000)` (a reset already past) → `new Date(125_000)`. Run → PASS.

- [ ] **Step 2: Failing coordinator tests** — `pm-coordinator.test.ts` already mocks the DB, plans and `runDelegatedTask`, and captures what `agentLoop` is called with (read the "is described to the PM as a coding agent" test for how it inspects the system message and calls a tool). Add `vi.mock('@main/lib/agents/quota-refresh', () => ({ refreshQuotas: vi.fn(async () => {}) }))` and `vi.mock('@main/lib/agents/quota', …)` with `getQuota` returning a per-test value, `blockedUntil` and `formatQuotaForPm` from the real module (`vi.importActual`). Mock `getUpcomingOneOffTasks`, `createTask`, `updateTask` in the existing `philharmonic-queries` mock. Then:

```ts
it('tells the PM each CLI employee’s model and its CLI’s quota, and how to deal', async () => {
  // active agents: a claude-code employee with model 'opus', one with model null
  // getQuota('claude-code') → a warning reading; codex has no employee
  // …run the coordinator
  // system message:
  expect(system).toContain('model: opus')
  expect(system).toContain('model: CLI default')
  expect(system).toMatch(
    /Claude Code quota \(as of .*\): .*week 85 % \(warning\)/
  )
  expect(system).toContain('schedule flexibly')
  expect(refreshQuotas).toHaveBeenCalledWith(['claude-code'])
})

it('does not start an employee its CLI has rejected; tells the PM the reset', async () => {
  // getQuota → state 'rejected', rejectedWindow 'seven_day', windows [{ seven_day 100 resetsAt R }], overage false
  // call delegateTask({ employeeId: opusId, instructions: 'x', stepId: 's1' }) through the captured tools
  expect(runDelegatedTask).not.toHaveBeenCalled()
  expect(plans.updateStep).not.toHaveBeenCalledWith('s1', { status: 'running' })
  expect(result).toMatch(/quota is used up .*seven_day 100 %/)
  expect(result).toMatch(/waitForQuota/)
})

it('waitForQuota parks the step and schedules one wake-up, moved on a second call', async () => {
  // getQuota → rejected as above, resetsAt R
  // first call: no upcoming tasks
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: 'c1',
      status: 'pending',
      runAt: new Date(R + 120_000),
      input: { kind: 'quota-wait', stepId: 's1', employeeId: opusId }
    })
  )
  expect(plans.updateStep).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      status: 'pending',
      note: expect.stringContaining('waiting for')
    })
  )
  // second call: getUpcomingOneOffTasks returns that task (id 't-wait')
  expect(updateTask).toHaveBeenCalledWith('t-wait', {
    runAt: new Date(R + 120_000)
  })
  expect(createTask).toHaveBeenCalledTimes(1)
})

it('waitForQuota refuses when nothing blocks the employee', async () => {
  // getQuota → warning, not rejected
  expect(result).toMatch(/nothing blocks .* delegate/i)
  expect(createTask).not.toHaveBeenCalled()
})
```

Fill the `// …` lines with the file's own agent fixtures and tool-capture helper (as in its existing tests) — every expectation above stays as written. Run → FAIL.

- [ ] **Step 3: Implement in `pm-coordinator.ts`**

1. Imports: `getQuota`, `blockedUntil`, `formatQuotaForPm` from `../../agents/quota`; `refreshQuotas` from `../../agents/quota-refresh`; `isCliId` from `../../agents/drivers` (beside `cliOf`); `createTask`, `getUpcomingOneOffTasks`, `updateTask` from `../../db/philharmonic-queries`; `createWaitForQuotaTool`, `quotaWaitRunAt` from `./pm-tools`; `CliId` type from shared.

2. Append to `PM_SYSTEM_PROMPT` (before the final "Delegate to one employee at a time."):

```
Dealing the work (coding-agent employees run on the owner's own CLI subscriptions, which have quotas):
- Deal by difficulty: hard or open-ended steps to the strongest suitable model, routine steps to an ordinary one — from the start, so the skilled hand's quota lasts.
- Read the quota lines under Employees. When a skilled hand's window is at 90 % or more, or marked warning / LIMIT REACHED: downgrade the step to an ordinary hand if one can do it well; otherwise call waitForQuota for it. Weigh how far the reset is — a 5-hour window resets within hours, a weekly one may be days away.
- These are rules of thumb: schedule flexibly. Run steps that do not need the waiting hand first, split a step so part goes to an ordinary hand, or give it to another CLI's employee, whenever that serves the work better.
- Say every such decision in one line in the group, with the numbers and the reset time.
```

3. After `roster` is built, compute the CLIs in play and refresh:

```ts
const clisInPlay = [
  ...new Set(
    employees.filter((e) => isCliId(e.runtime)).map((e) => e.runtime as CliId)
  )
]
await refreshQuotas(clisInPlay)
const now = Date.now()
const quotaText = clisInPlay
  .map((cli) => formatQuotaForPm(getQuota(cli), cli, now))
  .join('\n')
```

and change the coding-agent suffix in `roster` to name the model: `[Coding agent — ${CLI_NAMES[cliOf(e.runtime)]} (model: ${e.model || 'CLI default'}) on the owner's machine; …]`, and `rosterText` likewise for a CLI employee (add `runtime` and `model` to its parameter type and append ` (${CLI_NAMES[cliOf(a.runtime)]}, model: ${a.model || 'CLI default'})` after the name when `a.runtime !== 'exodus'`). The system content becomes:

```ts
PM_SYSTEM_PROMPT +
  `\n\nEmployees:\n${rosterText(employees, teamNameById)}` +
  (quotaText ? `\n\nQuota:\n${quotaText}` : '')
```

4. Guard at the top of the `createDelegateTaskTool` callback, before `if (stepId)`:

```ts
const blocked = quotaBlock(employeeId)
if (blocked) return blocked
```

with, inside `runPmCoordinator` above `tools`:

```ts
const quotaBlock = (employeeId: string): string | null => {
  const emp = employees.find((e) => e.id === employeeId)
  if (!emp || !isCliId(emp.runtime)) return null
  const w = blockedUntil(getQuota(emp.runtime), emp.model)
  if (!w) return null
  const reset = w.resetsAt
    ? new Date(w.resetsAt).toLocaleString('en-US', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : 'an unknown time'
  return `Not started: ${emp.name}'s ${CLI_NAMES[emp.runtime]} quota is used up (${w.name} ${Math.round(w.usedPercent)} %), resets ${reset}. Give the step to another employee, or call waitForQuota.`
}
```

5. Add the tool to `tools` (after `createRecruitEmployeeTool(…)`):

```ts
    createWaitForQuotaTool(async ({ stepId, employeeId, reason }) => {
      const emp = employees.find((e) => e.id === employeeId)
      const w = emp && isCliId(emp.runtime) ? blockedUntil(getQuota(emp.runtime), emp.model) : null
      if (!emp || !w)
        return 'Refused: nothing blocks that employee right now — delegate the step instead.'
      const runAt = quotaWaitRunAt(w.resetsAt, Date.now())
      const note = `waiting for ${emp.name}'s ${w.name} quota — ${reason}`
      const step = await updateStep(stepId, { status: 'pending', note })
      emit({ type: 'plan_step_updated', conversationId, stepId, patch: { status: step.status, note: step.note } })
      await mirrorActivePlan()
      const existing = (await getUpcomingOneOffTasks()).find(
        (t) => t.conversationId === conversationId && t.input?.kind === 'quota-wait' && t.input?.stepId === stepId
      )
      if (existing) await updateTask(existing.id, { runAt })
      else
        await createTask({
          conversationId,
          title: `Quota reset — continue "${step.title}"`,
          description: `${reason}\nThe quota that stopped ${emp.name} should have reset. Read the quota lines, then continue the plan from step ${stepId}.`,
          status: 'pending',
          priority: 'medium',
          assignedAgentId: null,
          input: { kind: 'quota-wait', stepId, employeeId },
          output: null,
          runAt,
          maxRetries: 1,
          retryCount: 0
        })
      return `Step parked. You will be woken at ${runAt.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}. End your turn now with one line for the owner saying what waits and why.`
    }),
```

Run: `bunx vitest run tests/unit/main/lib/ai/philharmonic` → PASS; `env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck:node` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/lib/ai/philharmonic tests/unit/main/lib/ai/philharmonic
git commit -m "feat(philharmonic): the PM deals with the quota in view — each CLI employee's model and its CLI's quota in the roster, deal-by-difficulty guidance it applies flexibly, delegateTask refuses an employee its CLI has rejected, and waitForQuota parks a step until the reset (a one-off task, moved on a second call)"
```

---

### Task 6: The members panel shows the quota

**Files:**

- Modify: `src/main/lib/server/routes/agents.ts` (route)
- Modify: `src/renderer/services/agents.ts`
- Create: `src/renderer/hooks/use-agent-quota.ts`, `src/renderer/lib/agent-quota.ts`
- Modify: `src/renderer/components/philharmonic/chat/group-members-panel.tsx:157-210`
- Modify: `packages/shared/src/i18n/locales/{de,en,es,fr,it,ja,ko,pt-BR,zh-Hant-HK,zh-Hant-TW}/philharmonic.json` (`chat.membersPanel.quota.*`)
- Test: `tests/unit/main/lib/server/routes/agents.test.ts`, `tests/unit/renderer/lib/agent-quota.test.ts`

**Interfaces:**

- Consumes: `listQuotas` (Task 1); `CliQuota` (shared)
- Produces: `GET /api/v1/agents/quota` → `CliQuota[]`; `getQuotas(): Promise<CliQuota[]>`; `useAgentQuotas(): UseQueryResult<CliQuota[]>`; `quotaParts(q: CliQuota): QuotaPart[]` where `type QuotaPart = { key: 'fiveHour' | 'sevenDay' | 'other'; name: string; percent: number; limited: boolean; resetsAt: number | null }`

- [ ] **Step 1: Route test first** — in `tests/unit/main/lib/server/routes/agents.test.ts` mock `@main/lib/agents/quota` with `listQuotas: () => [Q]` and add:

```ts
it('GET /quota lists what each CLI last said of the quota', async () => {
  const res = await app.request('/quota')
  expect(res.status).toBe(200)
  expect((await res.json()).data).toEqual([Q])
})
```

(use the file's own `app` and its response envelope — read the `/clis` test above it). Run → FAIL. Add to `agents.ts` after `router.get('/clis', …)`:

```ts
router.get('/quota', (c) => successResponse(c, listQuotas()))
```

with `import { listQuotas } from '../../agents/quota'`. Run → PASS.

- [ ] **Step 2: The pure label rule, test first** — `tests/unit/renderer/lib/agent-quota.test.ts`:

```ts
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
```

Run → FAIL. Create `src/renderer/lib/agent-quota.ts`:

```ts
import type { CliQuota } from '@exodus/shared/types/agents'

export interface QuotaPart {
  key: 'fiveHour' | 'sevenDay' | 'other'
  /** The window's name, or the model a window of its own counts. */
  name: string
  percent: number
  limited: boolean
  resetsAt: number | null
}

const KEYS: Record<string, QuotaPart['key']> = {
  five_hour: 'fiveHour',
  seven_day: 'sevenDay'
}

/** One CLI's quota as the members panel words it (spec 2026-10-16 §6). */
export function quotaParts(q: CliQuota): QuotaPart[] {
  return q.windows.map((w) => ({
    key: (!w.model && KEYS[w.name]) || 'other',
    name: w.model ?? w.name,
    percent: Math.round(w.usedPercent),
    limited:
      q.state === 'rejected' &&
      (w.name === q.rejectedWindow || w.usedPercent >= 100),
    resetsAt: w.resetsAt
  }))
}
```

Run → PASS.

- [ ] **Step 3: Service + hook** — `services/agents.ts`: `export const getQuotas = () => fetcher<CliQuota[]>(`${BASE}/quota`)` (add `CliQuota` to the type import). `src/renderer/hooks/use-agent-quota.ts`:

```ts
import { useQuery } from '@tanstack/react-query'

import { getQuotas } from '@/services/agents'

export const agentQuotaKeys = { all: ['agent-quota'] as const }

/** What each CLI last said of the owner's quota; a run updates it, so it is re-read every minute. */
export function useAgentQuotas() {
  return useQuery({
    queryKey: agentQuotaKeys.all,
    queryFn: getQuotas,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  })
}
```

- [ ] **Step 4: Catalog keys in all 10 locales** — under `chat.membersPanel` in each `philharmonic.json` add `"quota": { … }`:

| key        | en                                | de                                        | es                                          | fr                                         | it                                      |
| ---------- | --------------------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `fiveHour` | `5h {{percent}}%`                 | `5 Std. {{percent}} %`                    | `5 h {{percent}} %`                         | `5 h {{percent}} %`                        | `5 h {{percent}}%`                      |
| `sevenDay` | `week {{percent}}%`               | `Woche {{percent}} %`                     | `semana {{percent}} %`                      | `semaine {{percent}} %`                    | `settimana {{percent}}%`                |
| `other`    | `{{name}} {{percent}}%`           | `{{name}} {{percent}} %`                  | `{{name}} {{percent}} %`                    | `{{name}} {{percent}} %`                   | `{{name}} {{percent}}%`                 |
| `limited`  | `limit reached · resets {{time}}` | `Limit erreicht · zurückgesetzt {{time}}` | `límite alcanzado · se restablece {{time}}` | `limite atteinte · réinitialisée {{time}}` | `limite raggiunto · si azzera {{time}}` |

| key        | ja                                 | ko                              | pt-BR                                 | zh-Hant-HK                 | zh-Hant-TW                 |
| ---------- | ---------------------------------- | ------------------------------- | ------------------------------------- | -------------------------- | -------------------------- |
| `fiveHour` | `5時間 {{percent}}%`               | `5시간 {{percent}}%`            | `5 h {{percent}}%`                    | `5 小時 {{percent}}%`      | `5 小時 {{percent}}%`      |
| `sevenDay` | `週 {{percent}}%`                  | `주간 {{percent}}%`             | `semana {{percent}}%`                 | `本週 {{percent}}%`        | `本週 {{percent}}%`        |
| `other`    | `{{name}} {{percent}}%`            | `{{name}} {{percent}}%`         | `{{name}} {{percent}}%`               | `{{name}} {{percent}}%`    | `{{name}} {{percent}}%`    |
| `limited`  | `上限に到達 · {{time}} にリセット` | `한도 도달 · {{time}}에 초기화` | `limite atingido · reinicia {{time}}` | `已達上限 · {{time}} 重設` | `已達上限 · {{time}} 重設` |

Run: `bun run i18n:check` → `i18n:check OK`.

- [ ] **Step 5: The line in `MemberRow`** — under the model line, for a CLI member only:

```tsx
{
  member.runtime !== 'exodus' && <QuotaLine cli={cliOf(member.runtime)} />
}
```

and in the same file:

```tsx
function QuotaLine({ cli }: { cli: CliId }) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  const { data } = useAgentQuotas()
  const q = data?.find((x) => x.cli === cli)
  if (!q) return null
  const parts = quotaParts(q)
  const limit = parts.find((p) => p.limited)
  const text = parts
    .map((p) =>
      t(`chat.membersPanel.quota.${p.key}`, {
        name: p.name,
        percent: p.percent
      })
    )
    .join(' · ')
  return (
    <div
      className={cn(
        'truncate text-xs',
        limit ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {limit?.resetsAt
        ? `${text} · ${t('chat.membersPanel.quota.limited', { time: dateTime(new Date(limit.resetsAt), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}`
        : text}
    </div>
  )
}
```

Imports: `useAgentQuotas` from `@/hooks/use-agent-quota`, `quotaParts` from `@/lib/agent-quota`, `useFormat` from `@/lib/format`, `CliId` from `@exodus/shared/types/agents`, and a renderer-safe `cliOf` — if the renderer has none, map with `member.runtime as CliId` (runtime is `'claude-code' | 'codex'` once it is not `'exodus'`; check `AgentData['runtime']`'s type). Run: `bunx vitest run tests/unit/i18n tests/unit/renderer` (the no-hardcoded-strings scan) and `env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck:web` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/server/routes/agents.ts src/renderer packages/shared/src/i18n tests/unit
git commit -m "feat(philharmonic): a CLI member's quota under its model in the members panel — 5h / week / a model's own window, red with the reset when its CLI has stopped it (GET /api/v1/agents/quota)"
```

---

### Task 7: Docs, QA line and the whole gate

**Files:**

- Modify: `CLAUDE.md` (Philharmonic section; Data directory list; route list mention under `/api/v1/agents` if listed — `grep -n "api/v1/agents" CLAUDE.md` first)
- Modify: `docs/manual-qa-checklist.md`
- Modify: `docs/superpowers/specs/2026-10-16-pm-quota-aware-dealing-design.md` (Status line → implemented)

- [ ] **Step 1: CLAUDE.md** — in "### Philharmonic (multi-agent Groups)" add a bullet:

```markdown
- **Quota-aware dealing** (spec `docs/superpowers/specs/2026-10-16-pm-quota-aware-dealing-design.md`):
  what each CLI reports of the owner's quota — Claude Code's `rate_limit_event` on every turn,
  Codex's `account/rateLimits/read` (free; `refreshQuotas()` at most once a minute) and its
  rolling updates — becomes a `quota` agent event and one `CliQuota` per CLI in
  `src/main/lib/agents/quota.ts` (`~/.exodus/agent-quota.json`; a data reset removes it). The PM's
  roster names each CLI employee's model and its CLI's quota; it deals by difficulty, downgrades
  or calls `waitForQuota` (a one-off task at the reset + 2 min, `input.kind: 'quota-wait'`) and
  schedules flexibly around those rules. `delegateTask` refuses only an employee its CLI has
  `rejected` without overage (`blockedUntil()`); a high or stale reading never blocks. The members
  panel shows the line (`GET /api/v1/agents/quota`)
```

- [ ] **Step 2: QA checklist** — add to `docs/manual-qa-checklist.md`'s Philharmonic/agents section (match its P-level format):

```markdown
- [ ] P1 Quota-aware dealing: two Claude Code employees (opus, sonnet) and a plan with a hard and an easy step — the easy one goes to sonnet; each CLI member shows its quota line; with a weekly window over 90 % (or a limit reached) the PM downgrades or waits, says why with the numbers, and a waiting step shows in the Schedule tab and resumes after the reset
```

- [ ] **Step 3: Spec status** — change the spec's `Status:` to `implemented 2026-10-16 (plan docs/superpowers/plans/2026-10-16-pm-quota-aware-dealing.md)`.

- [ ] **Step 4: Whole gate**

Run: `bun run fmt && bun run lint && env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck && bun run i18n:check && bun run test`
Expected: all pass (the CLAUDE.md freshness test checks the new paths exist). A lone `RuntimeError: Aborted()` from PGlite teardown with every test passing is the known flake: re-run `bun run test` once.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/manual-qa-checklist.md docs/superpowers/specs/2026-10-16-pm-quota-aware-dealing-design.md
git commit -m "docs: quota-aware dealing in CLAUDE.md and the owner's QA checklist"
```
