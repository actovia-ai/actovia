# Codex Employees (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Philharmonic employee can be the owner's own Codex: the same step, card, approvals, Stop, resume and Continue in Terminal as a Claude Code employee, through `codex app-server`.

**Architecture:** A second implementation of phase 1's `AgentDriver` (`src/main/lib/agents/codex/`: a pure JSON-RPC→`AgentEvent` protocol and a process `run`), chosen by `agent.runtime`. Phase 1's Claude-specific code is first generalized to the runtime (Task 2); everything else — registry, card, projects, routes, gates — stays shared.

**Tech Stack:** Electron main (Node 24 `child_process`, `readline`), drizzle/PGlite (migration 0016), Hono, zod, React + react-i18next, Vitest (`tests/unit/**/*.test.ts` only), oxlint/oxfmt, bun.

**Spec:** `docs/superpowers/specs/2026-10-10-codex-employees-design.md` (approved 2026-10-10). Phase 1 spec `docs/superpowers/specs/2026-10-09-coding-agent-employees-design.md` holds unless the phase 2 spec says otherwise. Read both.

## Global Constraints

- Work in the git worktree `/Users/yanceyleo/Code/exodus/exodus-agents`, branch `coding-agents`. Never touch `/Users/yanceyleo/Code/exodus/exodus` (the owner's checkout). Commit locally, never push. Stage only files you changed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the pre-commit hook (oxlint, oxfmt, typecheck, i18n:check) must pass; never `--no-verify`.
- No legacy/back-compat shims (unreleased app): rename fields outright.
- Codex is driven only through `codex app-server` (stdio, newline-delimited JSON-RPC without the `jsonrpc` field).
- Codex sandbox is always `workspace-write`; `danger-full-access` is never passed. Approval policy by mode: `default` → `untrusted`, `acceptEdits` → `on-request`, `auto` → `never`.
- Every Codex server request is answered exactly once: by the owner's click, or refused by Exodus for unsupported kinds — never accepted automatically, never left pending.
- Approvals answer only `accept` / `decline` (never `acceptForSession` or exec-policy amendments); permission grants are `scope: 'turn'` only.
- A permission prompt's `detail` shows everything the owner approves, untruncated; every input field not rendered is appended.
- Secret answers (`isSecret`) are never stored in the card, the DB or any log Exodus writes.
- Minimum Codex version `0.162.1`; the check runs `codex --version` and `codex login status` and spends no quota.
- The CLI is named "Codex" in UI (`CLI_NAMES.codex`); "Claude Code" for the other.
- New user-facing strings in en AND all 9 machine locales (`packages/shared/src/i18n/locales/*`), translated, in the same commit.
- Component tests are `.test.ts` with `React.createElement`.
- Presence/desktop-only/LAN rules from phase 1 apply unchanged to every route used.

## Review Focus

1. **A server request Exodus doesn't model (e.g. `item/tool/call`, `mcpServer/elicitation/request`, `account/chatgptAuthTokens/refresh`)** — expect an immediate refusal reply (JSON-RPC error or `decline`) and a notice, never a hang. Test in Task 3/4.
2. **A file-change approval whose item Exodus never saw** — expect the prompt to say so ("the change wasn't shown — Deny unless you expected it"), not an empty detail. Test in Task 3.
3. **`send` before the handshake finished** (a step's task arrives while `initialize`/`thread/start` is in flight) — expect it queued and sent after, not dropped. Test in Task 4.
4. **`thread/start` / `thread/resume` failing (expired login, unknown thread)** — expect an `exit`-path failure with Codex's message, the process stopped. Test in Task 4.
5. **Interrupt before `turn/started` arrived** (no turn id yet) — expect the interrupt sent once the turn id is known, or the turn ends interrupted; never a lost Stop. Test in Task 4.

---

## File Structure

| File                                                                                                                                                          | Responsibility                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/shared/src/types/agents.ts`                                                                                                                         | + `'codex'` runtime/CLI, `AgentQuestion.id/isOther/isSecret`, `CliStatus.models`     |
| `packages/shared/src/schemas/settings-schema.ts`                                                                                                              | `defaultEmployeesCreated: Record<CliId, boolean>` replaces the boolean               |
| `src/main/lib/db/schema.ts`, `resources/drizzle/0016_codex_runtime.sql`                                                                                       | `agent_runtime` enum + `'codex'`                                                     |
| `src/main/lib/agents/drivers.ts` (new)                                                                                                                        | runtime → `{ start, resumeArgs }`                                                    |
| `src/main/lib/agents/codex/protocol.ts` (new)                                                                                                                 | JSON-RPC message → `AgentEvent[]` + pending server request (pure)                    |
| `src/main/lib/agents/codex/run.ts` (new)                                                                                                                      | `codex app-server` process: handshake, thread, turns, answers, interrupt             |
| `src/main/lib/agents/cli-check.ts`                                                                                                                            | Codex binary/min version/login check + model list                                    |
| `src/main/lib/agents/{run-agent-employee,card,terminal,default-employees}.ts`, routes `agents.ts`, `philharmonic-crud.ts`, `settings.ts`, `pm-coordinator.ts` | generalized to the runtime                                                           |
| renderer `agent-card-prompts.tsx`, `employee-editor.tsx`, `lib/employee-model.ts`                                                                             | Codex questions, no deny reason for Codex, Codex permission texts, model suggestions |
| `tests/fixtures/codex/{allow-decline-interrupt,resume}.jsonl` (exist), `fake-codex.mjs` (new)                                                                 | real app-server output; a replaying fake                                             |

The fixtures are the real server's stdout from the 2026-10-10 probe (sanitised: paths → `/tmp/exodus-project`, rate-limit payload replaced, noise notifications dropped). Each line is one JSON-RPC message from the server: responses (`id` + `result`), notifications (`method` + `params`), server requests (`id` + `method` + `params`). Request ids in responses refer to the probe's own request numbering: 1 `initialize`, 2 `thread/start` (or `thread/resume`), 3.. `turn/start`, and `turn/interrupt` interleaved.

---

### Task 1: Shared types, settings flag per CLI, migration 0016

**Files:**

- Modify: `packages/shared/src/types/agents.ts`, `packages/shared/src/schemas/settings-schema.ts:166-176`, `src/main/lib/db/schema.ts:299-302`
- Create: `resources/drizzle/0016_codex_runtime.sql` (+ generated meta)
- Modify: `src/main/lib/agents/default-employees.ts`, `src/main/lib/server/routes/settings.ts:78-86`
- Test: `tests/unit/shared/agents-settings-schema.test.ts` (extend), `tests/unit/main/lib/db/migrations/0016-codex-runtime.test.ts`, `tests/unit/main/lib/agents/default-employees.test.ts` (extend)

**Interfaces:**

- Produces:
  - `AGENT_RUNTIMES = ['exodus', 'claude-code', 'codex'] as const`; `CLI_IDS = ['claude-code', 'codex'] as const`; `CLI_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex' }`
  - `AgentQuestion` gains `id?: string; isOther?: boolean; isSecret?: boolean` (Claude Code questions leave them unset: answers keyed by question text, free text always offered)
  - `CliStatus` gains `models: string[] | null` (model ids a CLI reported; null when unknown)
  - `AgentsSettingsSchema.defaultEmployeesCreated: z.record(z.string(), z.boolean()).optional()` — replaces `defaultEmployeeCreated` (no shim)

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/shared/agents-settings-schema.test.ts — add
it('records default employees per CLI', () => {
  const parsed = AgentsSettingsSchema.parse({
    defaultEmployeesCreated: { 'claude-code': true }
  })
  expect(parsed.defaultEmployeesCreated).toEqual({ 'claude-code': true })
})
```

```ts
// tests/unit/main/lib/db/migrations/0016-codex-runtime.test.ts
import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0016 — codex runtime', () => {
  it('accepts codex as an employee runtime', async () => {
    const pg = await createMigratedPglite('0016')
    await pg.exec(`INSERT INTO agent (name, runtime) VALUES ('Codex', 'codex')`)
    const { rows } = await pg.query<{ runtime: string }>(
      `SELECT runtime FROM agent`
    )
    expect(rows).toEqual([{ runtime: 'codex' }])
    await pg.close()
  })
})
```

In `default-employees.test.ts` (read it first; it mocks settings, CLI status and `createAgent`) add: with `defaultEmployeesCreated: { 'claude-code': true }` and both CLIs ready, only a Codex employee is created and the flag becomes `{ 'claude-code': true, codex: true }`; with Codex not ready, nothing is created for it and its flag stays unset.

- [ ] **Step 2: Run — expect FAIL**: `bunx vitest run tests/unit/shared/agents-settings-schema.test.ts tests/unit/main/lib/db/migrations/0016-codex-runtime.test.ts tests/unit/main/lib/agents/default-employees.test.ts`

- [ ] **Step 3: Implement**
  - `agents.ts`: the three constants above; `AgentQuestion` and `CliStatus` fields above; update the `CLI_IDS` doc comment ("The CLIs Exodus can drive").
  - `settings-schema.ts`: replace `defaultEmployeeCreated: z.boolean().optional()` with
    ```ts
    /** Per CLI: its default employee was added once; never again (the owner may delete it). Server-owned. */
    defaultEmployeesCreated: z.record(z.string(), z.boolean()).optional()
    ```
  - `schema.ts`: `pgEnum('agent_runtime', ['exodus', 'claude-code', 'codex'])`; then `bunx drizzle-kit generate --name codex_runtime` → expect `ALTER TYPE "public"."agent_runtime" ADD VALUE 'codex';` and nothing else.
  - `default-employees.ts` `addOnce`: read `created = stored?.defaultEmployeesCreated ?? {}`; for each `id of CLI_IDS`: skip if `created[id]`; skip if not ready; mark `created[id] = true`; create the employee unless one with `runtime === id` exists; after the loop, if anything was marked, `updateSettingField('agents', { ...stored, defaultEmployeesCreated: created })`.
  - `settings.ts` (L78-86): preserve `defaultEmployeesCreated` (the stored value) on every save, replacing the old field.
  - `checkCli` in `cli-check.ts`: return `models: null` in every branch for now (Task 5 fills Codex's), so `CliStatus` typechecks.
  - Fix every compile error the renames cause (`bun run typecheck`); Claude Code questions keep working with `id` unset.

- [ ] **Step 4: Run the three tests and `bun run typecheck` — expect PASS**

- [ ] **Step 5: Commit** (stage the files above + `resources/drizzle/0016_codex_runtime.sql` + `resources/drizzle/meta`)

```bash
git commit -m "feat(agents): codex joins the runtimes and CLIs, each CLI gets its own once-only default employee, questions can carry ids, other-answer and secret flags (migration 0016)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Codex protocol — one JSON-RPC message to driver events

