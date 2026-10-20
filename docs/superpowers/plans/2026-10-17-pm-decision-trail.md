# PM Decision Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every Philharmonic PM round (input, reports read, thinking, text, tool calls with arguments and results, usage, error), show it under the PM's message as an expandable decision process, label employee reports with their author in the PM's context, and expose the trail in Chat Audit.

**Architecture:** A `RoundRecorder` (main) turns the PM's `agentLoop` events into ordered, masked rows of a new `pm_round_event` table; the PM's final / error message carries the round's id (`conversation_message.roundId`). A route serves one round; the renderer draws it lazily under the PM bubble. The DuckDB snapshot gains two tables and a preset.

**Tech Stack:** TypeScript, Electron main (Hono, Drizzle/PGlite), pi-agent-core events, React 19 + React Query, Vitest (+ happy-dom), Playwright, DuckDB, i18next.

**Spec:** `docs/superpowers/specs/2026-10-17-pm-decision-trail-design.md`

## Global Constraints

- Branch `maintenance`; never push. Pre-commit gate: `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test` (husky runs it). Typecheck as `env PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck`.
- Scope: the PM only. Employee reports are linked by message id and name, never copied into the trail.
- Capture is passive: the PM's behaviour, prompts and tools do not change (except the LCM's author label, Task 4).
- A recording failure never fails a PM round: every trail write is best-effort and logged (`logger.warn('philharmonic', …)`).
- Every string in a stored payload passes `maskLogText()` (`src/main/lib/logger/secret-mask.ts`) before it is written.
- A round that fails midway keeps the events already written and adds an `error` event.
- Event kinds (exact): `input`, `reports`, `thinking`, `text`, `tool_call`, `tool_result`, `usage`, `error`.
- Migration is `0018` (latest shipped is `0017_codex_runtime`); `pm_round_event` cascades from `conversation`.
- New user-facing strings: catalog keys in **all 10 locales** (`de en es fr it ja ko pt-BR zh-Hant-HK zh-Hant-TW`), authored by hand in the same commit; no i18next plural suffixes (parity across locales).
- New interactive element → `TEST_IDS` entry + `data-testid` + a Playwright reference (`test-ids.linkage.test.ts`).
- Tests under `tests/unit/**` mirroring `src/`; imports via `@main/…`, `@/…`, `@actovia/shared/…`; DOM tests start with `// @vitest-environment happy-dom`. No real model: the coordinator tests use the file's existing `agentLoopMock` + `fakeStream` (ruling: same scripted-event approach the suite already uses; the spec's "faux provider" intent — no key, scripted events — is met).

## Review Focus

1. **A recorder write throws (DB error)** — the PM round still completes and saves its message. Pinned in Task 3.
2. **A tool result that is an object, not text** (`details`, content parts) — stored as readable text, not `[object Object]`. Pinned in Task 2.
3. **An old PM message with no `roundId`** — no disclosure, no fetch, no error. Pinned in Task 5.
4. **A round id from another group** — 404, nothing leaked. Pinned in Task 5.
5. **A secret inside a delegation's instructions** — masked in the stored payload. Pinned in Task 2.

---

### Task 1: Storage — `pm_round_event`, `conversation_message.roundId`, queries

**Files:**

- Modify: `src/main/lib/db/schema.ts` (after `conversationMessage`, ~L394-418)
- Create: `resources/drizzle/0018_pm_round_event.sql` + meta (via `bun run db:generate --name pm_round_event`)
- Create: `src/main/lib/db/pm-round-queries.ts`
- Test: `tests/unit/main/lib/db/migrations/0018-pm-round-event.test.ts`, `tests/unit/main/lib/db/pm-round-queries.test.ts`

**Interfaces:**

- Produces: `pmRoundEvent` table; `PmRoundEvent` row type; `ConversationMessage.roundId: string | null`;
  `appendRoundEvent(e: { conversationId: string; roundId: string; seq: number; kind: PmRoundEventKind; payload: Record<string, unknown> }): Promise<void>`;
  `listRoundEvents(conversationId: string, roundId: string): Promise<PmRoundEvent[]>` (by `seq`);
  `lastRoundStartedAt(conversationId: string): Promise<Date | null>` (createdAt of the newest `input` event).
- Produces (shared): `packages/shared/src/types/pm-round.ts` — `PM_ROUND_EVENT_KINDS = ['input','reports','thinking','text','tool_call','tool_result','usage','error'] as const`, `type PmRoundEventKind = (typeof PM_ROUND_EVENT_KINDS)[number]`, and the wire type `PmRoundEventDto = { seq: number; kind: PmRoundEventKind; payload: Record<string, unknown>; createdAt: string }`.

- [ ] **Step 1: Shared types** — create `packages/shared/src/types/pm-round.ts` with exactly the Produces above (add the subpath export to `packages/shared/package.json` if the package lists subpaths explicitly — check how `types/agents` is exported and mirror it).

- [ ] **Step 2: Schema** — in `schema.ts` add to `conversationMessage`: `roundId: uuid('roundId'),` (nullable, after `taskId`). Below `conversationMessage` add:

```ts
// One PM round's decision trail (spec 2026-10-17): what it read, thought,
// called and was answered, in order. Masked before it is written.
export const pmRoundEvent = pgTable(
  'pm_round_event',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    roundId: uuid('roundId').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').$type<PmRoundEventKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull()
  },
  (table) => [
    index('pm_round_event_round_idx').on(
      table.conversationId,
      table.roundId,
      table.seq
    )
  ]
)
export type PmRoundEvent = InferSelectModel<typeof pmRoundEvent>
```

(import `integer` from drizzle if not yet imported; import `PmRoundEventKind` from `@actovia/shared/types/pm-round`.) Run `bun run db:generate --name pm_round_event` → `0018_pm_round_event.sql`. Read the SQL: it must add the `roundId` column and create the table with the FK `ON DELETE cascade` and the index.

- [ ] **Step 3: Migration test (fails before Step 2's SQL exists, passes after)** — `0018-pm-round-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0018 — pm_round_event', () => {
  it('stores a round’s events and drops them with their group', async () => {
    const pg = await createMigratedPglite('0018')
    await pg.exec(
      `INSERT INTO conversation (id, title) VALUES ('00000000-0000-0000-0000-000000000001', 'G')`
    )
    await pg.exec(`INSERT INTO pm_round_event ("conversationId","roundId",seq,kind,payload)
      VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa',0,'input','{"text":"hi"}')`)
    await pg.exec(`INSERT INTO conversation_message ("conversationId",role,content,"roundId")
      VALUES ('00000000-0000-0000-0000-000000000001','pm','ok','00000000-0000-0000-0000-0000000000aa')`)
    expect(
      (await pg.query(`SELECT count(*)::int AS n FROM pm_round_event`)).rows
    ).toEqual([{ n: 1 }])
    await pg.exec(`DELETE FROM conversation`)
    expect(
      (await pg.query(`SELECT count(*)::int AS n FROM pm_round_event`)).rows
    ).toEqual([{ n: 0 }])
    await pg.close()
  })
})
```

(If `conversation` has other NOT NULL columns without defaults, read its definition and add them to the INSERT.) Run: `bunx vitest run tests/unit/main/lib/db/migrations/0018-pm-round-event.test.ts` → PASS.

- [ ] **Step 4: Queries, test first** — `pm-round-queries.test.ts` on a real migrated PGlite (pattern: `vi.mock('@main/lib/db/db', async () => { const { drizzle } = await import('drizzle-orm/pglite'); const { createMigratedPglite } = await import('../../../helpers/migrated-pglite'); const pglite = await createMigratedPglite('9999'); return { pglite, db: drizzle(pglite) } })` — copy from `tests/unit/main/lib/secrets/at-rest.test.ts`). Cases: events come back in `seq` order whatever the insert order; another conversation's round id returns `[]`; `lastRoundStartedAt` is the newest `input` event's time and `null` for a group with none. Then `src/main/lib/db/pm-round-queries.ts`:

```ts
import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'
import { and, asc, desc, eq } from 'drizzle-orm'

import { db } from './db'
import { pmRoundEvent } from './schema'

export async function appendRoundEvent(e: {
  conversationId: string
  roundId: string
  seq: number
  kind: PmRoundEventKind
  payload: Record<string, unknown>
}) {
  await db.insert(pmRoundEvent).values(e)
}

export function listRoundEvents(conversationId: string, roundId: string) {
  return db
    .select()
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.conversationId, conversationId),
        eq(pmRoundEvent.roundId, roundId)
      )
    )
    .orderBy(asc(pmRoundEvent.seq))
}

/** When this group's newest round began — the reports a round "read" are the ones after it. */
export async function lastRoundStartedAt(
  conversationId: string
): Promise<Date | null> {
  const [row] = await db
    .select({ at: pmRoundEvent.createdAt })
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.conversationId, conversationId),
        eq(pmRoundEvent.kind, 'input')
      )
    )
    .orderBy(desc(pmRoundEvent.createdAt))
    .limit(1)
  return row?.at ?? null
}
```

Run both test files → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/pm-round.ts packages/shared/package.json src/main/lib/db/schema.ts src/main/lib/db/pm-round-queries.ts resources/drizzle tests/unit/main/lib/db
git commit -m "feat(philharmonic): pm_round_event — a PM round's decision trail, per group and round, in order; conversation_message.roundId ties a PM message to its round (migration 0018)"
```

---

### Task 2: The round recorder

**Files:**

- Create: `src/main/lib/ai/philharmonic/round-recorder.ts`
- Test: `tests/unit/main/lib/ai/philharmonic/round-recorder.test.ts`

**Interfaces:**

- Consumes: `appendRoundEvent` (Task 1), `maskLogText` (`../../logger/secret-mask`), pi `AgentEvent` (`@earendil-works/pi-agent-core`), `calculateCost` if needed — no: cost comes from `usage.cost.total`.
- Produces:

```ts
export interface RoundRecorderDeps {
  append(e: {
    conversationId: string
    roundId: string
    seq: number
    kind: PmRoundEventKind
    payload: Record<string, unknown>
  }): Promise<void>
  mask(text: string): string
}
export interface RoundRecorder {
  readonly roundId: string
  input(trigger: 'user' | 'scheduled', text: string): void
  reports(
    messages: Array<{ messageId: string; agentId: string | null; name: string }>
  ): void
  /** Feed every agentLoop event; the recorder keeps what the trail needs. */
  onEvent(event: unknown): void
  error(message: string, aborted: boolean): void
  /** Writes `usage` (when any message carried one), waits for every write, and returns the round's counts. Never throws. */
  finish(): Promise<{ delegations: number; waits: number }>
}
export function createRoundRecorder(
  conversationId: string,
  roundId: string,
  deps?: RoundRecorderDeps
): RoundRecorder
export function resultText(result: unknown): string
```

- [ ] **Step 1: Failing tests** — `round-recorder.test.ts` (no DB: inject `deps`):

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))
const { createRoundRecorder, resultText } =
  await import('@main/lib/ai/philharmonic/round-recorder')

function rec() {
  const rows: Array<{
    seq: number
    kind: string
    payload: Record<string, unknown>
  }> = []
  const r = createRoundRecorder('c1', 'r1', {
    append: async (e) => {
      rows.push({ seq: e.seq, kind: e.kind, payload: e.payload })
    },
    mask: (t) => t.replaceAll('sk-secret', '•••• cret')
  })
  return { r, rows }
}