**Files:**

- Create: `src/main/lib/agents/codex/protocol.ts`
- Test: `tests/unit/main/lib/agents/codex/protocol.test.ts`

**Interfaces:**

- Consumes: `AgentEvent` (`../driver`), `AgentQuestion` (shared).
- Produces:

```ts
export type PendingKind = 'command' | 'fileChange' | 'permissions' | 'userInput'
export interface PendingRequest {
  /** The JSON-RPC id the reply must carry. */
  rpcId: number | string
  /** What the card and the respond route use: String(rpcId). */
  requestId: string
  kind: PendingKind
  params: Record<string, unknown>
}
/** A reply Exodus sends at once, without the owner (unsupported requests only — never an acceptance). */
export interface Refusal {
  rpcId: number | string
  result?: unknown
  error?: { code: number; message: string }
}
export interface ParsedMessage {
  events: AgentEvent[]
  pending?: PendingRequest
  refusal?: Refusal
  /** A reply to one of Exodus' own requests. */
  response?: {
    id: number | string
    result?: unknown
    error?: { code?: number; message?: string }
  }
  /** Set by turn/started. */
  turnId?: string
}
export interface CodexParser {
  /** The thread the run started or resumed (its id is the CLI session id). */
  setThread(id: string, model: string | null): void
  parse(line: string): ParsedMessage
}
export function createCodexParser(): CodexParser
export function describeCommand(params: Record<string, unknown>): string
export function describeFileChange(
  params: Record<string, unknown>,
  changes: FileChange[] | undefined
): string
export function describePermissions(params: Record<string, unknown>): string
export interface FileChange {
  path: string
  kind: { type: string; move_path?: string | null }
  diff: string
}
```

Mapping (spec §2–§3): `turn/started` → `init { cliSessionId: thread id, model }` + `turnId`; `item/agentMessage/delta` → `text_delta`; `item/completed` of `agentMessage` → `text` (and remembered as the turn's last text); `item/started` of `commandExecution` / `fileChange` / `mcpToolCall` / `webSearch` → `step_start` (`Bash` / `Edit` / `<server>.<tool>` / `WebSearch`), their `item/completed` → `step_end { isError: status ∈ {failed, declined} }` (a `declined` counts toward the turn's denials); `fileChange` items are remembered by id with their `changes`; the approval requests → `blocked` permission prompts + `pending`; `item/tool/requestUserInput` → `blocked` question prompt + `pending`; `mcpServer/elicitation/request` → `refusal { result: { action: 'decline', content: null } }` + a notice; any other server request → `refusal { error: { code: -32601, … } }` + a notice; `turn/completed` → `turn_end { ok: status === 'completed', interrupted: status === 'interrupted', text: failed ? (turn.error.message ?? last text) : last text, costUsd: null, denials }` (per-turn state then resets); `error` notification → notice; `account/rateLimits/updated` with a window at ≥100% used → notice; everything else and non-JSON → `{ events: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/agents/codex/protocol.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  createCodexParser,
  describeCommand,
  describeFileChange,
  describePermissions
} from '@main/lib/agents/codex/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const lines = (name: string) =>
  readFileSync(resolve(FIX, name), 'utf8').split('\n').filter(Boolean)

function replay(name: string) {
  const parser = createCodexParser()
  parser.setThread('01a1245d-2907-72f3-9b06-3dc67f153940', 'gpt-5.6-terra')
  const events: AgentEvent[] = []
  const pendings: unknown[] = []
  for (const l of lines(name)) {
    const p = parser.parse(l)
    events.push(...p.events)
    if (p.pending) pendings.push(p.pending)
  }
  return { events, pendings }
}

describe('Codex protocol', () => {
  it('maps the recorded run: four turns, the third interrupted, one change declined', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const ends = events.filter((e) => e.type === 'turn_end') as Extract<
      AgentEvent,
      { type: 'turn_end' }
    >[]
    expect(ends.map((e) => [e.ok, e.interrupted])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [true, false]
    ])
    expect(ends[1].denials).toBe(1)
    expect(ends[0].text).toMatch(/hello\.txt/u)
    expect(events.filter((e) => e.type === 'init')).toHaveLength(4)
  })

  it('turns the file-change approval into a prompt carrying the diff of the item announced before it', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const first = events.find((e) => e.type === 'blocked') as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(first.prompt).toMatchObject({ kind: 'permission', tool: 'Edit' })
    expect(first.prompt.kind === 'permission' && first.prompt.detail).toMatch(
      /hello\.txt[\s\S]*hi from exodus/u
    )
  })

  it('turns a command approval into a prompt with the whole command and its folder', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const cmd = events.find(
      (e) =>
        e.type === 'blocked' &&
        e.prompt.kind === 'permission' &&
        e.prompt.tool === 'Bash'
    ) as Extract<AgentEvent, { type: 'blocked' }>
    expect(cmd.prompt.kind === 'permission' && cmd.prompt.detail).toMatch(
      /sleep 20 && echo done[\s\S]*\/tmp\/exodus-project/u
    )
  })

  it('records each approval as pending with its JSON-RPC id', () => {
    const { pendings } = replay('allow-decline-interrupt.jsonl')
    expect(pendings).toHaveLength(4)
    expect(pendings[0]).toMatchObject({
      kind: 'fileChange',
      requestId: String((pendings[0] as { rpcId: number }).rpcId)
    })
  })

  it('pairs steps: every step that ends was started, declined ends as an error', () => {
    const { events } = replay('allow-decline-interrupt.jsonl')
    const starts = new Set(
      events
        .filter((e) => e.type === 'step_start')
        .map((e) => (e as { id: string }).id)
    )
    const ends = events.filter((e) => e.type === 'step_end') as Extract<
      AgentEvent,
      { type: 'step_end' }
    >[]
    expect(ends.every((e) => starts.has(e.id))).toBe(true)
    expect(ends.some((e) => e.isError)).toBe(true)
  })

  it('streams deltas that add up to the message', () => {
    const { events } = replay('resume.jsonl')
    const streamed = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('')
    const final = events
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text)
      .join('')
    expect(streamed).toBe(final)
  })

  it('says so when a file change was never shown', () => {
    expect(
      describeFileChange({ itemId: 'x', reason: null }, undefined)
    ).toMatch(/wasn.t shown/u)
  })

  it('keeps every field it does not render', () => {
    const d = describeCommand({
      command: 'curl x',
      cwd: '/p',
      reason: 'net',
      networkApprovalContext: { host: 'x' },
      threadId: 't',
      itemId: 'i'
    })
    expect(d).toMatch(/curl x/u)
    expect(d).toMatch(/networkApprovalContext/u)
    expect(d).not.toMatch(/threadId/u)
  })

  it('names the access a permission request asks for', () => {
    const d = describePermissions({
      cwd: '/p',
      reason: 'install',
      permissions: { network: { enabled: true }, fileSystem: null }
    })
    expect(d).toMatch(/install/u)
    expect(d).toMatch(/network/u)
  })

  it('makes a question prompt from requestUserInput, keeping ids and flags', () => {
    const p = createCodexParser()
    const out = p.parse(
      JSON.stringify({
        id: 9,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: 't',
          turnId: 'u',
          itemId: 'i',
          isBlocking: true,
          questions: [
            {
              id: 'q1',
              header: 'Token',
              question: 'Paste the token',
              isOther: false,
              isSecret: true,
              options: null
            }
          ]
        }
      })
    )
    expect(out.pending).toMatchObject({
      kind: 'userInput',
      rpcId: 9,
      requestId: '9'
    })
    expect(out.events[0]).toMatchObject({
      type: 'blocked',
      prompt: {
        kind: 'question',
        questions: [{ id: 'q1', isSecret: true, isOther: false, options: [] }]
      }
    })
  })

  it('refuses an MCP elicitation and anything it does not model, with a notice', () => {
    const p = createCodexParser()
    const e = p.parse(
      JSON.stringify({
        id: 4,
        method: 'mcpServer/elicitation/request',
        params: {}
      })
    )
    expect(e.refusal).toEqual({
      rpcId: 4,
      result: { action: 'decline', content: null }
    })
    expect(e.events[0]).toMatchObject({ type: 'notice' })
    const t = p.parse(
      JSON.stringify({ id: 5, method: 'item/tool/call', params: {} })
    )
    expect(t.refusal?.error?.code).toBe(-32601)
    expect(t.pending).toBeUndefined()
  })

  it("passes responses to Exodus' own requests through, and ignores noise", () => {
    const p = createCodexParser()
    expect(
      p.parse(JSON.stringify({ id: 2, result: { thread: { id: 't' } } }))
        .response
    ).toEqual({ id: 2, result: { thread: { id: 't' } } })
    expect(p.parse('not json').events).toEqual([])
    expect(
      p.parse(JSON.stringify({ method: 'thread/status/changed', params: {} }))
        .events
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**: `bunx vitest run tests/unit/main/lib/agents/codex/protocol.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/lib/agents/codex/protocol.ts
import type { AgentQuestion } from '@exodus/shared/types/agents'

import type { AgentEvent } from '../driver'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export type PendingKind = 'command' | 'fileChange' | 'permissions' | 'userInput'
export interface PendingRequest {
  rpcId: number | string
  requestId: string
  kind: PendingKind
  params: Json
}
export interface Refusal {
  rpcId: number | string
  result?: unknown
  error?: { code: number; message: string }
}
export interface ParsedMessage {
  events: AgentEvent[]
  pending?: PendingRequest
  refusal?: Refusal
  response?: {
    id: number | string
    result?: unknown
    error?: { code?: number; message?: string }
  }
  turnId?: string
}
export interface FileChange {
  path: string
  kind: { type: string; move_path?: string | null }
  diff: string
}
export interface CodexParser {
  setThread(id: string, model: string | null): void
  parse(line: string): ParsedMessage
}

/** Routing and suggestion fields — not what the owner approves. */
const META = new Set([
  'threadId',
  'turnId',
  'itemId',
  'startedAtMs',
  'approvalId',
  'environmentId',
  'availableDecisions',
  'proposedExecpolicyAmendment',
  'proposedNetworkPolicyAmendments',
  'commandActions',
  'kind'
])

function rest(params: Json, consumed: string[]): string {
  const left = Object.fromEntries(
    Object.entries(params).filter(
      ([k, v]) => !META.has(k) && !consumed.includes(k) && v != null
    )
  )
  return Object.keys(left).length
    ? `\n\nOther fields:\n${JSON.stringify(left, null, 2)}`
    : ''
}

export function describeCommand(params: Json): string {
  const command = str(params.command) ?? '(no command given)'
  const cwd = str(params.cwd)
  const reason = str(params.reason)
  return `${command}${cwd ? `\n\nin ${cwd}` : ''}${reason ? `\n\nReason: ${reason}` : ''}${rest(params, ['command', 'cwd', 'reason'])}`
}

const KIND: Record<string, string> = {
  add: 'Add',
  delete: 'Delete',
  update: 'Update'
}

export function describeFileChange(
  params: Json,
  changes: FileChange[] | undefined
): string {
  const reason = str(params.reason)
  const grantRoot = str(params.grantRoot)
  const body = changes?.length
    ? changes
        .map(
          (c) =>
            `${KIND[c.kind.type] ?? c.kind.type} ${c.path}${c.kind.move_path ? ` → ${c.kind.move_path}` : ''}\n${c.diff}`
        )
        .join('\n\n')
    : 'The change wasn’t shown to Exodus — Deny unless you expected it.'
  return `${body}${grantRoot ? `\n\nAlso asks to allow writes under ${grantRoot}.` : ''}${reason ? `\n\nReason: ${reason}` : ''}${rest(params, ['reason', 'grantRoot'])}`
}

export function describePermissions(params: Json): string {
  const reason = str(params.reason)
  const cwd = str(params.cwd)
  return `${reason ? `${reason}\n\n` : ''}Asks for:\n${JSON.stringify(params.permissions ?? null, null, 2)}${cwd ? `\n\nin ${cwd}` : ''}${rest(params, ['reason', 'cwd', 'permissions'])}`
}

const firstLine = (s: string) => s.split('\n')[0].slice(0, 160)

function stepOf(item: Json): { tool: string; summary: string } | null {
  switch (item.type) {
    case 'commandExecution': {
      const action =
        Array.isArray(item.commandActions) && isObj(item.commandActions[0])
          ? str(item.commandActions[0].command)
          : null
      return {
        tool: 'Bash',
        summary: firstLine(action ?? str(item.command) ?? '')
      }
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes)
        ? item.changes.filter(isObj)
        : []
      const first = str(changes[0]?.path) ?? ''
      return {
        tool: 'Edit',
        summary:
          changes.length > 1 ? `${first} (+${changes.length - 1})` : first
      }
    }
    case 'mcpToolCall':
      return {
        tool: `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`,
        summary: ''
      }
    case 'webSearch':
      return { tool: 'WebSearch', summary: firstLine(str(item.query) ?? '') }
    default:
      return null
  }
}

function questionsOf(params: Json): AgentQuestion[] {
  const qs = Array.isArray(params.questions)
    ? params.questions.filter(isObj)
    : []
  return qs.map((q) => ({
    id: str(q.id) ?? undefined,
    question: str(q.question) ?? '',
    header: str(q.header) ?? undefined,
    multiSelect: false,
    isOther: q.isOther === true,
    isSecret: q.isSecret === true,
    options: (Array.isArray(q.options) ? q.options.filter(isObj) : []).map(
      (o) => ({
        label: str(o.label) ?? '',
        description: str(o.description) ?? undefined
      })
    )
  }))
}