const assistant = (content: unknown[], usage?: unknown) => ({
  type: 'message_end',
  message: { role: 'assistant', content, stopReason: 'toolUse', usage }
})

describe('round recorder', () => {
  it('records a round in order: input, reports, thinking, text, call, result, usage', async () => {
    const { r, rows } = rec()
    r.input('user', 'build it')
    r.reports([{ messageId: 'm1', agentId: 'a1', name: 'Claude Code' }])
    r.onEvent(
      assistant(
        [
          { type: 'thinking', thinking: 'opus is out' },
          { type: 'text', text: 'Giving it to sonnet.' },
          { type: 'toolCall', id: 't1', name: 'delegateTask', arguments: {} }
        ],
        { input: 100, output: 20, cacheRead: 5, cost: { total: 0.01 } }
      )
    )
    r.onEvent({
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'delegateTask',
      args: { employeeId: 'a2', instructions: 'use sk-secret' }
    })
    r.onEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'delegateTask',
      result: { content: [{ type: 'text', text: 'done' }] },
      isError: false
    })
    r.onEvent(
      assistant([{ type: 'text', text: 'All done.' }], {
        input: 50,
        output: 10,
        cacheRead: 0,
        cost: { total: 0.005 }
      })
    )
    await r.finish()
    expect(rows.map((x) => x.kind)).toEqual([
      'input',
      'reports',
      'thinking',
      'text',
      'tool_call',
      'tool_result',
      'text',
      'usage'
    ])
    expect(rows.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(rows[4].payload).toEqual({
      toolCallId: 't1',
      name: 'delegateTask',
      args: { employeeId: 'a2', instructions: 'use •••• cret' }
    })
    expect(rows[5].payload).toEqual({
      toolCallId: 't1',
      name: 'delegateTask',
      text: 'done',
      isError: false
    })
    expect(rows[7].payload).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 5,
      costUsd: 0.015
    })
  })

  it('counts delegations that ran and waits that were scheduled', async () => {
    const { r } = rec()
    const call = (id: string, name: string, text: string) => {
      r.onEvent({
        type: 'tool_execution_start',
        toolCallId: id,
        toolName: name,
        args: {}
      })
      r.onEvent({
        type: 'tool_execution_end',
        toolCallId: id,
        toolName: name,
        result: text,
        isError: false
      })
    }
    call('a', 'delegateTask', 'done')
    call('b', 'delegateTask', 'Not started: CC’s quota is used up')
    call('c', 'waitForQuota', 'Step parked. You will be woken at Tue 07:02.')
    call('d', 'waitForQuota', 'Refused: nothing blocks that employee')
    await expect(r.finish()).resolves.toEqual({ delegations: 1, waits: 1 })
  })

  it('keeps what was written and adds the error', async () => {
    const { r, rows } = rec()
    r.input('scheduled', 'Quota reset')
    r.error('provider 500', false)
    await r.finish()
    expect(rows.map((x) => x.kind)).toEqual(['input', 'error'])
    expect(rows[1].payload).toEqual({ message: 'provider 500', aborted: false })
  })

  it('a failed write is logged, never thrown, and later writes still happen', async () => {
    const rows: string[] = []
    let n = 0
    const r = createRoundRecorder('c1', 'r1', {
      append: async (e) => {
        if (n++ === 0) throw new Error('db down')
        rows.push(e.kind)
      },
      mask: (t) => t
    })
    r.input('user', 'x')
    r.error('y', true)
    await expect(r.finish()).resolves.toBeUndefined()
    expect(rows).toEqual(['error'])
  })

  it('skips empty thinking / text and records no usage when none was reported', async () => {
    const { r, rows } = rec()
    r.onEvent(
      assistant([
        { type: 'text', text: '' },
        { type: 'thinking', thinking: '', redacted: true }
      ])
    )
    await r.finish()
    expect(rows).toEqual([])
  })
})