export function createCodexParser(): CodexParser {
  let threadId = ''
  let model: string | null = null
  const fileChanges = new Map<string, FileChange[]>()
  let lastText = ''
  let declined = 0

  const notice = (text: string): AgentEvent => ({ type: 'notice', text })

  function serverRequest(
    rpcId: number | string,
    method: string,
    params: Json
  ): ParsedMessage {
    const requestId = String(rpcId)
    switch (method) {
      case 'item/commandExecution/requestApproval':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: 'Bash',
                summary: firstLine(str(params.command) ?? ''),
                detail: describeCommand(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'command', params }
        }
      case 'item/fileChange/requestApproval': {
        const changes = fileChanges.get(str(params.itemId) ?? '')
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: 'Edit',
                summary: str(changes?.[0]?.path) ?? '',
                detail: describeFileChange(params, changes)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'fileChange', params }
        }
      }
      case 'item/permissions/requestApproval':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'permission',
                requestId,
                tool: 'Permissions',
                summary: firstLine(str(params.reason) ?? 'More access'),
                detail: describePermissions(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'permissions', params }
        }
      case 'item/tool/requestUserInput':
        return {
          events: [
            {
              type: 'blocked',
              prompt: {
                kind: 'question',
                requestId,
                questions: questionsOf(params)
              }
            }
          ],
          pending: { rpcId, requestId, kind: 'userInput', params }
        }
      case 'mcpServer/elicitation/request':
        return {
          events: [
            notice(
              'Codex asked something on behalf of an MCP server, which Exodus can’t answer — continue in Terminal.'
            )
          ],
          refusal: { rpcId, result: { action: 'decline', content: null } }
        }
      default:
        return {
          events: [
            notice(
              `Codex asked for “${method}”, which Exodus can’t answer — continue in Terminal.`
            )
          ],
          refusal: {
            rpcId,
            error: { code: -32601, message: `Exodus does not handle ${method}` }
          }
        }
    }
  }

  return {
    setThread(id, m) {
      threadId = id
      model = m
    },
    parse(line) {
      let m: unknown
      try {
        m = JSON.parse(line)
      } catch {
        return { events: [] }
      }
      if (!isObj(m)) return { events: [] }
      const id =
        typeof m.id === 'number' || typeof m.id === 'string' ? m.id : null
      const method = str(m.method)
      const params = isObj(m.params) ? m.params : {}
      if (id !== null && !method) {
        return {
          events: [],
          response: {
            id,
            ...('result' in m ? { result: m.result } : {}),
            ...(isObj(m.error)
              ? { error: m.error as { code?: number; message?: string } }
              : {})
          }
        }
      }
      if (id !== null && method) return serverRequest(id, method, params)
      const item = isObj(params.item) ? params.item : null
      switch (method) {
        case 'turn/started': {
          const turn = isObj(params.turn) ? params.turn : {}
          return {
            events: [{ type: 'init', cliSessionId: threadId, model }],
            turnId: str(turn.id) ?? undefined
          }
        }
        case 'item/agentMessage/delta':
          return str(params.delta)
            ? { events: [{ type: 'text_delta', delta: str(params.delta)! }] }
            : { events: [] }
        case 'item/started': {
          if (!item || !str(item.id)) return { events: [] }
          if (item.type === 'fileChange' && Array.isArray(item.changes))
            fileChanges.set(
              str(item.id)!,
              item.changes.filter(isObj) as unknown as FileChange[]
            )
          const step = stepOf(item)
          return step
            ? { events: [{ type: 'step_start', id: str(item.id)!, ...step }] }
            : { events: [] }
        }
        case 'item/completed': {
          if (!item || !str(item.id)) return { events: [] }
          if (item.type === 'agentMessage') {
            const text = str(item.text) ?? ''
            if (!text) return { events: [] }
            lastText = text
            return { events: [{ type: 'text', text }] }
          }
          if (!stepOf(item)) return { events: [] }
          if (item.status === 'declined') declined++
          return {
            events: [
              {
                type: 'step_end',
                id: str(item.id)!,
                isError: item.status === 'failed' || item.status === 'declined'
              }
            ]
          }
        }
        case 'turn/completed': {
          const turn = isObj(params.turn) ? params.turn : {}
          const status = str(turn.status)
          const error = isObj(turn.error) ? str(turn.error.message) : null
          const event: AgentEvent = {
            type: 'turn_end',
            ok: status === 'completed',
            interrupted: status === 'interrupted',
            text: status === 'failed' ? (error ?? lastText) : lastText,
            costUsd: null,
            denials: declined
          }
          lastText = ''
          declined = 0
          return { events: [event] }
        }
        case 'error':
          return {
            events: [
              notice(
                str(params.message) ??
                  (isObj(params.error)
                    ? (str(params.error.message) ?? 'Codex reported an error')
                    : 'Codex reported an error')
              )
            ]
          }
        case 'account/rateLimits/updated': {
          const limits = isObj(params.rateLimits) ? params.rateLimits : {}
          const full = ['primary', 'secondary'].some(
            (k) =>
              isObj(limits[k]) &&
              typeof (limits[k] as Json).usedPercent === 'number' &&
              ((limits[k] as Json).usedPercent as number) >= 100
          )
          return full
            ? {
                events: [
                  notice(`Rate limit reached: ${JSON.stringify(limits)}`)
                ]
              }
            : { events: [] }
        }
        default:
          return { events: [] }
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS.** If a fixture assertion disagrees with the recorded data, the fixture is the truth: read the line, and adjust only the assertion's literal while keeping its intent; say what changed in the report.

- [ ] **Step 5: Commit** (`protocol.ts`, the test, `tests/fixtures/codex/*.jsonl`)

```bash
git commit -m "feat(agents): read codex app-server — turns, items, approvals with the full command or diff, questions, and refusals for what Exodus can't answer — from the real server's recorded output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One process supervisor for both CLIs, the fake Codex, and the Codex run

**Files:**

- Create: `src/main/lib/agents/process.ts` (the lifecycle phase 1 built inside `claude-code/run.ts`, extracted unchanged)
- Modify: `src/main/lib/agents/claude-code/run.ts` (use it; behaviour unchanged)
- Create: `tests/fixtures/codex/fake-codex.mjs`, `src/main/lib/agents/codex/run.ts`
- Test: `tests/unit/main/lib/agents/process.test.ts`, `tests/unit/main/lib/agents/codex/run.test.ts`; `tests/unit/main/lib/agents/claude-code/run.test.ts` must pass unchanged

**Interfaces:**

- Consumes: `createCodexParser`, `PendingRequest` (Task 2); `StartInput`, `AgentRun`, `AgentEvent` (`../driver`); `AgentAnswer` (shared).
- Produces:

```ts
// process.ts
export interface ExitInfo { code: number | null; stderrTail: string; expected: boolean }
export interface Supervised {
  readonly alive: boolean
  /** One JSON value, one line; false when the child is gone or stdin is closed. */
  write(value: unknown): boolean
  /** End stdin, SIGTERM after 1.5 s, SIGKILL after 3 s; resolves once `onExit` has run. */
  stop(): Promise<void>
  /** Kill the child and report `message` as the exit's stderr tail, unexpected (a failed handshake). */
  fail(message: string): Promise<void>
}
export function superviseProcess(opts: {
  binPath: string
  args: string[]
  cwd: string
  env: Record<string, string>
  logPath: string
  onLine(line: string): void
  /** Called exactly once, after stdout drained (≤1.5 s after the child exits); no `onLine` after it. */
  onExit(info: ExitInfo): void
}): Supervised
// codex/run.ts
export const CODEX_APPROVAL: Record<PermissionMode, 'untrusted' | 'on-request' | 'never'> // default/acceptEdits/auto
export function startCodex(input: StartInput): AgentRun
```

`superviseProcess` is the code now in `startClaudeCode` lines ~42–170: the O_NOFOLLOW + `nlink === 1` log, `spawn`, the no-op error listeners on stdin/stdout/stderr, `readline` with `if (finished) return` and the log write before `onLine`, the 4096-char stderr tail, `onChildGone` / `finish` with the 1.5 s drain cap and `stdoutClosed`, and `stop()`. `fail(message)` sets the exit message to `message`, marks the exit unexpected, ends stdin and kills (SIGTERM, then SIGKILL after 1.5 s). `startClaudeCode` keeps its own state (`pending`, `busy`, `interruptRequested`, …) and calls `superviseProcess` with `onLine` = today's line handler and `onExit` = clear `pending`, `busy = false`, emit `exit`.

The fake (`fake-codex.mjs`, plain JS, `#!/usr/bin/env node`):

| Invocation / variable      | Behaviour                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--version`                | prints `FAKE_CODEX_VERSION` or `codex-cli 0.162.1`                                                                                           |
| `login status`             | prints `FAKE_CODEX_LOGIN` or `Logged in using ChatGPT`; exits `FAKE_CODEX_LOGIN_EXIT` or 0                                                   |
| `app-server`               | the protocol (below)                                                                                                                         |
| `FAKE_CODEX_FIXTURE`       | the `.jsonl` to replay                                                                                                                       |
| `FAKE_CODEX_RECORD`        | append `{argv}` once, then every stdin line                                                                                                  |
| `FAKE_CODEX_INIT_DELAY_MS` | delay the `initialize` reply                                                                                                                 |
| `FAKE_CODEX_THREAD_ERROR`  | answer `thread/start` / `thread/resume` with `{error:{code:-32000,message:<value>}}`                                                         |
| `FAKE_CODEX_EXTRA_REQUEST` | a JSON server request emitted right after each `turn/started` (e.g. a `requestUserInput`, an `item/tool/call`); the turn waits for its reply |
| `FAKE_CODEX_MODELS`        | the `model/list` result (JSON)                                                                                                               |

Protocol: replies to `initialize` with the fixture's `id:1` result (or `{userAgent:'fake'}`), to `thread/start` / `thread/resume` with the fixture's `id:2` result, to `model/list` with `FAKE_CODEX_MODELS` or `{data:[],nextCursor:null}`. The fixture's turns are the lines from each `turn/started` notification to its `turn/completed`, response lines (id without method) dropped. Each `turn/start` request is answered `{turn:{id:<that turn's id>}}` and plays the next turn; a server-request line pauses until a reply with that id arrives; `turn/interrupt` is answered `{}`, then a `turn/completed` with `status:'interrupted'` ends the turn (rest skipped). Unknown requests are answered `{}`. On stdin close it exits 0 once the current turn is done.

- [ ] **Step 1: Write the fake** (complete file)

```js
#!/usr/bin/env node
// tests/fixtures/codex/fake-codex.mjs — replays recorded `codex app-server` output (plan Task 3).
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log(process.env.FAKE_CODEX_VERSION ?? 'codex-cli 0.162.1')
  process.exit(0)
}
if (args[0] === 'login' && args[1] === 'status') {
  console.log(process.env.FAKE_CODEX_LOGIN ?? 'Logged in using ChatGPT')
  process.exit(Number(process.env.FAKE_CODEX_LOGIN_EXIT ?? 0))
}
const record = (o) =>
  process.env.FAKE_CODEX_RECORD &&
  appendFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify(o) + '\n')
record({ argv: args })

const lines = process.env.FAKE_CODEX_FIXTURE
  ? readFileSync(process.env.FAKE_CODEX_FIXTURE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : []
const responseTo = (id) =>
  lines.find((m) => m.id === id && !m.method && 'result' in m)?.result
const turns = []
let current = null
for (const m of lines) {
  if (m.id !== undefined && !m.method) continue
  if (m.method === 'turn/started') current = []
  if (current) current.push(m)
  if (m.method === 'turn/completed' && current) {
    turns.push(current)
    current = null
  }
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let played = 0
let playing = false
let waitingFor = null
let resume = null
let interrupted = false

async function playTurn() {
  const turn = turns[played++] ?? []
  playing = true
  const turnId = turn[0]?.params?.turn?.id ?? `turn-${played}`
  for (const m of turn) {
    if (interrupted) break
    out(m)
    if (m.method === 'turn/started' && process.env.FAKE_CODEX_EXTRA_REQUEST) {
      const extra = JSON.parse(process.env.FAKE_CODEX_EXTRA_REQUEST)
      out(extra)
      waitingFor = extra.id
      await new Promise((r) => (resume = r))
    }
    if (m.id !== undefined && m.method) {
      waitingFor = m.id
      await new Promise((r) => (resume = r))
    }
    await sleep(1)
  }
  if (interrupted) {
    out({
      method: 'turn/completed',
      params: {
        threadId: 't',
        turn: { id: turnId, status: 'interrupted', error: null }
      }
    })
    interrupted = false
  }
  playing = false
}

const isPlaying = () => playing
createInterface({ input: process.stdin })
  .on('line', async (line) => {
    record({ stdin: JSON.parse(line) })
    const m = JSON.parse(line)
    if (m.id !== undefined && !m.method) {
      if (m.id === waitingFor) {
        waitingFor = null
        resume?.()
      }
      return
    }
    switch (m.method) {
      case 'initialize':
        await sleep(Number(process.env.FAKE_CODEX_INIT_DELAY_MS ?? 0))
        return out({ id: m.id, result: responseTo(1) ?? { userAgent: 'fake' } })
      case 'initialized':
        return
      case 'thread/start':
      case 'thread/resume':
        if (process.env.FAKE_CODEX_THREAD_ERROR)
          return out({
            id: m.id,
            error: {
              code: -32000,
              message: process.env.FAKE_CODEX_THREAD_ERROR
            }
          })
        return out({
          id: m.id,
          result: responseTo(2) ?? {
            thread: { id: 'fake-thread' },
            model: 'fake'
          }
        })
      case 'model/list':
        return out({
          id: m.id,
          result: process.env.FAKE_CODEX_MODELS
            ? JSON.parse(process.env.FAKE_CODEX_MODELS)
            : { data: [], nextCursor: null }
        })
      case 'turn/start': {
        const next =
          turns[played]?.[0]?.params?.turn?.id ?? `turn-${played + 1}`
        out({ id: m.id, result: { turn: { id: next } } })
        return void playTurn()
      }
      case 'turn/interrupt':
        interrupted = true
        out({ id: m.id, result: {} })
        if (waitingFor !== null) {
          waitingFor = null
          resume?.()
        }
        return
      default:
        return out({ id: m.id, result: {} })
    }
  })
  .on('close', async () => {
    while (isPlaying()) await sleep(5)
    process.exit(0)
  })
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/main/lib/agents/process.test.ts — the supervisor on its own
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { superviseProcess, type ExitInfo } from '@main/lib/agents/process'
import { describe, expect, it } from 'vitest'

function script(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sup-'))
  const file = join(dir, 'child.sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

function run(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sup-log-'))
  const lines: string[] = []
  let exit: ExitInfo | null = null
  let finished = () => {}
  const done = new Promise<void>((ok) => (finished = ok))
  const sup = superviseProcess({
    binPath: script(body),
    args: [],
    cwd: dir,
    env: { PATH: process.env.PATH ?? '' },
    logPath: join(dir, 'log'),
    onLine: (l) => lines.push(l),
    onExit: (e) => {
      exit = e
      finished()
    }
  })
  return { lines, done, sup, exit: () => exit }
}

describe('superviseProcess', () => {
  it('delivers every line before the exit', async () => {
    const r = run('for i in 1 2 3; do echo "{\\"n\\":$i}"; done')
    await r.done
    expect(r.lines).toEqual(['{"n":1}', '{"n":2}', '{"n":3}'])
    expect(r.exit()).toMatchObject({ code: 0, expected: false })
  })

  it('reports a failed handshake as an unexpected exit carrying the message', async () => {
    const r = run('sleep 30')
    await r.sup.fail('Not logged in')
    await r.done
    expect(r.exit()).toMatchObject({
      expected: false,
      stderrTail: 'Not logged in'
    })
  })

  it('stop ends the child and marks the exit expected', async () => {
    const r = run('cat')
    await r.sup.stop()
    await r.done
    expect(r.exit()).toMatchObject({ expected: true })
  })
})
```

```ts
// tests/unit/main/lib/agents/codex/run.test.ts
import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { startCodex } from '@main/lib/agents/codex/run'
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
import { beforeAll, describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/codex')
const FAKE = join(FIX, 'fake-codex.mjs')
beforeAll(() => chmodSync(FAKE, 0o755))

function start(
  fixture: string,
  extra: Record<string, string> = {},
  input: Partial<Parameters<typeof startCodex>[0]> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-run-'))
  const recordPath = join(dir, 'record.jsonl')
  const logPath = join(dir, 'raw.jsonl')
  const run = startCodex({
    binPath: FAKE,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CODEX_FIXTURE: join(FIX, fixture),
      FAKE_CODEX_RECORD: recordPath,
      ...extra
    },
    permissionMode: 'default',
    logPath,
    ...input
  })
  const events: AgentEvent[] = []
  run.on((e) => events.push(e))
  const recorded = () =>
    readFileSync(recordPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.stdin)
      .map((r) => r.stdin)
  return { run, events, recorded, logPath }
}

function next(
  run: AgentRun,
  match: (e: AgentEvent) => boolean,
  ms = 5000
): Promise<AgentEvent> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('timed out')), ms)
    const off = run.on((e) => {
      if (match(e)) {
        clearTimeout(timer)
        off()
        ok(e)
      }
    })
  })
}
const blocked = (run: AgentRun) =>
  next(run, (e) => e.type === 'blocked') as Promise<
    Extract<AgentEvent, { type: 'blocked' }>
  >

describe('Codex run', () => {
  it('handshakes, starts a thread in workspace-write with the mode’s approval policy, never full access', async () => {
    for (const [mode, policy] of [
      ['default', 'untrusted'],
      ['acceptEdits', 'on-request'],
      ['auto', 'never']
    ] as const) {
      const { run, recorded } = start(
        'allow-decline-interrupt.jsonl',
        {},
        { permissionMode: mode, model: 'gpt-x' }
      )
      run.send('hi')
      await next(run, (e) => e.type === 'init')
      const sent = recorded()
      expect(sent[0]).toMatchObject({
        method: 'initialize',
        params: { clientInfo: { name: 'exodus' } }
      })
      expect(sent[1]).toEqual({ method: 'initialized' })
      expect(sent[2]).toMatchObject({
        method: 'thread/start',
        params: {
          approvalPolicy: policy,
          sandbox: 'workspace-write',
          model: 'gpt-x'
        }
      })
      expect(JSON.stringify(sent)).not.toMatch(/danger-full-access/u)
      await run.stop()
    }
  })

  it('accepts a change on Allow with the request’s own id', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('create hello.txt')
    const b = await blocked(run)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    await next(run, (e) => e.type === 'turn_end')
    expect(recorded()).toContainEqual({
      id: Number(b.prompt.requestId),
      result: { decision: 'accept' }
    })
    expect(run.cliSessionId).toBe('01a1245d-2907-72f3-9b06-3dc67f153940')
    await run.stop()
  })

  it('declines on Deny', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('2')
    const b = await blocked(run)
    run.respond(b.prompt.requestId, { kind: 'deny', reason: 'not this' })
    const end = (await next(run, (e) => e.type === 'turn_end')) as Extract<
      AgentEvent,
      { type: 'turn_end' }
    >
    expect(recorded()).toContainEqual({
      id: Number(b.prompt.requestId),
      result: { decision: 'decline' }
    })
    expect(end.denials).toBe(1)
    await run.stop()
  })

  it('interrupts the running turn by its id and lives on', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl')
    for (let i = 0; i < 2; i++) {
      run.send(String(i))
      run.respond((await blocked(run)).prompt.requestId, {
        kind: i === 0 ? 'allow' : 'deny'
      })
      await next(run, (e) => e.type === 'turn_end')
    }
    run.send('sleep')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true, ok: false })
    expect(
      recorded().find((m) => m.method === 'turn/interrupt')?.params
    ).toMatchObject({ threadId: '01a1245d-2907-72f3-9b06-3dc67f153940' })
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('sends a Stop pressed before the turn had an id once the id is known', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '200'
    })
    run.send('1')
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true })
    expect(
      recorded().filter((m) => m.method === 'turn/interrupt')
    ).toHaveLength(1)
    await run.stop()
  })

  it('queues a task sent before the handshake finished', async () => {
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_INIT_DELAY_MS: '300'
    })
    expect(run.send('early')).toBe(true)
    await next(run, (e) => e.type === 'init')
    const methods = recorded().map((m) => m.method)
    expect(methods.indexOf('turn/start')).toBeGreaterThan(
      methods.indexOf('thread/start')
    )
    await run.stop()
  })

  it('resumes a thread by id in a new process', async () => {
    const { run, recorded } = start(
      'resume.jsonl',
      {},
      { resume: '01a1245d-2907-72f3-9b06-3dc67f153940' }
    )
    run.send('what did I refuse?')
    await next(run, (e) => e.type === 'turn_end')
    expect(
      recorded().find((m) => m.method === 'thread/resume')?.params
    ).toMatchObject({
      threadId: '01a1245d-2907-72f3-9b06-3dc67f153940',
      sandbox: 'workspace-write'
    })
    await run.stop()
  })

  it('fails with Codex’s message when the thread can’t start', async () => {
    const { run } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_THREAD_ERROR: 'Not logged in'
    })
    run.send('x')
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ expected: false })
    expect((exit as { stderrTail: string }).stderrTail).toMatch(
      /Not logged in/u
    )
  })

  it('refuses a server request it does not model, at once, and the turn goes on', async () => {
    const extra = JSON.stringify({
      id: 900,
      method: 'item/tool/call',
      params: { tool: 'x' }
    })
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const b = await blocked(run)
    expect(recorded().find((m) => m.id === 900)?.error?.code).toBe(-32601)
    run.respond(b.prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
  })

  it('answers a question by question id, and never logs a secret answer', async () => {
    const extra = JSON.stringify({
      id: 901,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        isBlocking: true,
        questions: [
          {
            id: 'tok',
            header: 'Token',
            question: 'Paste it',
            isOther: false,
            isSecret: true,
            options: null
          }
        ]
      }
    })
    const { run, recorded, logPath } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const q = await blocked(run)
    expect(q.prompt.kind).toBe('question')
    run.respond(q.prompt.requestId, {
      kind: 'answers',
      answers: { tok: 's3cret-value' }
    })
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(recorded()).toContainEqual({
      id: 901,
      result: { answers: { tok: { answers: ['s3cret-value'] } } }
    })
    expect(readFileSync(logPath, 'utf8')).not.toMatch(/s3cret-value/u)
  })

  it('grants a permission request for this turn only, or nothing on Deny', async () => {
    const extra = JSON.stringify({
      id: 902,
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        environmentId: null,
        startedAtMs: 0,
        cwd: '/p',
        reason: 'install deps',
        permissions: { network: { enabled: true }, fileSystem: null }
      }
    })
    const { run, recorded } = start('allow-decline-interrupt.jsonl', {
      FAKE_CODEX_EXTRA_REQUEST: extra
    })
    run.send('1')
    const p = await blocked(run)
    run.respond(p.prompt.requestId, { kind: 'allow' })
    expect(recorded()).toContainEqual({
      id: 902,
      result: { permissions: { network: { enabled: true } }, scope: 'turn' }
    })
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
  })

  it('logs the server’s lines', async () => {
    const { run, logPath } = start('allow-decline-interrupt.jsonl')
    run.send('1')
    run.respond((await blocked(run)).prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    expect(readFileSync(logPath, 'utf8')).toMatch(/turn\/completed/u)
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (`process.ts` and `codex/run.ts` missing): `bunx vitest run tests/unit/main/lib/agents/process.test.ts tests/unit/main/lib/agents/codex/run.test.ts`

- [ ] **Step 4: Extract `process.ts`** from `claude-code/run.ts` exactly as described in Interfaces (move, don't rewrite: the log guard, error listeners, readline + `finished` guard, stderr tail, drain-capped finish, stop's timers), add `fail(message)`, and make `startClaudeCode` use it. Run `bunx vitest run tests/unit/main/lib/agents/claude-code tests/unit/main/lib/agents/process.test.ts` — the Claude Code tests must pass unchanged.

- [ ] **Step 5: Implement `codex/run.ts`**

```ts
// src/main/lib/agents/codex/run.ts
import type { AgentAnswer, PermissionMode } from '@exodus/shared/types/agents'

import type { AgentEvent, AgentRun, StartInput } from '../driver'
import { superviseProcess } from '../process'
import { createCodexParser, type PendingRequest } from './protocol'

/** Spec §4: Exodus' modes by meaning; the sandbox is always workspace-write. */
export const CODEX_APPROVAL: Record<
  PermissionMode,
  'untrusted' | 'on-request' | 'never'
> = {
  default: 'untrusted',
  acceptEdits: 'on-request',
  auto: 'never'
}

type Json = Record<string, unknown>

/** One `codex app-server` process (spec §3). Never throws: failures arrive as `exit`. */
export function startCodex(input: StartInput): AgentRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const emit = (e: AgentEvent) => {
    for (const l of Array.from(listeners)) l(e)
  }
  const parser = createCodexParser()
  const pending = new Map<string, PendingRequest>()
  const waiting = new Map<
    number,
    { ok(result: unknown): void; no(message: string): void }
  >()
  const queue: string[] = []
  let nextId = 1
  let threadId: string | null = null
  let turnId: string | null = null
  let ready = false
  let alive = true
  let busy = false
  let interruptWanted = false

  const proc = superviseProcess({
    binPath: input.binPath,
    args: ['app-server'],
    cwd: input.cwd,
    env: input.env,
    logPath: input.logPath,
    onLine(line) {
      const parsed = parser.parse(line)
      if (parsed.response) {
        const w = waiting.get(Number(parsed.response.id))
        waiting.delete(Number(parsed.response.id))
        if (parsed.response.error)
          w?.no(parsed.response.error.message ?? 'Codex refused the request')
        else w?.ok(parsed.response.result)
      }
      if (parsed.refusal)
        proc.write({
          id: parsed.refusal.rpcId,
          ...(parsed.refusal.error
            ? { error: parsed.refusal.error }
            : { result: parsed.refusal.result })
        })
      if (parsed.pending) pending.set(parsed.pending.requestId, parsed.pending)
      if (parsed.turnId) {
        turnId = parsed.turnId
        if (interruptWanted) sendInterrupt()
      }
      for (const e of parsed.events) {
        if (e.type === 'init') busy = true
        if (e.type === 'turn_end') {
          busy = false
          turnId = null
          interruptWanted = false
          pending.clear()
        }
        emit(e)
      }
    },
    onExit(info) {
      alive = false
      busy = false
      pending.clear()
      for (const w of waiting.values()) w.no('Codex exited')
      waiting.clear()
      emit({ type: 'exit', ...info })
    }
  })

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((ok, no) => {
      const id = nextId++
      waiting.set(id, { ok, no })
      if (!proc.write({ id, method, params })) {
        waiting.delete(id)
        no('Codex is not running')
      }
    })

  const sendTurn = (text: string) => {
    void request('turn/start', {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }]
    }).then(
      (r) => {
        const id = (r as { turn?: { id?: string } })?.turn?.id
        if (id && !turnId) {
          turnId = id
          if (interruptWanted) sendInterrupt()
        }
      },
      (message: string) =>
        emit({ type: 'notice', text: `Codex refused the task: ${message}` })
    )
  }

  function sendInterrupt() {
    if (!threadId || !turnId) return
    interruptWanted = false
    void request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  const threadParams = {
    cwd: input.cwd,
    approvalPolicy: CODEX_APPROVAL[input.permissionMode],
    sandbox: 'workspace-write',
    ...(input.model ? { model: input.model } : {})
  }

  void (async () => {
    try {
      await request('initialize', {
        clientInfo: { name: 'exodus', title: 'Exodus', version: '1' },
        capabilities: null
      })
      proc.write({ method: 'initialized' })
      const r = (await request(
        input.resume ? 'thread/resume' : 'thread/start',
        input.resume
          ? { threadId: input.resume, ...threadParams }
          : threadParams
      )) as { thread?: { id?: string }; model?: string }
      threadId = r?.thread?.id ?? null
      if (!threadId) throw new Error('Codex started no thread')
      parser.setThread(threadId, r.model ?? input.model ?? null)
      ready = true
      for (const text of queue.splice(0)) sendTurn(text)
    } catch (err) {
      await proc.fail(err instanceof Error ? err.message : String(err))
    }
  })()

  function reply(p: PendingRequest, answer: AgentAnswer): Json {
    if (p.kind === 'command' || p.kind === 'fileChange')
      return { decision: answer.kind === 'allow' ? 'accept' : 'decline' }
    if (p.kind === 'permissions') {
      const asked = (p.params.permissions ?? {}) as Json
      const granted = Object.fromEntries(
        Object.entries(asked).filter(([, v]) => v != null)
      )
      return {
        permissions: answer.kind === 'allow' ? granted : {},
        scope: 'turn'
      }
    }
    const given = answer.kind === 'answers' ? answer.answers : {}
    const questions = Array.isArray(p.params.questions)
      ? (p.params.questions as Json[])
      : []
    return {
      answers: Object.fromEntries(
        questions
          .map((q) => String(q.id ?? ''))
          .filter((id) => id && given[id] !== undefined)
          .map((id) => [id, { answers: [given[id]] }])
      )
    }
  }

  return {
    get cliSessionId() {
      return threadId
    },
    get alive() {
      return alive
    },
    get busy() {
      return busy
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send(text) {
      if (!alive) return false
      busy = true
      if (ready) sendTurn(text)
      else queue.push(text)
      return true
    },
    respond(requestId, answer) {
      const p = pending.get(requestId)
      if (!p || !alive) return false
      if (!proc.write({ id: p.rpcId, result: reply(p, answer) })) return false
      pending.delete(requestId)
      emit({ type: 'answered', requestId })
      return true
    },
    interrupt() {
      if (!busy || !alive) return false
      interruptWanted = true
      sendInterrupt()
      return true
    },
    stop() {
      return proc.stop()
    }
  }
}
```

A question answer arrives as `AgentAnswer { kind: 'answers', answers: { [questionId]: string } }` — the renderer keys Codex answers by `question.id` (Task 5). Only stdout is logged, so the owner's answers (stdin) never reach the log.

- [ ] **Step 6: Run** `bunx vitest run tests/unit/main/lib/agents` three times — all pass each time (report the three results). Adjust only the fake if a test reveals it doesn't mirror the recorded protocol; never weaken an assertion about what Exodus sends.

- [ ] **Step 7: Commit** (`process.ts`, `claude-code/run.ts`, `codex/run.ts`, `fake-codex.mjs`, the tests)

```bash
git commit -m "feat(agents): run Codex through its app-server — handshake, thread start or resume in workspace-write, turns, answers by request id, interrupt by turn id; both CLIs now share one process supervisor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every runtime-specific place reads the runtime — and Codex is wired in

**Files:**

- Create: `src/main/lib/agents/drivers.ts`
- Modify: `src/main/lib/agents/cli-check.ts`, `run-agent-employee.ts` (L7, 30-31, 56-66, 75, 182-190, 262, 274, 308-317, 383, 394), `card.ts:119`, `terminal.ts:24-29` + `writeResumeScript`, `src/main/lib/server/routes/agents.ts:99-121`, `philharmonic-crud.ts:66-73`, `src/main/lib/ai/philharmonic/pm-coordinator.ts:151-153`
- Test: `tests/unit/main/lib/agents/drivers.test.ts`, extend `cli-check.test.ts`, `run-agent-employee.test.ts`, `terminal.test.ts`, `tests/unit/main/lib/server/routes/agents.test.ts`

**Interfaces:**

- Consumes: `startClaudeCode` (claude-code/run), `startCodex` (Task 3), `CLI_IDS`, `CLI_NAMES`, `CliStatus.models` (Task 1).
- Produces:

```ts
// drivers.ts
export interface CliDriver {
  start(input: StartInput): AgentRun
  /** The CLI's own arguments to resume a session in a terminal (after the binary). */
  resumeArgs(cliSessionId: string): string[]
}
export const DRIVERS: Record<CliId, CliDriver> = {
  'claude-code': { start: startClaudeCode, resumeArgs: (id) => ['--resume', id] },
  codex: { start: startCodex, resumeArgs: (id) => ['resume', id] }
}
export function cliOf(runtime: string): CliId  // throws for 'exodus' or an unknown runtime
// run-agent-employee.ts
export interface RunAgentEmployeeDeps {
  start(cli: CliId, input: StartInput): AgentRun          // default: DRIVERS[cli].start(input)
  registry: AgentRegistry
  cliStatus(cli: CliId): Promise<CliStatus>               // default: getCliStatus
  env(): Promise<Record<string, string>>
}
// terminal.ts
export function resumeScript(cwd: string, binPath: string, args: string[]): string
export async function writeResumeScript(cwd: string, binPath: string, args: string[]): Promise<string>
// cli-check.ts
CLI_BINARY = { 'claude-code': 'claude', codex: 'codex' }
MIN_VERSION = { 'claude-code': '2.1.294', codex: '0.162.1' }
CheckDeps gains listModels(cli: CliId, path: string, env: Record<string, string>): Promise<string[] | null>
export function parseCodexLoginStatus(code: number, out: string): { loggedIn: boolean; authMethod: string | null }
```

Rules: Codex is logged in when `codex login status` exits 0 and its output contains "Logged in"; `authMethod` is the text after "using " ("ChatGPT", "API key"). Codex's `models` come from a short-lived `codex app-server`: `initialize` → `initialized` → `model/list {}` → the non-hidden entries' `model` (falling back to `id`), the process stopped after; a failure or 10 s timeout gives `null` (never fails the check). Claude Code's `models` stay `null`. Every user-facing string that named "Claude Code" now uses `CLI_NAMES[cli]`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/main/lib/agents/drivers.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
const { DRIVERS, cliOf } = await import('@main/lib/agents/drivers')

describe('drivers', () => {
  it('has one for every CLI, each with its own resume arguments', () => {
    expect(DRIVERS['claude-code'].resumeArgs('abc')).toEqual([
      '--resume',
      'abc'
    ])
    expect(DRIVERS.codex.resumeArgs('abc')).toEqual(['resume', 'abc'])
  })
  it('maps a CLI runtime and refuses Exodus’ own', () => {
    expect(cliOf('codex')).toBe('codex')
    expect(() => cliOf('exodus')).toThrow()
    expect(() => cliOf('nope')).toThrow()
  })
})
```

In `cli-check.test.ts` add (reusing its fake-binary helper, or `tests/fixtures/codex/fake-codex.mjs` copied to a temp dir named `codex`): a fake `codex` printing `codex-cli 0.162.1` / `Logged in using ChatGPT` → `ready`, `authMethod: 'ChatGPT'`; `codex-cli 0.150.0` → `too_old`; login exit 1 with "Not logged in" → `logged_out`; `parseCodexLoginStatus(0, 'Logged in using API key')` → `{ loggedIn: true, authMethod: 'API key' }`; with `listModels` injected returning `['gpt-x']` the ready status carries `models: ['gpt-x']`; a Claude Code ready status has `models: null`.

In `terminal.test.ts` add: `resumeScript('/p', '/bin/codex', ['resume', 'abc'])` contains `exec '/bin/codex' 'resume' 'abc'` and passes `sh -n`.

In `run-agent-employee.test.ts`: change every `deps.start` fake to `(cli, input) => …` and `cliStatus: async (cli) => …`; add a case with `agent.runtime = 'codex'` asserting `start` received `'codex'`, `cliStatus` was asked for `'codex'`, the card's `runtime` is `'codex'`, the created session row's `runtime` is `'codex'`, and the PM output starts `[Codex · done]`.

In the routes test: the terminal route for a session with `runtime: 'codex'` asks `getCliStatus('codex')` and writes a script with `['resume', <id>]` (mock `writeResumeScript` and assert its third argument).

- [ ] **Step 2: Run — expect FAIL**: `bunx vitest run tests/unit/main/lib/agents tests/unit/main/lib/server/routes/agents.test.ts`

- [ ] **Step 3: Implement**
  - `drivers.ts` as in Interfaces; `cliOf` checks `CLI_IDS.includes(runtime)`.
  - `cli-check.ts`: the two records; the auth step branches on `id`: Claude Code keeps `auth status` JSON; Codex runs `login status` through `parseCodexLoginStatus`. After a `ready` result, `models = await deps.listModels(id, path, env)` (default deps: Claude Code → `null`; Codex → the short-lived app-server above, using `superviseProcess` with a throwaway log path in `os.tmpdir()` and a JSON-RPC exchange as in `codex/run.ts`).
  - `run-agent-employee.ts`: `const cli = cliOf(agent.runtime)`; `deps.cliStatus(cli)`, `deps.start(cli, {...})`, `runtime: cli` in `createAgentSession` and `newCard`; the folder/not-ready/stopped/not-running messages read `CLI_NAMES[cli]`; `formatAgentOutput` uses `CLI_NAMES[card.runtime]`.
  - `card.ts:119`: `` `${CLI_NAMES[card.runtime]} exited (code ${e.code ?? '?'}).` ``.
  - `terminal.ts`: `resumeScript(cwd, binPath, args)` → `` `#!/bin/sh\nrm -f -- "$0"\ncd ${shellQuote(cwd)} && exec ${[binPath, ...args].map(shellQuote).join(' ')}\n` ``; `writeResumeScript` takes `args` and passes them.
  - `routes/agents.ts` terminal route: `const cli = cliOf(session.runtime)`; `getCliStatus(cli)`; `writeResumeScript(session.cwd, status.path, DRIVERS[cli].resumeArgs(session.cliSessionId))`; the two messages use `CLI_NAMES[cli]`.
  - `philharmonic-crud.ts`: `` `Invalid model name for ${CLI_NAMES[cliOf(runtime)]}` ``.
  - `pm-coordinator.ts:151-153`: `` `[Coding agent — ${CLI_NAMES[cliOf(e.runtime)]} on the owner's machine; …]` `` (same remainder).
  - Grep `src/main` for `'claude-code'` and `Claude Code` afterwards: what remains must be the driver table, `CLI_NAMES`, `MIN_VERSION`, `CLI_BINARY`, or Claude Code's own driver/protocol.

- [ ] **Step 4: Run** `bunx vitest run tests/unit/main/lib/agents tests/unit/main/lib/server tests/unit/main/lib/ai/philharmonic`, `bun run typecheck`, `bun run lint` — all pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agents): Codex employees run — the step, the check, Continue in Terminal and every message read the employee's CLI; Codex is checked by its login status and reports its models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The renderer — Codex questions, prompts without a reason, Codex permission texts, model suggestions

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/agent-card-prompts.tsx` (PermissionPrompt L49-103, QuestionChoices/QuestionPrompt L105-204)
- Modify: `src/renderer/components/philharmonic/employees/employee-editor.tsx` (L293 model datalist, L304-331 permission select)
- Modify: `src/renderer/lib/employee-model.ts:13-15`
- Modify: `packages/shared/src/i18n/locales/*/philharmonic.json` (`employees.permission.codex.*`, `agents.card.secretPlaceholder`)
- Test: `tests/unit/renderer/components/agent-card.test.ts` (extend), `tests/unit/renderer/lib/employee-model.test.ts` (extend)

**Interfaces:**

- Consumes: `AgentQuestion.id/isOther/isSecret`, `CliStatus.models` (Task 1), `CLI_NAMES`.
- Produces: `cliModelSuggestions(cli: CliId, status: CliStatus | undefined): string[]` in `employee-model.ts` (replaces `CLI_MODEL_SUGGESTIONS` — Claude Code keeps `['opus', 'sonnet', 'haiku']`; any CLI with `status.models` uses those); `answerKey(q: AgentQuestion): string` = `q.id ?? q.question`.

Rules:

- Question prompts key answers by `answerKey(q)` (Codex answers go back by question id; Claude Code's by text, as today).
- The free-text field shows only when `q.isOther !== false` and there are options, or always when a question has no options (Codex questions without options are free-form); `isSecret` questions use `<Input type="password" autoComplete="off">` with `agents.card.secretPlaceholder`, and their value is kept only in component state until sent (never in the card).
- The deny-reason field shows only for `card.runtime === 'claude-code'` (Codex can't carry a reason).
- The editor's permission select reads `employees.permission.codex.<mode>` labels and `employees.permission.codex.hint` when the draft's runtime is `codex`, and the existing keys otherwise. English texts: `default` "Ask before every command and file change", `acceptEdits` "Work freely inside the folder; ask to go beyond it", `auto` "Never ask; only inside the folder, no network", `hint` "Codex always works in a sandbox limited to the group's folder.". `agents.card.secretPlaceholder`: "Secret — sent to the agent, not saved". All 9 machine locales translated.
- The model datalist uses `cliModelSuggestions(draft.runtime as CliId, clis.find((c) => c.id === draft.runtime))` (no `as 'claude-code'` cast).

- [ ] **Step 1: Failing tests** — in `agent-card.test.ts` (renderToStaticMarkup with the real en `philharmonic.json`, as the existing tests do):
  - a Codex card's permission prompt renders no reason input (`placeholder` of `agents.card.reasonPlaceholder` absent) while a Claude Code card's does;
  - a Codex question `{ id: 'tok', question: 'Paste it', isSecret: true, isOther: false, options: [], multiSelect: false }` renders an `<input type="password"` and no option rows;
  - a Codex question with options and `isOther: false` renders no free-text field;
    and in `employee-model.test.ts`: `cliModelSuggestions('claude-code', undefined)` → `['opus','sonnet','haiku']`; `cliModelSuggestions('codex', { models: ['gpt-x'] } as never)` → `['gpt-x']`; `cliModelSuggestions('codex', undefined)` → `[]`.

- [ ] **Step 2: Run — expect FAIL**: `bunx vitest run tests/unit/renderer/components/agent-card.test.ts tests/unit/renderer/lib/employee-model.test.ts`

- [ ] **Step 3: Implement** per the rules above (follow the existing component structure; the answer map becomes `Object.fromEntries(prompt.questions.map((q) => [answerKey(q), …]))`; `complete` checks every `answerKey`). Add the i18n keys to en and all 9 locales.

- [ ] **Step 4: Run** the renderer + i18n suites, `bun run typecheck`, `bun run lint`, `bun run i18n:check` — all pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(philharmonic): Codex in the card and the editor — its questions answered by id, secrets as passwords that are never kept, no deny reason it can't carry, permission levels described as Codex behaves, model suggestions from Codex itself

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The full gate and the owner's checklist

**Files:**

- Modify: `docs/manual-qa-checklist.md` (append a "Codex employees" section)

- [ ] **Step 1: Full gate** — `bun run i18n:check && bun run typecheck && bun run lint && bun run test` (and `bun run fmt:check`, reporting only failures in files this branch touched). Fix failures caused by this phase; report pre-existing ones.

- [ ] **Step 2: Checklist** — append:

```markdown
## Codex employees — spec 2026-10-10

Needs codex-cli ≥ 0.162.1, logged in (`codex login status`).

- [ ] Settings › Agents shows Codex Ready with its path, version and "ChatGPT"; with Codex logged out, Check says Not logged in.
- [ ] Workforce: a Codex employee is offered once Codex is Ready (the default appears once; deleting it doesn't bring it back); the editor's permission levels read as Codex behaves; the model field suggests Codex's own models.
- [ ] In a group with a new project: "create index.html with a hello page" — the card shows the Edit with its full diff; Allow — the file lands; Done.
- [ ] Deny a file change: the step reports it was declined; no file written.
- [ ] A command (e.g. `npm init -y`) asks with the full command and folder; Allow runs it.
- [ ] Mode "Edit freely…": writes inside the folder don't ask; a network command (e.g. `curl`) asks to go beyond the sandbox, with what it asks for; Allow grants it for that turn only.
- [ ] Mode "Auto": nothing asks; a network command fails inside the sandbox.
- [ ] Stop during a long command: the card says Stopped; a follow-up step continues the same thread.
- [ ] Quit mid-step, reopen: the card is Stopped; the next step resumes the thread (Codex remembers).
- [ ] Continue in Terminal opens `codex resume <thread>` in the folder; the hand-off script deletes itself.
- [ ] A Claude Code and a Codex employee given parallel steps in one git repo: one shared folder, one worktree.
- [ ] If Codex asks a question with a secret, the field is a password field and the card doesn't show the value afterwards.
```

- [ ] **Step 3: Commit**

```bash
git add docs/manual-qa-checklist.md
git commit -m "docs(qa): the owner's checklist for Codex employees

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