describe('resultText', () => {
  it('reads text parts, a string, or JSON for anything else', () => {
    expect(resultText('plain')).toBe('plain')
    expect(
      resultText({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ]
      })
    ).toBe('ab')
    expect(resultText({ details: { ok: 1 } })).toBe('{"details":{"ok":1}}')
    expect(resultText(undefined)).toBe('')
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `round-recorder.ts`**

```ts
// The PM's decision trail (spec 2026-10-17 §2): every agentLoop event of a
// round that tells why it did what it did, in order, masked, written as it
// happens. Best-effort: a failed write is logged and never fails the round.
import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'

import { appendRoundEvent } from '../../db/pm-round-queries'
import { logger } from '../../logger'
import { maskLogText } from '../../logger/secret-mask'

export interface RoundRecorderDeps {
  /* as in Interfaces */
}
export interface RoundRecorder {
  /* as in Interfaces */
}

const defaultDeps: RoundRecorderDeps = {
  append: appendRoundEvent,
  mask: maskLogText
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the PM read back from a tool, as text. */
export function resultText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (isObj(result) && Array.isArray(result.content)) {
    const text = result.content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          isObj(c) && c.type === 'text' && typeof c.text === 'string'
      )
      .map((c) => c.text)
      .join('')
    if (text) return text
  }
  return JSON.stringify(result)
}

function maskDeep(v: unknown, mask: (t: string) => string): unknown {
  if (typeof v === 'string') return mask(v)
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, mask))
  if (isObj(v))
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, maskDeep(x, mask)])
    )
  return v
}

export function createRoundRecorder(
  conversationId: string,
  roundId: string,
  deps: RoundRecorderDeps = defaultDeps
): RoundRecorder {
  let seq = 0
  let chain: Promise<void> = Promise.resolve()
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    seen: false
  }
  const counts = { delegations: 0, waits: 0 }

  const write = (kind: PmRoundEventKind, payload: Json) => {
    const row = {
      conversationId,
      roundId,
      seq: seq++,
      kind,
      payload: maskDeep(payload, deps.mask) as Json
    }
    chain = chain.then(() =>
      deps.append(row).catch((error) =>
        logger.warn('philharmonic', 'decision trail write failed', {
          conversationId,
          roundId,
          kind,
          error
        })
      )
    )
  }

  return {
    roundId,
    input: (trigger, text) => write('input', { trigger, text }),
    reports: (messages) => {
      if (messages.length) write('reports', { messages })
    },
    onEvent(event) {
      if (!isObj(event)) return
      if (
        event.type === 'message_end' &&
        isObj(event.message) &&
        event.message.role === 'assistant'
      ) {
        const msg = event.message
        for (const part of Array.isArray(msg.content) ? msg.content : []) {
          if (!isObj(part)) continue
          if (
            part.type === 'thinking' &&
            typeof part.thinking === 'string' &&
            part.thinking.trim()
          )
            write('thinking', { text: part.thinking })
          else if (
            part.type === 'text' &&
            typeof part.text === 'string' &&
            part.text.trim()
          )
            write('text', { text: part.text })
        }
        const u = isObj(msg.usage) ? msg.usage : null
        if (u) {
          usage.seen = true
          usage.inputTokens += typeof u.input === 'number' ? u.input : 0
          usage.outputTokens += typeof u.output === 'number' ? u.output : 0
          usage.cacheReadTokens +=
            typeof u.cacheRead === 'number' ? u.cacheRead : 0
          usage.costUsd +=
            isObj(u.cost) && typeof u.cost.total === 'number' ? u.cost.total : 0
        }
      } else if (event.type === 'tool_execution_start') {
        write('tool_call', {
          toolCallId: event.toolCallId,
          name: event.toolName,
          args: event.args ?? {}
        })
      } else if (event.type === 'tool_execution_end') {
        const text = resultText(event.result)
        const ok = event.isError !== true
        if (
          ok &&
          event.toolName === 'delegateTask' &&
          !text.startsWith('Not started:')
        )
          counts.delegations++
        if (
          ok &&
          event.toolName === 'waitForQuota' &&
          !text.startsWith('Refused')
        )
          counts.waits++
        write('tool_result', {
          toolCallId: event.toolCallId,
          name: event.toolName,
          text,
          isError: !ok
        })
      }
    },
    error: (message, aborted) => write('error', { message, aborted }),
    async finish() {
      if (usage.seen) {
        const { seen: _seen, ...rest } = usage
        write('usage', {
          ...rest,
          costUsd: Math.round(rest.costUsd * 1e6) / 1e6
        })
      }
      await chain
      return { ...counts }
    }
  }
}
```

Note the final assistant message's text is recorded as a `text` event too (it is also the PM row's content) — the spec says "the final message's text is its own row, not repeated": **Ruling**: record it anyway — it keeps the trail self-contained for Chat Audit and the UI hides a trailing `text` equal to the bubble (Task 5). Run the tests → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/lib/ai/philharmonic/round-recorder.ts tests/unit/main/lib/ai/philharmonic/round-recorder.test.ts
git commit -m "feat(philharmonic): the round recorder — a PM round's thinking, text, tool calls with arguments and results, and usage, masked, in order; a failed write is logged and never fails the round"
```

---

### Task 3: Wire the recorder into the PM round

**Files:**

- Modify: `src/main/lib/ai/philharmonic/pm-coordinator.ts` (`RunPmArgs` ~L151, before `agentLoop` ~L544, the `for await` loop ~L595, the catch ~L627-690, the final row ~L710)
- Modify: `src/main/lib/ai/philharmonic/scheduler.ts:54` (trigger)
- Test: `tests/unit/main/lib/ai/philharmonic/pm-coordinator.test.ts`, `tests/unit/main/lib/ai/philharmonic/scheduler.test.ts`

**Interfaces:**

- Consumes: `createRoundRecorder` (Task 2); `lastRoundStartedAt` (Task 1); `getMessagesByConversationId` (`db/conversation-queries.ts:106`); the `employees` list already loaded in the coordinator.
- Produces: `RunPmArgs.trigger?: 'user' | 'scheduled'` (default `'user'`); the PM's final row and the error / interrupted system rows are created with `roundId`.

- [ ] **Step 1: Failing coordinator tests** — in `pm-coordinator.test.ts` add `vi.mock('@main/lib/ai/philharmonic/round-recorder', …)` returning a recorder spy (`input`, `reports`, `onEvent`, `error`, `finish` as `vi.fn()`, `roundId: 'r1'`) and `vi.mock('@main/lib/db/pm-round-queries', () => ({ lastRoundStartedAt: vi.fn(async () => null) }))`. Cases (use the file's `agentLoopMock` + `fakeStream`):
  1. A round: `input` called with `('user', 'build a report')`; every scripted event passed to `onEvent` in order; `finish` awaited; the PM row created with `roundId: 'r1'`.
  2. `trigger: 'scheduled'` → `input('scheduled', …)`.
  3. Reports: `getMessagesByConversationId` returns an `employee` row (agentId `a1`, createdAt after `lastRoundStartedAt`) and an older one; `reports` called with only the newer `{ messageId, agentId: 'a1', name: <a1's name from the employees fixture> }` (a row whose agent is unknown gets `name: 'former employee'`).
  4. A `message_end` with `stopReason: 'error'` → `error('<message>', false)` then `finish`; the `⚠️ PM error` system row has `roundId: 'r1'`.
  5. Abort → `error(…, true)`; the interrupted row has `roundId: 'r1'`.
  6. The recorder's `finish` rejecting is impossible by contract, but `input` throwing synchronously must not fail the round: make the spy's `input` throw once → the PM row is still created.
     Run → FAIL.

- [ ] **Step 2: Implement** in `pm-coordinator.ts`:
  - `RunPmArgs` gains `/** What started the round, for its decision trail. */ trigger?: 'user' | 'scheduled'`.
  - After `messageId` is created:

```ts
const recorder = createRoundRecorder(conversationId, uuidV4())
const safe = (f: () => void) => {
  try {
    f()
  } catch (error) {
    logger.warn('philharmonic', 'decision trail capture failed', {
      conversationId,
      error
    })
  }
}
safe(() => recorder.input(args.trigger ?? 'user', userText))
try {
  const since = await lastRoundStartedAt(conversationId)
  const names = new Map(employees.map((e) => [e.id, e.name]))
  const rows = await getMessagesByConversationId(conversationId)
  const read = rows.filter(
    (r) => r.role === 'employee' && (!since || r.createdAt > since)
  )
  safe(() =>
    recorder.reports(
      read.map((r) => ({
        messageId: r.id,
        agentId: r.agentId,
        name: (r.agentId && names.get(r.agentId)) || 'former employee'
      }))
    )
  )
} catch (error) {
  logger.warn('philharmonic', 'decision trail reports failed', {
    conversationId,
    error
  })
}
```

(`lastRoundStartedAt` must be read before `input` is written would make the new input the newest — so call `lastRoundStartedAt` FIRST, then `recorder.input`. Reorder accordingly: read `since`, then `input`, then `reports`.)

- In the `for await` loop, first line: `safe(() => recorder.onEvent(event))`.
- Error branch and abort branch: `safe(() => recorder.error(message, false|true)); await recorder.finish()` before their `createConversationMessage`, which gains `roundId: recorder.roundId`.
- Success: `const counts = await recorder.finish()` before the final `createConversationMessage({ …, roundId: recorder.roundId, parts: [...(artifactParts ?? []), { kind: 'decision', ...counts }] })` — the collapsed disclosure reads its counts from this part, so a closed disclosure fetches nothing. The error / abort rows get the same part from their `finish()`. Add to test case 1: the PM row's `parts` contains `{ kind: 'decision', delegations: <n>, waits: <n> }` (make the spy's `finish` resolve `{ delegations: 2, waits: 1 }`).
- `scheduler.ts`: the `runPmCoordinator({ … })` call gains `trigger: 'scheduled'`; add a `scheduler.test.ts` expectation that it is passed.
  Run the philharmonic tests → PASS; `env PWD=… bun run typecheck:node` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/main/lib/ai/philharmonic/pm-coordinator.ts src/main/lib/ai/philharmonic/scheduler.ts tests/unit/main/lib/ai/philharmonic
git commit -m "feat(philharmonic): every PM round records its decision trail — its trigger, the reports it read, every loop event — and its message (or error) carries the round id"
```

---

### Task 4: The PM reads who reported

**Files:**

- Create: `src/main/lib/ai/philharmonic/lcm/labels.ts`
- Modify: `src/main/lib/ai/philharmonic/lcm/index.ts:85` (`rowToLlmMessage`, `assembleContext`), `src/main/lib/ai/philharmonic/lcm/summarize.ts:55-60`
- Test: `tests/unit/main/lib/ai/philharmonic/lcm/labels.test.ts` and the existing lcm tests

**Interfaces:**

- Produces: `employeeLabel(agent: { name: string; runtime: string; model: string | null } | undefined): string` — `[<name> · <CLI name> · <model or 'CLI default'>]` for a CLI runtime, `[<name>]` for `actovia`, `[former employee]` when undefined.

- [ ] **Step 1: Failing test** — `labels.test.ts`:

```ts
import { employeeLabel } from '@main/lib/ai/philharmonic/lcm/labels'
import { describe, expect, it } from 'vitest'

describe('employeeLabel', () => {
  it('names the author of a report', () => {
    expect(
      employeeLabel({ name: 'Writer', runtime: 'actovia', model: 'gpt-5.5' })
    ).toBe('[Writer]')
    expect(
      employeeLabel({ name: 'CC', runtime: 'claude-code', model: 'opus' })
    ).toBe('[CC · Claude Code · opus]')
    expect(employeeLabel({ name: 'Cx', runtime: 'codex', model: null })).toBe(
      '[Cx · Codex · CLI default]'
    )
    expect(employeeLabel(undefined)).toBe('[former employee]')
  })
})
```

Then `labels.ts` (import `CLI_NAMES` from `@actovia/shared/types/agents`, `isCliId` / `cliOf` from `../../../agents/drivers`). Run → PASS.

- [ ] **Step 2: Use it** — `PhilharmonicLcm.assembleContext` loads `getAllAgents()` (`db/philharmonic-queries.ts`, includes inactive) once into a `Map(id → agent)` and `rowToLlmMessage(row, agents)` prefixes an `employee` row: `text: \`${employeeLabel(agents.get(row.agentId ?? ''))} ${row.content}\``. `summarize.ts`'s `roleLabel`takes the same map (thread it from its caller) and returns`employeeLabel(...)`without brackets for employee rows — i.e.`employeeLabel(a).slice(1, -1)`. Add to the existing lcm tests: an employee row reaches the model text-prefixed with its label; the summary transcript labels it by name, not `Employee <id>`. Mock `getAllAgents`where the lcm tests mock the DB. Run`bunx vitest run tests/unit/main/lib/ai/philharmonic` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/lib/ai/philharmonic/lcm tests/unit/main/lib/ai/philharmonic/lcm
git commit -m "fix(philharmonic): the PM reads who reported — an employee's report reaches it, and its summaries, labelled with the employee's name, CLI and model"
```

---

### Task 5: The decision process under the PM's message

**Files:**

- Modify: `src/main/lib/server/routes/philharmonic-conversations.ts` (beside `GET /conversations/:id/messages`, ~L175)
- Modify: `src/renderer/stores/philharmonic.ts:61` (`ConversationMessageData.roundId: string | null`)
- Modify: `src/renderer/components/philharmonic/chat/merge-group-messages.ts:50-72`, `group-message-bubble.tsx` (`BubbleModel.roundId?: string | null`; the disclosure under a PM bubble)
- Create: `src/renderer/services/philharmonic-rounds.ts`, `src/renderer/hooks/use-pm-round.ts`, `src/renderer/lib/pm-round.ts`, `src/renderer/components/philharmonic/chat/decision-process.tsx`
- Modify: `packages/shared/src/constants/test-ids.ts` (philharmonic section), the 10 `philharmonic.json` catalogs, `tests/e2e/sidebar.spec.ts`
- Test: `tests/unit/main/lib/server/routes/philharmonic-rounds.test.ts`, `tests/unit/renderer/lib/pm-round.test.ts`, `tests/unit/renderer/components/philharmonic/decision-process.test.ts`

**Interfaces:**

- Consumes: `listRoundEvents` (Task 1); `PmRoundEventDto` (shared).
- Produces: `GET /api/v1/philharmonic/conversations/:id/rounds/:roundId` → `PmRoundEventDto[]` (404 `NotFoundError` when empty); `getPmRound(conversationId, roundId)`; `usePmRound(conversationId, roundId, enabled)`; `describeRound(events): RoundLine[]` and `roundCounts(events): { delegations: number; waits: number }`; `TEST_IDS.philharmonic.decisionToggle = 'philharmonic.decision-toggle'`.

- [ ] **Step 1: Route, test first** — `philharmonic-rounds.test.ts`: mock `@main/lib/db/pm-round-queries` (`listRoundEvents` returns two rows for `('c1','r1')`, `[]` otherwise); mount the router as the other philharmonic route tests do (read `tests/unit/main/lib/server/routes/` for a philharmonic-conversations test and copy its setup, incl. `errorHandler`). Expect 200 with `[{ seq, kind, payload, createdAt }]` (ISO string, no `conversationId`/`roundId`/`id`) for `/conversations/c1/rounds/r1`, 404 for `/conversations/c2/rounds/r1`. Implement:

```ts
router.get('/conversations/:id/rounds/:roundId', async (c) => {
  const id = getRequiredParam(c, 'id')
  const roundId = getRequiredParam(c, 'roundId')
  const rows = await listRoundEvents(id, roundId)
  if (!rows.length) throw new NotFoundError()
  return successResponse(
    c,
    rows.map((r) => ({
      seq: r.seq,
      kind: r.kind,
      payload: r.payload,
      createdAt: r.createdAt.toISOString()
    }))
  )
})
```

(`NotFoundError` from `@actovia/shared/errors/app-error`; check its constructor in chat.ts's usage.) Run → PASS.

- [ ] **Step 2: The pure description, test first** — `src/renderer/lib/pm-round.ts`:

```ts
import type { PmRoundEventDto } from '@actovia/shared/types/pm-round'

export type RoundLine =
  | { kind: 'trigger'; scheduled: boolean; text: string }
  | { kind: 'reports'; reports: Array<{ messageId: string; name: string }> }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'call'
      tool: string
      args: Record<string, unknown>
      result: string | null
      isError: boolean
      refused: boolean
    }
  | {
      kind: 'usage'
      inputTokens: number
      outputTokens: number
      costUsd: number
    }
  | { kind: 'error'; message: string; aborted: boolean }

/** A round as the disclosure draws it: each call paired with its result; a trailing text equal to the bubble left out. */
export function describeRound(
  events: PmRoundEventDto[],
  bubbleText: string
): RoundLine[]
export function roundCounts(events: PmRoundEventDto[]): {
  delegations: number
  waits: number
}
```

Rules: pair `tool_call` / `tool_result` by `toolCallId` (a call without a result → `result: null`); `refused` when the tool is `delegateTask` and the result text starts with `Not started:`; drop the LAST `text` line when its text trimmed equals `bubbleText` trimmed; `roundCounts` counts `delegateTask` calls that were not refused and `waitForQuota` calls whose result does not start with `Refused`. Tests in `tests/unit/renderer/lib/pm-round.test.ts` cover: pairing, a dangling call, refusal detection, the trailing-text drop, counts. Implement → PASS.

- [ ] **Step 3: Catalog keys (all 10 locales, authored)** — under `chat.decision` in each `philharmonic.json`; English source:

```json
"decision": {
  "toggle": "Decision process",
  "delegations": "Delegated: {{count}}",
  "waits": "Waited: {{count}}",
  "loading": "Loading…",
  "unavailable": "The record of this round is not available.",
  "triggerUser": "You wrote",
  "triggerScheduled": "Scheduled",
  "reports": "Read reports from",
  "thinking": "Thinking",
  "delegate": "Gave a step to {{name}}",
  "refused": "Not started — {{name}}'s quota is used up",
  "wait": "Waited for the quota",
  "plan": "Planned {{count}} steps",
  "updateStep": "Marked a step {{status}}",
  "appendStep": "Added a step",
  "recruit": "Recruited {{name}}",
  "report": "Wrote a report",
  "askUser": "Asked you",
  "search": "Searched the knowledge base",
  "otherTool": "Called {{tool}}",
  "failed": "failed",
  "details": "Arguments and result",
  "usage": "{{input}} in · {{output}} out · ${{cost}}",
  "error": "Stopped: {{message}}",
  "interrupted": "You stopped this round"
}
```

Translate every value into the other nine locales yourself (keep `{{…}}` intact; `{{status}}` is a raw status word). Run `bun run i18n:check` → OK.

- [ ] **Step 4: Service, hook, data flow**
  - `services/philharmonic-rounds.ts`: `export const getPmRound = (conversationId: string, roundId: string) => fetcher<PmRoundEventDto[]>(\`/api/v1/philharmonic/conversations/${conversationId}/rounds/${roundId}\`)`.
  - `hooks/use-pm-round.ts`: `export const pmRoundKeys = { round: (c: string, r: string) => ['pm-round', c, r] as const }`; `usePmRound(conversationId, roundId, enabled)` → `useQuery({ queryKey: pmRoundKeys.round(…), queryFn: () => getPmRound(…), enabled, staleTime: Infinity })` (a finished round never changes).
  - `ConversationMessageData` gains `roundId: string | null`; `merge-group-messages.ts` passes `roundId: h.roundId` into the bubble; `BubbleModel` gains `roundId?: string | null`.

- [ ] **Step 5: The component, test first** — `decision-process.test.ts` (happy-dom, `createRoot` + `act`, wrap in `renderWithQueryClient` from `tests/unit/helpers/query-test-utils.ts` and an i18n provider as other renderer component tests do — read one first). Mock `@/services/philharmonic-rounds`. Cases: collapsed shows "Decision process · Delegated: 2 · Waited: 1" from the `counts` prop (the bubble's `{ kind: 'decision' }` part — `merge-group-messages.ts` copies it to `BubbleModel.decision?: { delegations: number; waits: number }`; counts of 0 are left out) and makes **no** fetch until opened; opened, it shows "Gave a step to Claude Code", the refused line, the wait line, the usage line; a 404 shows the unavailable text. Then `decision-process.tsx`:
  - Props `{ conversationId: string; roundId: string; bubbleText: string; counts?: { delegations: number; waits: number }; nameOf(agentId: string): string | undefined; onJumpTo(messageId: string): void }`. (`roundCounts` in `lib/pm-round.ts` stays for rounds without the part — none today; drop it if nothing uses it.)
  - A button (`data-testid={TEST_IDS.philharmonic.decisionToggle}`, `text-xs text-muted-foreground`, a chevron) toggling a `Reveal` (`components/motion/morph.tsx`); `usePmRound(…, open)`.
  - Lines from `describeRound` rendered as `text-xs` rows: trigger (`triggerUser` / `triggerScheduled` + the text, two lines max), reports (`reports` + names as buttons calling `onJumpTo`), thinking (folded `Reveal`), each call (the sentence per tool: `delegateTask` → `delegate` with the employee name resolved by the parent's `agentsById` passed as a `nameOf(id)` prop, or `refused`; `waitForQuota` → `wait` + its result text; `createPlan` → `plan` with `args.steps.length`; `updatePlanStep` → `updateStep` with `args.status`; `appendPlanStep` → `appendStep`; `recruitEmployee` → `recruit` with `args.name ?? args.role`; `createReport` → `report`; `askUser` → `askUser`; `search_knowledge_base` → `search`; anything else → `otherTool`), each with a nested `details` `Reveal` showing `JSON.stringify(args, null, 2)` and the result text in a `pre` (mono, `whitespace-pre-wrap break-all`, max-height scroll); `isError` marks the row `text-destructive` with `failed`; usage and error lines last.
  - In `group-message-bubble.tsx`, under a `pm` bubble's body (and under a `system` bubble with a `roundId`): `{bubble.roundId && bubble.conversationId && <DecisionProcess … />}`; `onJumpTo` scrolls to `[data-message-id="<id>"]` if the bubble list renders that attribute — check; if it does not, add `data-message-id={bubble.messageId}` to the bubble root.
  - Add `decisionToggle: 'philharmonic.decision-toggle'` to `TEST_IDS.philharmonic`; in `tests/e2e/sidebar.spec.ts`'s philharmonic test add `expect(await mainWindow.getByTestId(TEST_IDS.philharmonic.decisionToggle).count()).toBeGreaterThanOrEqual(0)` — the pattern its `membersToggle` line uses (no e2e reaches a PM message; **Ruling**: follow the file's existing presence pattern).
    Run the renderer tests, `bun run test -- tests/unit/i18n`, `env PWD=… bun run typecheck:web` → PASS/clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/server/routes/philharmonic-conversations.ts src/renderer packages/shared/src/constants/test-ids.ts packages/shared/src/i18n tests/unit tests/e2e/sidebar.spec.ts
git commit -m "feat(philharmonic): a PM message opens onto its decision process — the trigger, the reports read (each a link), thinking, every call as a sentence with its arguments and result, refusals and waits, usage (GET …/conversations/:id/rounds/:roundId)"
```

---

### Task 6: Chat Audit — group messages and the PM's rounds

**Files:**

- Modify: `packages/shared/src/constants/chat-audit-schema.ts`, `packages/shared/src/constants/chat-audit-presets.ts`, `src/main/lib/analytics/snapshot.ts`, the 10 `settings.json` catalogs (`chatAudit.presets.pmDecisions`)
- Test: `tests/unit/main/lib/analytics/snapshot.test.ts`

**Interfaces:**

- Consumes: `conversationMessage`, `pmRoundEvent` (Task 1); `scrubSecrets`, `knownSecretValues` (already used by snapshot.ts).
- Produces: DuckDB tables `group_messages(id, conversation_id, role, agent_id, task_id, round_id, text, created_at)` and `pm_round_events(conversation_id, round_id, seq, kind, tool_name, payload JSON, created_at)`; preset `pmDecisions`.

- [ ] **Step 1: Schema constants** — add to `CHAT_AUDIT_SCHEMA`:

```ts
  group_messages: {
    id: 'VARCHAR', conversation_id: 'VARCHAR', role: 'VARCHAR', agent_id: 'VARCHAR',
    task_id: 'VARCHAR', round_id: 'VARCHAR', text: 'VARCHAR', created_at: 'TIMESTAMP'
  },
  pm_round_events: {
    conversation_id: 'VARCHAR', round_id: 'VARCHAR', seq: 'INTEGER', kind: 'VARCHAR',
    tool_name: 'VARCHAR', payload: 'JSON', created_at: 'TIMESTAMP'
  },
```

and the preset:

```ts
  {
    id: 'pmDecisions',
    sql: `SELECT conversation_id, round_id, min(created_at) AS started_at,
  count(*) FILTER (WHERE kind = 'tool_call' AND tool_name = 'delegateTask') AS delegations,
  count(*) FILTER (WHERE kind = 'tool_result' AND tool_name = 'delegateTask' AND payload->>'text' LIKE 'Not started:%') AS refused,
  count(*) FILTER (WHERE kind = 'tool_call' AND tool_name = 'waitForQuota') AS waits,
  max(CAST(payload->>'inputTokens' AS BIGINT)) FILTER (WHERE kind = 'usage') AS input_tokens,
  max(CAST(payload->>'outputTokens' AS BIGINT)) FILTER (WHERE kind = 'usage') AS output_tokens,
  max(CAST(payload->>'costUsd' AS DOUBLE)) FILTER (WHERE kind = 'usage') AS cost_usd
FROM pm_round_events GROUP BY ALL ORDER BY started_at DESC`
  },
```

(Update the file header comment that lists the tables.) Add `chatAudit.presets.pmDecisions` to all 10 `settings.json` catalogs (en: "PM decisions by group"; translate the rest).

- [ ] **Step 2: Failing snapshot test** — extend the fixture `source` in `snapshot.test.ts` with `groupMessages` (one `employee` row whose content holds a known secret value, one `pm` row with a `roundId`) and `roundEvents` (an `input`, a `tool_call` delegateTask with a secret in `args.instructions`, its `tool_result`, a `usage`), and the test's `secrets` returning that secret. Expect: `SELECT count(*) FROM group_messages` = 2; the employee row's `text` has the secret masked; `pm_round_events.payload` has it masked; `pmDecisions` returns `{ delegations: 1, refused: 0, waits: 0, input_tokens: <fixture>, … }` for the round. The existing "every preset runs" loop now includes `pmDecisions`. Run → FAIL.

- [ ] **Step 3: Implement in `snapshot.ts`** — `SourceRows` gains `groupMessages: GroupMessageSource[]` and `roundEvents: RoundEventSource[]`; `readSource()` selects them (`conversationMessage`: id, conversationId, role, agentId, taskId, roundId, content, createdAt; `pmRoundEvent`: conversationId, roundId, seq, kind, payload, createdAt); `toGroupMessageRow(m, secrets)` → snake_case with `text: scrubSecrets(m.content, secrets)`; `toRoundEventRow(e, secrets)` → `{ conversation_id, round_id, seq, kind, tool_name: typeof e.payload.name === 'string' ? e.payload.name : null, payload: JSON.parse(scrubSecrets(JSON.stringify(e.payload), secrets)), created_at }`. Stage both as NDJSON and `loadTableSql('group_messages', …)` / `loadTableSql('pm_round_events', …)` beside `messages`, with `CHAT_AUDIT_SCHEMA.group_messages` / `.pm_round_events` as columns. (**Ruling**: these two tables are scrubbed although `messages` is not — the spec asks the group text to be masked, and the trail's payloads were masked at write time with the secrets known then; scrubbing again with today's secrets costs nothing.) Run the snapshot tests → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants/chat-audit-schema.ts packages/shared/src/constants/chat-audit-presets.ts src/main/lib/analytics/snapshot.ts packages/shared/src/i18n tests/unit/main/lib/analytics
git commit -m "feat(analytics): Chat Audit reads Philharmonic — group_messages and pm_round_events, masked, and a 'PM decisions by group' preset"
```

---

### Task 7: Docs and the whole gate

**Files:**

- Modify: `CLAUDE.md` (Philharmonic section; Key Tables; Chat Audit), `docs/manual-qa-checklist.md`, the spec's Status line

- [ ] **Step 1: CLAUDE.md** — Philharmonic section, a bullet: "**Decision trail** (spec `docs/superpowers/specs/2026-10-17-pm-decision-trail-design.md`): every PM round records, through `ai/philharmonic/round-recorder.ts`, its trigger, the employee reports it read (ids and names), thinking, text, each tool call with its arguments and result, usage and any error, masked (`maskLogText`), in `pm_round_event` (migration 0018; a recording failure never fails the round). The PM's message (or its error row) carries `roundId`; `GET /api/v1/philharmonic/conversations/:id/rounds/:roundId` serves a round and `chat/decision-process.tsx` draws it under the message, lazily. The PM's context labels each employee report with its author (`lcm/labels.ts`)." Key Tables: add `pm_round_event`. Chat Audit: the snapshot also builds `group_messages` and `pm_round_events` (scrubbed) and the `pmDecisions` preset.
- [ ] **Step 2: QA** — add to `docs/manual-qa-checklist.md`'s Philharmonic/agents section: "P1 Decision trail: after a PM round that delegated, opening 'Decision process' under its message shows the trigger, the reports read (each scrolls to its message), every delegation as a sentence with its instructions one click further, any quota refusal or wait, and the round's tokens; Settings → Developer → Chat Audit → 'PM decisions by group' lists the round."
- [ ] **Step 3: Spec status** → `implemented 2026-10-17 (plan docs/superpowers/plans/2026-10-17-pm-decision-trail.md)`.
- [ ] **Step 4: Gate** — `bun run fmt && bun run lint && env PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck && bun run i18n:check && bun run test` → all pass (a lone PGlite `Aborted()` / `ErrnoError` with every test passing is the known flake: re-run once).
- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/manual-qa-checklist.md docs/superpowers/specs/2026-10-17-pm-decision-trail-design.md
git commit -m "docs: the PM's decision trail in CLAUDE.md and the owner's QA checklist"
```
