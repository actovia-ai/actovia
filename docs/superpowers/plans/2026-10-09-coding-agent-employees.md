# Coding-Agent Employees (Phase 1: Claude Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Philharmonic employee can be the owner's own Claude Code: the PM hands it a step, Actovia runs `claude` in the group's project folder over stream-json, draws a live card of its steps, stops for the owner's Allow / Deny / answers, and returns the result to the PM; every Actovia employee also runs on its own model.

**Architecture:** A main-process driver (`src/main/lib/agents/`) finds and checks the CLI, spawns one `claude -p` process per agent session, maps its NDJSON to `AgentEvent`s, folds them into an `AgentCard` that is streamed over the existing Philharmonic SSE (`agent_card` event) and persisted in the employee message's `parts`. `runDelegatedTask` branches on `agent.runtime`; projects (`~/Actovia Projects/<name>/.actovia/`) bind a group to a folder. The renderer gets Settings › Agents, a runtime/model picker in the employee editor, a folder chip in the group composer and the card.

**Tech Stack:** Electron main (Node 24, `child_process`, `readline`), drizzle on PGlite (migration 0015), Hono routes, zod (shared schemas), React + Tailwind v4 + react-i18next, Vitest (`tests/unit/**`), oxlint / oxfmt, bun.

**Spec:** `docs/superpowers/specs/2026-10-09-coding-agent-employees-design.md` (approved 2026-10-09). Read it before any task; this plan argues from it.

## Global Constraints

- Repo `actovia`, branch `maintenance`; commit locally after every task; **never push**. Other people's uncommitted edits may be in the tree (`globals.css`, `chat-header.tsx`, `chat-panel.tsx`, `app-sidebar.tsx`): `git add` only the files your task names — never `git add -A` / `.`.
- Commit messages: Conventional Commits, subject says what changed and why; end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The pre-commit hook runs oxlint, oxfmt, typecheck and `i18n:check` — it must pass; never `--no-verify`.
- No legacy / back-compat code: the app is unreleased (no shims for old rows or names).
- UI copy: the CLI is named **"Claude Code"** everywhere; tool names on the card are capital-case ("Write", "Bash"); `font-mono` only for code (a command or path in a card row is code — mono is fine there, nowhere else).
- Permission modes offered: `default`, `acceptEdits`, `auto`. **`bypassPermissions` is never passed or offered.**
- Actovia never answers a `control_request` by itself; no timeout auto-answers.
- Working folders: never `~`, `/`, or anything under `getActoviaHome()`; nothing of Actovia's is written into an opened folder.
- Child process environment = the owner's login-shell environment minus keys matching `/^(ACTOVIA_|ELECTRON_|VITE_)/` and `NODE_OPTIONS`; never Actovia's provider keys.
- Minimum Claude Code version: `2.1.294` (the probed one).
- Defaults: projects folder `~/Actovia Projects`; at most **2** agents running at once; keep an agent's process **10** minutes after its turn; worktrees **on**.
- The CLI's notices (rate limit, cost) are shown verbatim, never interpreted.
- New user-facing strings: add to `packages/shared/src/i18n/locales/en/<ns>.json` **and** every locale whose `_status.json` source is `machine` or `reviewed` (Task 16 does the bulk; each UI task adds its en keys).
- Tests: `bunx vitest run <file>`; full gates before each commit: `bun run typecheck && bun run lint && bun run i18n:check`.

## Review Focus

1. **The owner answers a prompt after the process already moved on** (interrupted, exited, or the other device answered first) — expect `409` from `/respond` and the card refreshed, never a write to a dead stdin. Test in Task 11.
2. **A CLI line split across stdout chunks, or a non-JSON line (a stray warning)** — expect it parsed whole, or skipped and logged, never a crash. Test in Task 6.
3. **The CLI dies mid-turn (killed, crashed, logged out)** — expect the step to fail with stderr's last lines, the card Failed, the task `failed`, and the next step resuming the session. Test in Task 6 and Task 10.
4. **Two steps for the same employee in the same project at once** — expect the second to wait for the first's turn, never two writes into one session. Test in Task 9.
5. **An opened folder that is `~`, `/`, inside `~/.actovia`, or a file** — expect a validation error before anything is created. Test in Task 8.

---

## File Structure

| File                                                                                                                             | Responsibility                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types/agents.ts` (new)                                                                                      | Runtimes, CLI status, permission modes, `AgentCard`, prompts and answers — shared by main and renderer      |
| `packages/shared/src/types/philharmonic.ts`                                                                                      | + `agent_card` SSE event                                                                                    |
| `packages/shared/src/schemas/settings-schema.ts`                                                                                 | + `AgentsSettingsSchema`, `agents` in `SettingsSchema`                                                      |
| `src/main/lib/db/schema.ts`, `resources/drizzle/0015_coding_agents.sql`                                                          | `agent.runtime` / `permissionMode`, `project`, `conversation.projectId`, `agent_session`, `settings.agents` |
| `src/main/lib/db/project-queries.ts`, `agent-session-queries.ts` (new)                                                           | Row access for projects and agent sessions                                                                  |
| `src/main/lib/ai/utils/model-util.ts`                                                                                            | + `resolveEmployeeModel` (an employee's own provider/model)                                                 |
| `src/main/lib/agents/settings.ts` (new)                                                                                          | Defaults applied to `settings.agents`                                                                       |
| `src/main/lib/agents/login-shell.ts` (new)                                                                                       | The owner's login-shell environment, scrubbed, cached                                                       |
| `src/main/lib/agents/cli-check.ts` (new)                                                                                         | Found · runs · version · logged in                                                                          |
| `src/main/lib/agents/claude-code/protocol.ts` (new)                                                                              | NDJSON line → `AgentEvent[]` (pure)                                                                         |
| `src/main/lib/agents/claude-code/run.ts` (new)                                                                                   | One `claude` process: spawn, read, write, interrupt, raw log                                                |
| `src/main/lib/agents/card.ts` (new)                                                                                              | `AgentEvent` → `AgentCard` reducer (pure)                                                                   |
| `src/main/lib/agents/projects.ts` (new)                                                                                          | Create / open projects, meta files, alias, worktrees                                                        |
| `src/main/lib/agents/registry.ts` (new)                                                                                          | Live runs, running limit, per-session queue, keep-alive, quit                                               |
| `src/main/lib/agents/run-agent-employee.ts` (new)                                                                                | A delegated step run by a CLI employee                                                                      |
| `src/main/lib/ai/philharmonic/{execution-engine,pm-coordinator,plan-mirror}.ts`                                                  | The runtime branch, parts persisted, plan in the project                                                    |
| `src/main/lib/server/routes/{agents,projects}.ts` (new), `app.ts`                                                                | HTTP surface                                                                                                |
| `src/main/main.ts`                                                                                                               | Quit: stop agents                                                                                           |
| `src/renderer/services/agents.ts` (new)                                                                                          | Client calls                                                                                                |
| `src/renderer/components/settings/settings-form/agents.tsx` (new) + menu/form registration                                       | Settings › Agents                                                                                           |
| `src/renderer/components/philharmonic/employees/employee-editor.tsx`                                                             | Runtime, model, permission mode                                                                             |
| `src/renderer/components/philharmonic/chat/folder-chip.tsx` (new), `composer.tsx`                                                | The folder chip                                                                                             |
| `src/renderer/components/philharmonic/chat/agent-card.tsx` (new), `group-message-bubble.tsx`, `hooks/use-conversation-stream.ts` | The card, live and from history                                                                             |
| `tests/fixtures/claude-code/*.jsonl` (exists), `fake-claude.mjs` (new)                                                           | Real CLI output from the 2026-10-09 probes, and a fake CLI that replays it                                  |

The fixtures already in the repo (`tests/fixtures/claude-code/`) are the real CLI's stdout from the probes, sanitised (paths → `/tmp/actovia-project`, hooks trimmed to one, init slimmed). Only stdout is recorded; what Actovia writes is the tests' own.

### Task 1: Shared types, the `agents` settings block, the `agent_card` event

**Files:**

- Create: `packages/shared/src/types/agents.ts`
- Modify: `packages/shared/src/types/philharmonic.ts` (the `PhilharmonicSseEvent` union, line ~32)
- Modify: `packages/shared/src/schemas/settings-schema.ts` (new schema near `ComputerUseSchema` ~l.152; `SettingsSchema` ~l.277)
- Test: `tests/unit/shared/agents-settings-schema.test.ts`

**Interfaces:**

- Produces: every type below, imported as `@actovia/shared/types/agents`; `AgentsSettingsSchema`, `AgentsSettings` from `@actovia/shared/schemas/settings-schema`; SSE member `{ type: 'agent_card'; conversationId: string; messageId: string; card: AgentCard }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/shared/agents-settings-schema.test.ts
import {
  AgentsSettingsSchema,
  SettingsSchema
} from '@actovia/shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

describe('agents settings schema', () => {
  it('parses an empty block to its defaults', () => {
    expect(AgentsSettingsSchema.parse({})).toEqual({
      worktrees: true,
      cliPaths: {}
    })
  })

  it('rejects a running limit outside 1–8 and a keep-alive outside 0–120', () => {
    expect(() => AgentsSettingsSchema.parse({ maxRunning: 0 })).toThrow()
    expect(() => AgentsSettingsSchema.parse({ maxRunning: 9 })).toThrow()
    expect(() =>
      AgentsSettingsSchema.parse({ keepAliveMinutes: 121 })
    ).toThrow()
  })

  it('is part of SettingsSchema', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'global',
        agents: {
          maxRunning: 3,
          cliPaths: { 'claude-code': '/opt/bin/claude' }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`AgentsSettingsSchema` is not exported)

Run: `bunx vitest run tests/unit/shared/agents-settings-schema.test.ts`

- [ ] **Step 3: Add the settings schema**

In `settings-schema.ts`, after `ComputerUseSchema` (uses the file's existing `formNumber`):

```ts
/**
 * Coding-agent employees (spec 2026-10-09). Unset numbers take their
 * defaults where they are used (`src/main/lib/agents/settings.ts`): the
 * projects folder `~/Actovia Projects`, 2 running at once, 10 minutes kept.
 */
export const AgentsSettingsSchema = z.object({
  projectsDir: z.string().nullish(),
  maxRunning: formNumber(z.number().int().gte(1).lte(8)).nullish(),
  keepAliveMinutes: formNumber(z.number().int().gte(0).lte(120)).nullish(),
  worktrees: z.boolean().default(true),
  /** A path the owner set by hand, per CLI id; empty = look it up. */
  cliPaths: z.record(z.string(), z.string()).default({})
})
export type AgentsSettings = z.infer<typeof AgentsSettingsSchema>
```

In `SettingsSchema`, beside `computerUse`: `agents: AgentsSettingsSchema.nullish(),`

- [ ] **Step 4: Create the shared types**

```ts
// packages/shared/src/types/agents.ts
/** Who runs an employee's turn: Actovia's own loop, or a CLI on the owner's machine. */
export const AGENT_RUNTIMES = ['actovia', 'claude-code'] as const
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]

/** The CLIs Actovia can drive. Codex joins in phase 2. */
export const CLI_IDS = ['claude-code'] as const
export type CliId = (typeof CLI_IDS)[number]

export const CLI_NAMES: Record<CliId, string> = { 'claude-code': 'Claude Code' }

/** Offered permission modes; `bypassPermissions` is deliberately absent. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export type CliState =
  | 'ready'
  | 'not_installed'
  | 'broken'
  | 'too_old'
  | 'logged_out'

export interface CliStatus {
  id: CliId
  state: CliState
  path: string | null
  version: string | null
  /** As the CLI reports it, e.g. `claude.ai`. */
  authMethod: string | null
  /** The CLI's own words when not ready (an error, stderr's tail). */
  detail: string | null
  checkedAt: number
}

export type AgentCardState =
  | 'working'
  | 'blocked'
  | 'done'
  | 'stopped'
  | 'error'

export interface AgentCardStep {
  /** The CLI's tool_use id. */
  id: string
  /** As the CLI names it: `Write`, `Bash`. */
  tool: string
  /** One line: the path, the command, the pattern. */
  summary: string
  status: 'running' | 'ok' | 'error'
}

export interface AgentQuestion {
  question: string
  header?: string
  multiSelect: boolean
  options: Array<{ label: string; description?: string }>
}

export type AgentPrompt =
  | { kind: 'permission'; requestId: string; tool: string; summary: string }
  | { kind: 'question'; requestId: string; questions: AgentQuestion[] }

export type AgentAnswer =
  | { kind: 'allow' }
  | { kind: 'deny'; reason?: string }
  | { kind: 'answers'; answers: Record<string, string> }

/** What an employee message shows for a CLI run; also its persisted `parts[0]`. */
export interface AgentCard {
  kind: 'agent_card'
  sessionId: string
  agentId: string
  runtime: CliId
  model: string | null
  projectName: string
  cwd: string
  branch: string | null
  state: AgentCardState
  steps: AgentCardStep[]
  /** Finished text blocks of the run, in order. */
  blocks: string[]
  /** The text block being written now. */
  pending: string
  prompts: AgentPrompt[]
  /** The CLI's notices, verbatim (rate limit, cost). */
  notices: string[]
  /** Sum of the turns' `total_cost_usd`, as reported. */
  costUsd: number | null
  /** Tools the owner denied in this run. */
  denials: number
  error: string | null
  continuedInTerminal: boolean
  /** Waiting for a free slot (the running limit, spec §3). */
  queued: boolean
}
```

- [ ] **Step 5: Add the SSE member** — in `PhilharmonicSseEvent` (philharmonic.ts), after the `tool_card` member:

```ts
  | {
      type: 'agent_card'
      conversationId: string
      messageId: string
      card: import('./agents').AgentCard
    }
```

(Prefer a top-level `import type { AgentCard } from './agents'` and `card: AgentCard` if the file already has type imports.)

- [ ] **Step 6: Run the test — expect PASS**, then `bun run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/agents.ts packages/shared/src/types/philharmonic.ts packages/shared/src/schemas/settings-schema.ts tests/unit/shared/agents-settings-schema.test.ts
git commit -m "feat(agents): shared types for coding-agent employees, the agents settings block and the agent_card event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database — runtime, projects, agent sessions (migration 0015)

**Files:**

- Modify: `src/main/lib/db/schema.ts` (`agent` l.297-313, `conversation` l.347-360, `settings` ~l.187; new tables after `conversationMessage`)
- Create: `resources/drizzle/0015_coding_agents.sql` (generated) and its journal/snapshot entries (generated)
- Create: `src/main/lib/db/project-queries.ts`, `src/main/lib/db/agent-session-queries.ts`
- Modify: `src/main/lib/db/conversation-queries.ts` (+ `updateConversationMessageParts`)
- Test: `tests/unit/main/lib/db/migrations/0015-coding-agents.test.ts`

**Interfaces:**

- Consumes: `AgentsSettings` (Task 1).
- Produces: tables `project`, `agentSession`; types `Project`, `AgentSession`; columns `agent.runtime` (`'actovia' | 'claude-code'`, default `'actovia'`), `agent.permissionMode` (text, null = `default`), `conversation.projectId`, `settings.agents`. Queries:
  - `createProject(data: { name: string; dir: string; workDir: string }): Promise<Project>`
  - `getProjectById(id: string): Promise<Project | undefined>`
  - `getProjectByDir(dir: string): Promise<Project | undefined>`
  - `listRecentProjects(limit = 8): Promise<Project[]>` (by `lastUsedAt` desc)
  - `updateProject(id: string, data: Partial<typeof project.$inferInsert>): Promise<Project>`
  - `createAgentSession(data: typeof agentSession.$inferInsert): Promise<AgentSession>`
  - `updateAgentSession(id: string, data: Partial<typeof agentSession.$inferInsert>): Promise<AgentSession>`
  - `getAgentSession(id: string): Promise<AgentSession | undefined>`
  - `findResumableSession(projectId: string, agentId: string): Promise<AgentSession | undefined>` — latest by `createdAt` with `cliSessionId` not null
  - `markLiveSessionsStopped(): Promise<void>` — `working`/`blocked` → `stopped`
  - `updateConversationMessageParts(id: string, parts: Record<string, unknown>[]): Promise<void>`

The CLI model lives in the existing `agent.model` (with `provider` null for a CLI employee) — no separate column.

- [ ] **Step 1: Edit the schema**

In `agent`, after `provider`:

```ts
    runtime: agentRuntimeEnum('runtime').notNull().default('actovia'),
    /** A CLI employee's permission mode; null = the CLI's `default`. */
    permissionMode: text('permissionMode'),
```

Above `agent`:

```ts
export const agentRuntimeEnum = pgEnum('agent_runtime', [
  'actovia',
  'claude-code'
])
```

New table, defined **before** `conversation` (so the reference reads top-down):

```ts
/** A folder Philharmonic works in (spec §4): `dir` holds `.actovia/` meta; `workDir` is where agents work — `dir` for a new project, the owner's folder for an opened one. */
export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  dir: text('dir').notNull().unique(),
  workDir: text('workDir').notNull(),
  useWorktrees: boolean('useWorktrees').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull()
})
export type Project = InferSelectModel<typeof project>
```

In `conversation`: `projectId: uuid('projectId').references(() => project.id, { onDelete: 'set null' }),`

After `conversationMessage`:

```ts
export const agentSessionStateEnum = pgEnum('agent_session_state', [
  'working',
  'blocked',
  'done',
  'stopped',
  'error'
])

/** One CLI session of one employee in one project (spec §8). */
export const agentSession = pgTable(
  'agent_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    agentId: uuid('agentId').references(() => agent.id, {
      onDelete: 'set null'
    }),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    runtime: text('runtime').notNull(),
    cliSessionId: text('cliSessionId'),
    cwd: text('cwd').notNull(),
    branch: text('branch'),
    state: agentSessionStateEnum('state').notNull().default('working'),
    /** The employee message whose card this session draws (latest step). */
    messageId: uuid('messageId'),
    continuedInTerminal: boolean('continuedInTerminal')
      .notNull()
      .default(false),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull()
  },
  (table) => [
    index('agent_session_project_agent_idx').on(table.projectId, table.agentId)
  ]
)
export type AgentSession = InferSelectModel<typeof agentSession>
```

In `settings`, beside `computerUse`: `agents: jsonb('agents').$type<z.infer<typeof AgentsSettingsSchema>>(),` (import `AgentsSettingsSchema` with the other settings-schema imports at the top of the file).

- [ ] **Step 2: Generate the migration**

Run: `bunx drizzle-kit generate --name coding_agents`
Expected: `resources/drizzle/0015_coding_agents.sql` plus updated `meta/_journal.json` and `meta/0015_snapshot.json`. Read the SQL: it must create the two enums, the two tables, the index, and `ALTER TABLE` for `agent` (2 columns), `conversation` (1 + FK), `settings` (1). Nothing else (no drops).

- [ ] **Step 3: Write the migration test**

```ts
// tests/unit/main/lib/db/migrations/0015-coding-agents.test.ts
import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0015 — coding agents', () => {
  it('adds runtime to agents with actovia as the default', async () => {
    const pg = await createMigratedPglite('0015')
    await pg.exec(`INSERT INTO agent (name) VALUES ('Ada')`)
    const { rows } = await pg.query<{
      runtime: string
      permissionMode: string | null
    }>(`SELECT runtime, "permissionMode" FROM agent`)
    expect(rows).toEqual([{ runtime: 'actovia', permissionMode: null }])
    await pg.close()
  })

  it('links a conversation to a project and a session to both', async () => {
    const pg = await createMigratedPglite('0015')
    const p = await pg.query<{ id: string }>(
      `INSERT INTO project (name, dir, "workDir") VALUES ('notes', '/p/notes', '/p/notes') RETURNING id`
    )
    const c = await pg.query<{ id: string }>(
      `INSERT INTO conversation (title, "projectId") VALUES ('g', $1) RETURNING id`,
      [p.rows[0].id]
    )
    await pg.query(
      `INSERT INTO agent_session ("projectId", "conversationId", runtime, cwd) VALUES ($1, $2, 'claude-code', '/p/notes')`,
      [p.rows[0].id, c.rows[0].id]
    )
    const s = await pg.query<{ state: string }>(
      `SELECT state FROM agent_session`
    )
    expect(s.rows[0].state).toBe('working')
    await pg.exec(`DELETE FROM project`)
    const after = await pg.query(`SELECT 1 FROM agent_session`)
    expect(after.rows).toHaveLength(0) // cascade
    const conv = await pg.query<{ projectId: string | null }>(
      `SELECT "projectId" FROM conversation`
    )
    expect(conv.rows[0].projectId).toBeNull() // set null
    await pg.close()
  })

  it('refuses two projects with the same dir', async () => {
    const pg = await createMigratedPglite('0015')
    await pg.exec(
      `INSERT INTO project (name, dir, "workDir") VALUES ('a', '/p/a', '/p/a')`
    )
    await expect(
      pg.exec(
        `INSERT INTO project (name, dir, "workDir") VALUES ('b', '/p/a', '/x')`
      )
    ).rejects.toThrow()
    await pg.close()
  })
})
```

- [ ] **Step 4: Run it — expect PASS** (if it fails, the generated SQL is wrong; fix the schema and regenerate — delete the bad 0015 files and the journal entry first).

Run: `bunx vitest run tests/unit/main/lib/db/migrations/0015-coding-agents.test.ts`

- [ ] **Step 5: Write the query helpers** (pattern of `conversation-queries.ts`: `import { db } from './db'`, drizzle `eq/desc/and/isNotNull/inArray`)

```ts
// src/main/lib/db/project-queries.ts
import { desc, eq } from 'drizzle-orm'

import { db } from './db'
import { project, type Project } from './schema'

export async function createProject(data: {
  name: string
  dir: string
  workDir: string
}): Promise<Project> {
  const [row] = await db.insert(project).values(data).returning()
  return row
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const [row] = await db.select().from(project).where(eq(project.id, id))
  return row
}

export async function getProjectByDir(
  dir: string
): Promise<Project | undefined> {
  const [row] = await db.select().from(project).where(eq(project.dir, dir))
  return row
}

export async function listRecentProjects(limit = 8): Promise<Project[]> {
  return db
    .select()
    .from(project)
    .orderBy(desc(project.lastUsedAt))
    .limit(limit)
}

export async function updateProject(
  id: string,
  data: Partial<typeof project.$inferInsert>
): Promise<Project> {
  const [row] = await db
    .update(project)
    .set(data)
    .where(eq(project.id, id))
    .returning()
  return row
}
```

```ts
// src/main/lib/db/agent-session-queries.ts
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'

import { db } from './db'
import { agentSession, type AgentSession } from './schema'

export async function createAgentSession(
  data: typeof agentSession.$inferInsert
): Promise<AgentSession> {
  const [row] = await db.insert(agentSession).values(data).returning()
  return row
}

export async function updateAgentSession(
  id: string,
  data: Partial<typeof agentSession.$inferInsert>
): Promise<AgentSession> {
  const [row] = await db
    .update(agentSession)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentSession.id, id))
    .returning()
  return row
}

export async function getAgentSession(
  id: string
): Promise<AgentSession | undefined> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, id))
  return row
}

/** The session a new step for this employee in this project continues. */
export async function findResumableSession(
  projectId: string,
  agentId: string
): Promise<AgentSession | undefined> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.projectId, projectId),
        eq(agentSession.agentId, agentId),
        isNotNull(agentSession.cliSessionId)
      )
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(1)
  return row
}

/** At start and at quit: nothing is running any more. */
export async function markLiveSessionsStopped(): Promise<void> {
  await db
    .update(agentSession)
    .set({ state: 'stopped', updatedAt: new Date() })
    .where(inArray(agentSession.state, ['working', 'blocked']))
}
```

In `conversation-queries.ts`:

```ts
export async function updateConversationMessageParts(
  id: string,
  parts: Record<string, unknown>[]
): Promise<void> {
  await db
    .update(conversationMessage)
    .set({ parts })
    .where(eq(conversationMessage.id, id))
}
```

- [ ] **Step 6: Typecheck, run the migration test again, commit**

```bash
bun run typecheck && bunx vitest run tests/unit/main/lib/db
git add src/main/lib/db/schema.ts resources/drizzle/0015_coding_agents.sql resources/drizzle/meta src/main/lib/db/project-queries.ts src/main/lib/db/agent-session-queries.ts src/main/lib/db/conversation-queries.ts tests/unit/main/lib/db/migrations/0015-coding-agents.test.ts
git commit -m "feat(db): employees get a runtime and a permission mode; projects, a group's project, and agent sessions (migration 0015)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Every employee runs on its own model (spec §8.1)

**Files:**

- Create: `src/main/lib/ai/utils/employee-model.ts`
- Modify: `src/main/lib/ai/philharmonic/employee-loop.ts:66-67`
- Test: `tests/unit/main/lib/ai/utils/resolve-employee-model.test.ts`

**Interfaces:**

- Consumes: `getModelFromProvider(setting: Settings): { model: Model<string>; apiKey: string }` (existing, l.40), `Agent` (schema).
- Produces: `resolveEmployeeModel(agent: Pick<Agent, 'provider' | 'model'>, setting: Settings): { model: Model<string>; apiKey: string }` — throws `ConfigurationError` with the employee's provider in the message when that provider has no key or the model id is unknown.

`getModelFromProvider` reads `setting.providerConfig.provider` / `.model` and the key for that provider; an employee's choice is the same lookup on a copy whose `providerConfig` is the employee's. `modelSnapshot` is dropped on the copy (it describes the global model).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/ai/utils/resolve-employee-model.test.ts
import { describe, expect, it, vi } from 'vitest'

const getModelFromProvider = vi.fn(
  (s: { providerConfig: { provider: string; model: string } }) => {
    if (s.providerConfig.provider === 'nokey')
      throw new Error('CONFIG_MISSING_API_KEY')
    return {
      model: {
        id: s.providerConfig.model,
        provider: s.providerConfig.provider
      },
      apiKey: 'k'
    }
  }
)
vi.mock('@main/lib/ai/utils/model-util', () => ({ getModelFromProvider }))
const { resolveEmployeeModel } =
  await import('@main/lib/ai/utils/employee-model')

const setting = {
  id: 'global',
  providerConfig: {
    provider: 'anthropic',
    model: 'global-model',
    modelSnapshot: { x: 1 }
  }
} as never

describe('resolveEmployeeModel', () => {
  it('uses the global model when the employee has none', () => {
    const r = resolveEmployeeModel({ provider: null, model: null }, setting)
    expect(r.model).toMatchObject({ id: 'global-model' })
  })

  it("uses the employee's provider and model", () => {
    const r = resolveEmployeeModel(
      { provider: 'openai', model: 'gpt-x' },
      setting
    )
    expect(r.model).toMatchObject({ id: 'gpt-x', provider: 'openai' })
    const passed = getModelFromProvider.mock.calls.at(-1)![0] as {
      providerConfig: Record<string, unknown>
    }
    expect(passed.providerConfig).toEqual({
      provider: 'openai',
      model: 'gpt-x'
    })
  })

  it("fails with the employee's provider named, never falling back", () => {
    expect(() =>
      resolveEmployeeModel({ provider: 'nokey', model: 'm' }, setting)
    ).toThrow(/nokey/)
  })
})
```

`resolveEmployeeModel` lives in its own file (`employee-model.ts`) so the test can mock `model-util` wholesale.

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `bunx vitest run tests/unit/main/lib/ai/utils/resolve-employee-model.test.ts`

- [ ] **Step 3: Implement**

```ts
import { ConfigurationError, ErrorCode } from '@actovia/shared'
// src/main/lib/ai/utils/employee-model.ts
import type { Model } from '@earendil-works/pi-ai'

import type { Agent, Settings } from '../../db/schema'
import { getModelFromProvider } from './model-util'

/**
 * The model an Actovia employee runs on: its own provider + model when set,
 * else the app's (spec §8.1). Its own choice never falls back silently — a
 * provider without a key, or a model gone, fails the step with the reason.
 */
export function resolveEmployeeModel(
  agent: Pick<Agent, 'provider' | 'model'>,
  setting: Settings
): { model: Model<string>; apiKey: string } {
  if (!agent.provider || !agent.model) return getModelFromProvider(setting)
  try {
    return getModelFromProvider({
      ...setting,
      providerConfig: { provider: agent.provider, model: agent.model }
    } as Settings)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ConfigurationError(
      ErrorCode.CONFIG_MISSING_PROVIDER,
      `This employee's model (${agent.provider} · ${agent.model}) is unavailable: ${reason}`
    )
  }
}
```

(Check `ConfigurationError`'s constructor in `@actovia/shared` — `model-util.ts:56` and `:65` show `(code)` and `(code, message?, meta?)`; pass the message second.)

- [ ] **Step 4: Use it in the employee loop** — `employee-loop.ts:66-67` becomes:

```ts
const setting = await getSettings()
const { model, apiKey } = resolveEmployeeModel(agent, setting)
```

with `import { resolveEmployeeModel } from '../utils/employee-model'` (drop the now-unused `getModelFromProvider` import if nothing else in the file uses it).

- [ ] **Step 5: Run the new test and the employee-loop tests — expect PASS**

Run: `bunx vitest run tests/unit/main/lib/ai/utils/resolve-employee-model.test.ts tests/unit/main/lib/ai/philharmonic/employee-loop.test.ts`
If `employee-loop.test.ts` mocks `model-util`, extend its mock or add `vi.mock('@main/lib/ai/utils/employee-model', () => ({ resolveEmployeeModel: () => ({ model: {...}, apiKey: 'k' }) }))` with the same fake model it already uses.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/ai/utils/employee-model.ts src/main/lib/ai/philharmonic/employee-loop.ts tests/unit/main/lib/ai/utils/resolve-employee-model.test.ts tests/unit/main/lib/ai/philharmonic/employee-loop.test.ts
git commit -m "fix(philharmonic): an employee runs on its own provider and model when it has one — the columns were stored and never read; its own choice fails loudly instead of falling back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Agent settings defaults, the login-shell environment, the CLI check

**Files:**

- Create: `src/main/lib/agents/settings.ts`, `src/main/lib/agents/login-shell.ts`, `src/main/lib/agents/cli-check.ts`
- Test: `tests/unit/main/lib/agents/login-shell.test.ts`, `tests/unit/main/lib/agents/cli-check.test.ts`

**Interfaces:**

- Consumes: `getSettings()` (`@main/lib/db/queries`), `CliId`, `CliStatus` (Task 1).
- Produces:
  - `agentSettings(): Promise<{ projectsDir: string; maxRunning: number; keepAliveMinutes: number; worktrees: boolean; cliPaths: Record<string, string> }>`
  - `parseEnvDump(out: string): Record<string, string>`, `scrubEnv(env: Record<string, string | undefined>): Record<string, string>`, `loginShellEnv(): Promise<Record<string, string>>`, `resetLoginShellEnv(): void`
  - `MIN_VERSION: Record<CliId, string>`, `CLI_BINARY: Record<CliId, string>`, `compareVersions(a: string, b: string): number`, `findOnPath(name: string, path: string): Promise<string | null>`, `checkCli(id: CliId, deps?: CheckDeps): Promise<CliStatus>`, `getCliStatus(id: CliId, opts?: { refresh?: boolean }): Promise<CliStatus>`
  - `interface CheckDeps { env(): Promise<Record<string, string>>; overridePath(id: CliId): Promise<string | null>; exec(file: string, args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> }`

- [ ] **Step 1: Write the failing tests**

```ts
import { parseEnvDump, scrubEnv } from '@main/lib/agents/login-shell'
// tests/unit/main/lib/agents/login-shell.test.ts
import { describe, expect, it } from 'vitest'

describe('login shell environment', () => {
  it('reads the NUL-separated dump between the markers, ignoring rc-file noise', () => {
    const out =
      'Welcome to zsh\n__ACTOVIA_ENV__PATH=/opt/homebrew/bin:/usr/bin\0HOME=/Users/o\0A=b=c\0__ACTOVIA_ENV__\nbye'
    expect(parseEnvDump(out)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      HOME: '/Users/o',
      A: 'b=c'
    })
  })

  it('returns nothing when the markers are missing', () => {
    expect(parseEnvDump('no markers here')).toEqual({})
  })

  it("drops Actovia's, Electron's and Vite's variables and NODE_OPTIONS, keeps the owner's own", () => {
    expect(
      scrubEnv({
        PATH: '/bin',
        ACTOVIA_HOME: '/x',
        ELECTRON_RUN_AS_NODE: '1',
        VITE_DEV_SERVER_URL: 'http://localhost',
        NODE_OPTIONS: '--inspect',
        ANTHROPIC_API_KEY: 'owner-set-this',
        EMPTY: undefined
      })
    ).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'owner-set-this' })
  })
})
```

```ts
// tests/unit/main/lib/agents/cli-check.test.ts
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  checkCli,
  compareVersions,
  findOnPath,
  type CheckDeps
} from '@main/lib/agents/cli-check'
import { describe, expect, it } from 'vitest'

function fakeBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'))
  const file = join(dir, 'claude')
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  return dir
}

const GOOD = `case "$1" in
  --version) echo "2.1.295 (Claude Code)";;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty"}';;
esac`

function deps(dir: string, override: string | null = null): CheckDeps {
  const real = {
    env: async () => ({ PATH: `${dir}:/usr/bin:/bin` }),
    overridePath: async () => override
  }
  return {
    ...real,
    exec: async (file, args, env) => {
      const { execFile } = await import('child_process')
      return new Promise((resolve) => {
        execFile(file, args, { env, timeout: 5000 }, (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
          resolve({
            code,
            stdout: String(stdout),
            stderr: String(stderr) || (err && !stdout ? err.message : '')
          })
        })
      })
    }
  }
}

describe('CLI check', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('2.1.294', '2.1.294')).toBe(0)
    expect(compareVersions('2.1.300', '2.1.294')).toBeGreaterThan(0)
    expect(compareVersions('2.0.999', '2.1.0')).toBeLessThan(0)
  })

  it('finds an executable on the PATH it is given, not the process PATH', async () => {
    const dir = fakeBin(GOOD)
    expect(await findOnPath('claude', `/nope:${dir}`)).toBe(join(dir, 'claude'))
    expect(await findOnPath('claude', '/nope')).toBeNull()
  })

  it('is ready when found, running, new enough and logged in', async () => {
    const dir = fakeBin(GOOD)
    const s = await checkCli('claude-code', deps(dir))
    expect(s).toMatchObject({
      state: 'ready',
      version: '2.1.295',
      authMethod: 'claude.ai',
      path: join(dir, 'claude')
    })
  })

  it('is not installed when nothing is found', async () => {
    const s = await checkCli('claude-code', deps('/nonexistent-dir'))
    expect(s).toMatchObject({ state: 'not_installed', path: null })
  })

  it('is broken when the launcher is there but its binary is gone (the machine’s Codex, 2026-10-09)', async () => {
    const dir = fakeBin('exec /nonexistent/vendor/claude "$@"')
    const s = await checkCli('claude-code', deps(dir))
    expect(s.state).toBe('broken')
    expect(s.detail).toMatch(/nonexistent/)
  })

  it('is too old below the tested minimum', async () => {
    const dir = fakeBin('echo "2.0.1 (Claude Code)"')
    const s = await checkCli('claude-code', deps(dir))
    expect(s).toMatchObject({ state: 'too_old', version: '2.0.1' })
  })

  it('is logged out when auth status says so', async () => {
    const dir = fakeBin(
      `case "$1" in --version) echo "2.1.294";; auth) echo '{"loggedIn": false}'; exit 1;; esac`
    )
    const s = await checkCli('claude-code', deps(dir))
    expect(s.state).toBe('logged_out')
  })

  it("uses the owner's path when set, even off the PATH", async () => {
    const dir = fakeBin(GOOD)
    const s = await checkCli(
      'claude-code',
      deps('/nonexistent-dir', join(dir, 'claude'))
    )
    expect(s.state).toBe('ready')
  })
})
```

- [ ] **Step 2: Run both — expect FAIL** (modules not found)

Run: `bunx vitest run tests/unit/main/lib/agents/login-shell.test.ts tests/unit/main/lib/agents/cli-check.test.ts`

- [ ] **Step 3: Implement `settings.ts`**

```ts
// src/main/lib/agents/settings.ts
import { homedir } from 'os'
import { join } from 'path'

import { getSettings } from '../db/queries'

/** `settings.agents` with the spec's defaults applied (spec §3). */
export async function agentSettings() {
  const a = (await getSettings()).agents
  return {
    projectsDir: a?.projectsDir || join(homedir(), 'Actovia Projects'),
    maxRunning: a?.maxRunning ?? 2,
    keepAliveMinutes: a?.keepAliveMinutes ?? 10,
    worktrees: a?.worktrees ?? true,
    cliPaths: a?.cliPaths ?? {}
  }
}
```

(`getSettings()`'s return type may be a union with an uninitialised shape — if `agents` is not on it, narrow with `'agents' in s ? s.agents : null`, as `getModelFromProvider` does with `'id' in setting`.)

- [ ] **Step 4: Implement `login-shell.ts`**

```ts
// src/main/lib/agents/login-shell.ts
import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

import { logger } from '../logger'

const MARK = '__ACTOVIA_ENV__'
const DROP = /^(ACTOVIA_|ELECTRON_|VITE_)/
/** Where CLIs install when the login shell cannot tell us (spec §3). */
const FALLBACK_DIRS = [
  join(homedir(), '.local/bin'),
  join(homedir(), '.claude/local'),
  '/opt/homebrew/bin',
  '/usr/local/bin'
]

export function parseEnvDump(out: string): Record<string, string> {
  const start = out.indexOf(MARK)
  const end = out.lastIndexOf(MARK)
  if (start < 0 || end <= start) return {}
  const env: Record<string, string> = {}
  for (const entry of out.slice(start + MARK.length, end).split('\0')) {
    const i = entry.indexOf('=')
    if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return env
}

/** The child never sees Actovia's own variables (spec §7.4). */
export function scrubEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || DROP.test(key) || key === 'NODE_OPTIONS')
      continue
    out[key] = value
  }
  return out
}

let cached: Promise<Record<string, string>> | null = null

/**
 * The owner's login-shell environment, once per app run: an app opened from
 * Finder has launchd's PATH and would not find `~/.local/bin`, Homebrew or
 * nvm. `-i` too, since nvm and friends hook in from `.zshrc`.
 */
export function loginShellEnv(): Promise<Record<string, string>> {
  cached ??= new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(
      shell,
      ['-lic', `printf '${MARK}'; env -0; printf '${MARK}'`],
      {
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          HOME: homedir(),
          USER: process.env.USER ?? '',
          SHELL: shell,
          TERM: 'dumb'
        }
      },
      (err, stdout) => {
        const env = parseEnvDump(String(stdout ?? ''))
        if (env.PATH) return resolve(scrubEnv(env))
        logger.warn('agents: login shell gave no PATH; using fallbacks', {
          err: err?.message
        })
        resolve(
          scrubEnv({
            ...process.env,
            PATH: [process.env.PATH, ...FALLBACK_DIRS].filter(Boolean).join(':')
          })
        )
      }
    )
  })
  return cached
}

/** Settings' Check button: read the shell again (the owner may have just installed). */
export function resetLoginShellEnv(): void {
  cached = null
}
```

(Match `logger`'s real API in `src/main/lib/logger` — use whatever `warn` signature the other main files use.)

- [ ] **Step 5: Implement `cli-check.ts`**

```ts
// src/main/lib/agents/cli-check.ts
import { execFile } from 'child_process'
import { access, constants } from 'fs/promises'
import { join } from 'path'

import type { CliId, CliStatus } from '@actovia/shared/types/agents'

import { loginShellEnv } from './login-shell'
import { agentSettings } from './settings'

export const CLI_BINARY: Record<CliId, string> = { 'claude-code': 'claude' }
/** The version the driver was verified against (probes, 2026-10-09). */
export const MIN_VERSION: Record<CliId, string> = { 'claude-code': '2.1.294' }

export interface CheckDeps {
  env(): Promise<Record<string, string>>
  overridePath(id: CliId): Promise<string | null>
  exec(
    file: string,
    args: string[],
    env: Record<string, string>
  ): Promise<{ code: number; stdout: string; stderr: string }>
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export async function findOnPath(
  name: string,
  path: string
): Promise<string | null> {
  for (const dir of path.split(':').filter(Boolean)) {
    const file = join(dir, name)
    try {
      await access(file, constants.X_OK)
      return file
    } catch {
      // not here
    }
  }
  return null
}

const tail = (s: string, n = 600) =>
  (s.length > n ? '…' + s.slice(-n) : s).trim()

const defaultDeps: CheckDeps = {
  env: loginShellEnv,
  overridePath: async (id) => (await agentSettings()).cliPaths[id] || null,
  exec: (file, args, env) =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { env, timeout: 15_000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? '') || (err && !stdout ? err.message : '')
          })
        }
      )
    })
}

/** Found · runs · new enough · logged in (spec §3). Spends no quota. */
export async function checkCli(
  id: CliId,
  deps: CheckDeps = defaultDeps
): Promise<CliStatus> {
  const base = {
    id,
    path: null,
    version: null,
    authMethod: null,
    detail: null,
    checkedAt: Date.now()
  }
  const env = await deps.env()
  const path =
    (await deps.overridePath(id)) ??
    (await findOnPath(CLI_BINARY[id], env.PATH ?? ''))
  if (!path) return { ...base, state: 'not_installed' }

  const v = await deps.exec(path, ['--version'], env)
  const version =
    v.code === 0 ? (v.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null) : null
  if (!version)
    return {
      ...base,
      path,
      state: 'broken',
      detail: tail(v.stderr || v.stdout)
    }
  if (compareVersions(version, MIN_VERSION[id]) < 0)
    return { ...base, path, version, state: 'too_old' }

  const a = await deps.exec(path, ['auth', 'status'], env)
  let auth: { loggedIn?: boolean; authMethod?: string } = {}
  try {
    auth = JSON.parse(a.stdout.slice(a.stdout.indexOf('{')))
  } catch {
    // not JSON: treated as logged out, with the CLI's words
  }
  if (auth.loggedIn !== true) {
    return {
      ...base,
      path,
      version,
      state: 'logged_out',
      detail: tail(a.stderr || a.stdout) || null
    }
  }
  return {
    ...base,
    path,
    version,
    state: 'ready',
    authMethod: auth.authMethod ?? null
  }
}

const cache = new Map<CliId, Promise<CliStatus>>()

/** Cached for the app's life; a failed check is re-run next time (spec §3). */
export function getCliStatus(
  id: CliId,
  opts: { refresh?: boolean } = {}
): Promise<CliStatus> {
  const hit = cache.get(id)
  if (hit && !opts.refresh) {
    return hit.then((s) =>
      s.state === 'ready' ? s : getCliStatus(id, { refresh: true })
    )
  }
  const next = checkCli(id)
  cache.set(id, next)
  return next
}
```

- [ ] **Step 6: Run both tests — expect PASS**, then `bun run typecheck && bun run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/main/lib/agents/settings.ts src/main/lib/agents/login-shell.ts src/main/lib/agents/cli-check.ts tests/unit/main/lib/agents/login-shell.test.ts tests/unit/main/lib/agents/cli-check.test.ts
git commit -m "feat(agents): find the owner's CLI through their login shell and check it is installed, runs, is new enough and logged in — no quota spent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Claude Code protocol — one stdout line to driver events

**Files:**

- Create: `src/main/lib/agents/driver.ts` (the driver interface + `AgentEvent`)
- Create: `src/main/lib/agents/claude-code/protocol.ts`
- Test: `tests/unit/main/lib/agents/claude-code/protocol.test.ts`

**Interfaces:**

- Consumes: `AgentPrompt`, `AgentAnswer`, `PermissionMode` (Task 1); fixtures `tests/fixtures/claude-code/*.jsonl`.
- Produces (`driver.ts`):

```ts
export type AgentEvent =
  | { type: 'init'; cliSessionId: string; model: string | null }
  | { type: 'text_delta'; delta: string }
  | { type: 'text'; text: string }
  | { type: 'step_start'; id: string; tool: string; summary: string }
  | { type: 'step_end'; id: string; isError: boolean }
  | { type: 'blocked'; prompt: AgentPrompt }
  | { type: 'answered'; requestId: string }
  | { type: 'notice'; text: string }
  | {
      type: 'turn_end'
      ok: boolean
      interrupted: boolean
      text: string
      costUsd: number | null
      denials: number
    }
  | { type: 'exit'; code: number | null; stderrTail: string; expected: boolean }

export interface StartInput {
  binPath: string
  cwd: string
  env: Record<string, string>
  model?: string | null
  permissionMode: PermissionMode
  resume?: string | null
  logPath: string
}

export interface AgentRun {
  readonly cliSessionId: string | null
  readonly alive: boolean
  /** True between a `send` and its `turn_end` (and during an unprompted turn). */
  readonly busy: boolean
  on(listener: (e: AgentEvent) => void): () => void
  send(text: string): boolean
  /** False when that request is not pending (answered elsewhere, or the turn moved on). */
  respond(requestId: string, answer: AgentAnswer): boolean
  interrupt(): boolean
  stop(): Promise<void>
}
```

- Produces (`protocol.ts`): `parseLine(line: string): ParsedLine` where `interface ParsedLine { events: AgentEvent[]; control?: { requestId: string; toolName: string; input: Record<string, unknown> } }`; `summarizeInput(tool: string, input: Record<string, unknown>): string`.

Mapping (spec §2): `system/init` → `init`; `stream_event` with `content_block_delta`/`text_delta` → `text_delta`; `assistant` → one `text` per text block and one `step_start` per `tool_use`; `user` → one `step_end` per `tool_result`; `control_request`/`can_use_tool` → `blocked` (`question` for `AskUserQuestion`, else `permission`) **and** `control` (so the run can answer with the original input); `result` → `turn_end` (`interrupted` is decided by the run, so `false` here); `rate_limit_event` whose status is not `allowed` → `notice`; any other `control_request` subtype → `notice` telling the owner to continue in Terminal; everything else, and any non-JSON line → `{ events: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/agents/claude-code/protocol.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  parseLine,
  summarizeInput
} from '@main/lib/agents/claude-code/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/claude-code')
const lines = (name: string) =>
  readFileSync(resolve(FIX, name), 'utf8').split('\n').filter(Boolean)
const eventsOf = (name: string): AgentEvent[] =>
  lines(name).flatMap((l) => parseLine(l).events)

describe('Claude Code protocol', () => {
  it('maps the allow / write / bash / question run in order', () => {
    const types = eventsOf('allow-write-bash-question.jsonl').map((e) => e.type)
    expect(types[0]).toBe('init')
    expect(types).toContain('step_start')
    expect(types.filter((t) => t === 'turn_end')).toHaveLength(3)
    expect(types.filter((t) => t === 'blocked')).toHaveLength(2) // the Write, the question
  })

  it('reads the session id and model from init', () => {
    const init = eventsOf('allow-write-bash-question.jsonl')[0]
    expect(init).toMatchObject({
      type: 'init',
      model: 'claude-haiku-4-5-20251001'
    })
    expect((init as { cliSessionId: string }).cliSessionId).toMatch(
      /^[0-9a-f-]{36}$/
    )
  })

  it('turns a permission request into a prompt and keeps the input for the answer', () => {
    const line = lines('allow-write-bash-question.jsonl').find((l) =>
      l.includes('"control_request"')
    )!
    const parsed = parseLine(line)
    expect(parsed.events).toEqual([
      {
        type: 'blocked',
        prompt: {
          kind: 'permission',
          requestId: parsed.control!.requestId,
          tool: 'Write',
          summary: '/tmp/actovia-project/hello.txt'
        }
      }
    ])
    expect(parsed.control).toMatchObject({
      toolName: 'Write',
      input: { file_path: '/tmp/actovia-project/hello.txt' }
    })
  })

  it('turns AskUserQuestion into a question prompt with its options', () => {
    const line = lines('allow-write-bash-question.jsonl').find(
      (l) => l.includes('"can_use_tool"') && l.includes('AskUserQuestion')
    )!
    const [e] = parseLine(line).events
    expect(e).toMatchObject({
      type: 'blocked',
      prompt: {
        kind: 'question',
        questions: [
          {
            question: 'Which color do you prefer?',
            multiSelect: false,
            options: [{ label: 'Red' }, { label: 'Blue' }]
          }
        ]
      }
    })
  })

  it('reports a turn end with text, cost and denials', () => {
    const ends = eventsOf('deny-interrupt-continue.jsonl').filter(
      (e) => e.type === 'turn_end'
    )
    expect(ends[0]).toMatchObject({ ok: true, interrupted: false, denials: 1 })
    expect(ends[1]).toMatchObject({ ok: false }) // error_during_execution after the interrupt
    expect((ends[0] as { costUsd: number }).costUsd).toBeGreaterThan(0)
  })

  it('streams text deltas that add up to the final text', () => {
    const evs = eventsOf('partial-messages.jsonl')
    const streamed = evs
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('')
    const final = evs.find((e) => e.type === 'text') as { text: string }
    expect(streamed).toBe(final.text)
  })

  it('pairs each tool result with its step', () => {
    const evs = eventsOf('allow-write-bash-question.jsonl')
    const starts = evs
      .filter((e) => e.type === 'step_start')
      .map((e) => (e as { id: string }).id)
    const ends = evs
      .filter((e) => e.type === 'step_end')
      .map((e) => (e as { id: string }).id)
    expect(ends.every((id) => starts.includes(id))).toBe(true)
  })

  it('ignores what it does not know, and lines that are not JSON', () => {
    expect(
      parseLine('{"type":"system","subtype":"hook_started"}').events
    ).toEqual([])
    expect(
      parseLine('{"type":"system","subtype":"thinking_tokens","n":3}').events
    ).toEqual([])
    expect(parseLine('Warning: something on stdout').events).toEqual([])
    expect(parseLine('').events).toEqual([])
  })

  it('passes a rate-limit notice through only when not allowed', () => {
    expect(
      parseLine(
        '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}'
      ).events
    ).toEqual([])
    const [e] = parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1791555000,"rateLimitType":"five_hour"}}'
    ).events
    expect(e).toMatchObject({ type: 'notice' })
    expect((e as { text: string }).text).toMatch(/rejected/)
  })

  it('summarises a tool input in one line', () => {
    expect(
      summarizeInput('Bash', {
        command: 'npm install\nnpm test',
        description: 'x'
      })
    ).toBe('npm install')
    expect(summarizeInput('Grep', { pattern: 'TODO' })).toBe('TODO')
    expect(summarizeInput('Unknown', {})).toBe('')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/claude-code/protocol.test.ts`

- [ ] **Step 3: Write `driver.ts`** with exactly the `AgentEvent`, `StartInput`, `AgentRun` from the Interfaces block (import types from `@actovia/shared/types/agents`).

- [ ] **Step 4: Write `protocol.ts`**

```ts
// src/main/lib/agents/claude-code/protocol.ts
import type { AgentQuestion } from '@actovia/shared/types/agents'

import type { AgentEvent } from '../driver'

export interface ParsedLine {
  events: AgentEvent[]
  control?: {
    requestId: string
    toolName: string
    input: Record<string, unknown>
  }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** One line of the tool's input: the path, the command, the pattern… */
export function summarizeInput(_tool: string, input: Json): string {
  const pick = [
    'file_path',
    'path',
    'notebook_path',
    'command',
    'pattern',
    'url',
    'query',
    'description'
  ]
    .map((k) => str(input[k]))
    .find((v) => v && v.trim())
  return (pick ?? '').split('\n')[0].slice(0, 160)
}

function questions(input: Json): AgentQuestion[] {
  const qs = Array.isArray(input.questions) ? input.questions : []
  return qs.filter(isObj).map((q) => ({
    question: str(q.question) ?? '',
    header: str(q.header) ?? undefined,
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : [])
      .filter(isObj)
      .map((o) => ({
        label: str(o.label) ?? '',
        description: str(o.description) ?? undefined
      }))
  }))
}

export function parseLine(line: string): ParsedLine {
  let e: unknown
  try {
    e = JSON.parse(line)
  } catch {
    return { events: [] }
  }
  if (!isObj(e)) return { events: [] }

  switch (e.type) {
    case 'system':
      if (e.subtype === 'init' && str(e.session_id)) {
        return {
          events: [
            {
              type: 'init',
              cliSessionId: str(e.session_id)!,
              model: str(e.model)
            }
          ]
        }
      }
      return { events: [] }

    case 'stream_event': {
      const ev = isObj(e.event) ? e.event : null
      const delta = ev && isObj(ev.delta) ? ev.delta : null
      if (
        ev?.type === 'content_block_delta' &&
        delta?.type === 'text_delta' &&
        str(delta.text)
      ) {
        return { events: [{ type: 'text_delta', delta: str(delta.text)! }] }
      }
      return { events: [] }
    }

    case 'assistant': {
      const content =
        isObj(e.message) && Array.isArray(e.message.content)
          ? e.message.content
          : []
      const events: AgentEvent[] = []
      for (const b of content.filter(isObj)) {
        if (b.type === 'text' && str(b.text))
          events.push({ type: 'text', text: str(b.text)! })
        if (b.type === 'tool_use' && str(b.id) && str(b.name)) {
          const input = isObj(b.input) ? b.input : {}
          events.push({
            type: 'step_start',
            id: str(b.id)!,
            tool: str(b.name)!,
            summary: summarizeInput(str(b.name)!, input)
          })
        }
      }
      return { events }
    }

    case 'user': {
      const content =
        isObj(e.message) && Array.isArray(e.message.content)
          ? e.message.content
          : []
      return {
        events: content
          .filter(isObj)
          .filter((b) => b.type === 'tool_result' && str(b.tool_use_id))
          .map((b) => ({
            type: 'step_end' as const,
            id: str(b.tool_use_id)!,
            isError: b.is_error === true
          }))
      }
    }

    case 'control_request': {
      const req = isObj(e.request) ? e.request : {}
      const requestId = str(e.request_id)
      if (!requestId) return { events: [] }
      if (req.subtype !== 'can_use_tool') {
        return {
          events: [
            {
              type: 'notice',
              text: `Claude Code asked for “${String(req.subtype)}”, which Actovia cannot answer — continue in Terminal.`
            }
          ]
        }
      }
      const toolName = str(req.tool_name) ?? 'Tool'
      const input = isObj(req.input) ? req.input : {}
      const prompt =
        toolName === 'AskUserQuestion'
          ? {
              kind: 'question' as const,
              requestId,
              questions: questions(input)
            }
          : {
              kind: 'permission' as const,
              requestId,
              tool: toolName,
              summary: summarizeInput(toolName, input)
            }
      return {
        events: [{ type: 'blocked', prompt }],
        control: { requestId, toolName, input }
      }
    }

    case 'result':
      return {
        events: [
          {
            type: 'turn_end',
            ok: e.subtype === 'success' && e.is_error !== true,
            interrupted: false,
            text: str(e.result) ?? '',
            costUsd:
              typeof e.total_cost_usd === 'number' ? e.total_cost_usd : null,
            denials: Array.isArray(e.permission_denials)
              ? e.permission_denials.length
              : 0
          }
        ]
      }

    case 'rate_limit_event': {
      const info = isObj(e.rate_limit_info) ? e.rate_limit_info : {}
      if (info.status === 'allowed' || !str(info.status)) return { events: [] }
      const resets =
        typeof info.resetsAt === 'number'
          ? ` · resets ${new Date(info.resetsAt * 1000).toLocaleString()}`
          : ''
      return {
        events: [
          {
            type: 'notice',
            text: `Rate limit (${str(info.rateLimitType) ?? 'usage'}): ${str(info.status)}${resets}`
          }
        ]
      }
    }

    default:
      return { events: [] }
  }
}
```

- [ ] **Step 5: Run — expect PASS.** If a fixture assertion fails, read the fixture line — the fixture is the truth, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/agents/driver.ts src/main/lib/agents/claude-code/protocol.ts tests/unit/main/lib/agents/claude-code/protocol.test.ts tests/fixtures/claude-code
git commit -m "feat(agents): read Claude Code's stream-json — steps, text, permission and question prompts, turn ends — from the real CLI's recorded output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The fake CLI and the Claude Code process driver

**Files:**

- Create: `tests/fixtures/claude-code/fake-claude.mjs`
- Create: `src/main/lib/agents/claude-code/run.ts`
- Test: `tests/unit/main/lib/agents/claude-code/run.test.ts`

**Interfaces:**

- Consumes: `parseLine` (Task 5), `AgentEvent`, `AgentRun`, `StartInput` (Task 5), `AgentAnswer` (Task 1).
- Produces: `startClaudeCode(input: StartInput): AgentRun`; `buildArgs(input: StartInput): string[]`.

The fake replays a fixture **turn by turn**: a turn is the lines from one `system/init` up to and including the next `result` (lines before the first `init` belong to turn 1). Each user message on stdin plays the next turn. A `control_request` line pauses the turn until a `control_response` with that `request_id` arrives. An `interrupt` request is acknowledged and ends the turn with a `result` of subtype `error_during_execution`. Environment knobs:

| Variable                       | Effect                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `FAKE_CLAUDE_FIXTURE`          | the `.jsonl` to replay (required for a session)                               |
| `FAKE_CLAUDE_RECORD`           | append `{"argv": [...]}` once, then every stdin line, to this file            |
| `FAKE_CLAUDE_AUTOPLAY_AFTER=n` | after turn _n_ finishes, play turn _n+1_ with no message (an unprompted turn) |
| `FAKE_CLAUDE_SPLIT=1`          | write every line in two chunks 5 ms apart                                     |
| `FAKE_CLAUDE_GARBAGE=1`        | write a non-JSON line before the first turn                                   |
| `FAKE_CLAUDE_DIE_AFTER=n`      | after writing _n_ lines, print `boom` to stderr and exit 1                    |

- [ ] **Step 1: Write the fake**

```js
#!/usr/bin/env node
// tests/fixtures/claude-code/fake-claude.mjs — replays recorded Claude Code stdout (see the plan, Task 6).
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log(process.env.FAKE_CLAUDE_VERSION ?? '2.1.294 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth') {
  console.log(
    process.env.FAKE_CLAUDE_AUTH ??
      '{"loggedIn": true, "authMethod": "claude.ai"}'
  )
  process.exit(0)
}

const record = (o) =>
  process.env.FAKE_CLAUDE_RECORD &&
  appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify(o) + '\n')
record({ argv: args })

const lines = readFileSync(process.env.FAKE_CLAUDE_FIXTURE, 'utf8')
  .split('\n')
  .filter(Boolean)
const turns = []
let current = []
for (const line of lines) {
  const e = JSON.parse(line)
  if (
    e.type === 'system' &&
    e.subtype === 'init' &&
    current.some((l) => JSON.parse(l).subtype === 'init')
  ) {
    turns.push(current)
    current = []
  }
  current.push(line)
}
if (current.length) turns.push(current)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let written = 0
async function write(line) {
  if (process.env.FAKE_CLAUDE_SPLIT === '1') {
    const half = Math.floor(line.length / 2)
    process.stdout.write(line.slice(0, half))
    await sleep(5)
    process.stdout.write(line.slice(half) + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
  written++
  const die = Number(process.env.FAKE_CLAUDE_DIE_AFTER ?? 0)
  if (die && written >= die) {
    process.stderr.write('boom\n')
    process.exit(1)
  }
}

let played = 0
let playing = false
let waitingFor = null // request_id we wait an answer for
let resumeWait = null
let interrupted = null // request_id of an interrupt

async function playTurn() {
  if (played >= turns.length) return
  playing = true
  const turn = turns[played++]
  let sessionId = null
  for (const line of turn) {
    if (interrupted) break
    const e = JSON.parse(line)
    sessionId = e.session_id ?? sessionId
    if (e.type === 'result' && interrupted) break
    await write(line)
    if (e.type === 'control_request') {
      waitingFor = e.request_id
      await new Promise((r) => (resumeWait = r))
    }
    await sleep(1)
  }
  if (interrupted) {
    await write(
      JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: interrupted, response: {} }
      })
    )
    await write(
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: sessionId,
        duration_ms: 1,
        permission_denials: []
      })
    )
    interrupted = null
  }
  playing = false
  const auto = Number(process.env.FAKE_CLAUDE_AUTOPLAY_AFTER ?? 0)
  if (auto && played === auto) setTimeout(playTurn, 20)
  else if (queue.length) {
    queue.shift()
    playTurn()
  }
}

if (process.env.FAKE_CLAUDE_GARBAGE === '1')
  process.stdout.write('Warning: not json\n')

const queue = []
createInterface({ input: process.stdin })
  .on('line', (line) => {
    record({ stdin: JSON.parse(line) })
    const m = JSON.parse(line)
    if (m.type === 'user') {
      queue.push(m)
      if (!playing) {
        queue.shift()
        playTurn()
      }
    } else if (
      m.type === 'control_response' &&
      m.response?.request_id === waitingFor
    ) {
      waitingFor = null
      resumeWait?.()
    } else if (
      m.type === 'control_request' &&
      m.request?.subtype === 'interrupt'
    ) {
      interrupted = m.request_id
      if (waitingFor) {
        waitingFor = null
        resumeWait?.()
      }
    }
  })
  .on('close', async () => {
    while (playing) await sleep(5)
    process.exit(0)
  })
```

(Keep it plain JS so it runs without a build; `chmod +x` it in Step 5's `beforeAll`.)

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/main/lib/agents/claude-code/run.test.ts
import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { buildArgs, startClaudeCode } from '@main/lib/agents/claude-code/run'
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
import { beforeAll, describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../../fixtures/claude-code')
const FAKE = join(FIX, 'fake-claude.mjs')
beforeAll(() => chmodSync(FAKE, 0o755))

function start(
  fixture: string,
  extra: Record<string, string> = {},
  input: Partial<Parameters<typeof startClaudeCode>[0]> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-run-'))
  const recordPath = join(dir, 'record.jsonl')
  const logPath = join(dir, 'raw.jsonl')
  const run = startClaudeCode({
    binPath: FAKE,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CLAUDE_FIXTURE: join(FIX, fixture),
      FAKE_CLAUDE_RECORD: recordPath,
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
  return { run, events, recorded, logPath }
}

/** Resolves with the first event matching, or rejects after `ms`. */
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

describe('Claude Code run', () => {
  it('builds the stream-json command line, never with bypassPermissions', () => {
    const args = buildArgs({
      binPath: 'claude',
      cwd: '/p',
      env: {},
      permissionMode: 'acceptEdits',
      model: 'opus',
      resume: 'abc',
      logPath: '/l'
    })
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'opus',
      '--resume',
      'abc'
    ])
    expect(args).not.toContain('bypassPermissions')
  })

  it('answers a permission with the original input, and sees the turn end', async () => {
    const { run, recorded } = start('allow-write-bash-question.jsonl')
    run.send('Create hello.txt')
    const blocked = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(run.respond(blocked.prompt.requestId, { kind: 'allow' })).toBe(true)
    await next(run, (e) => e.type === 'turn_end')
    const answer = recorded().find((r) => r.stdin?.type === 'control_response')
    expect(answer.stdin.response).toMatchObject({
      subtype: 'success',
      request_id: blocked.prompt.requestId,
      response: {
        behavior: 'allow',
        updatedInput: { file_path: '/tmp/actovia-project/hello.txt' }
      }
    })
    expect(run.cliSessionId).toMatch(/^[0-9a-f-]{36}$/)
    await run.stop()
  })

  it('answers a question with the chosen labels in updatedInput.answers', async () => {
    const { run, recorded } = start('allow-write-bash-question.jsonl')
    run.send('turn 1')
    const b1 = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b1.prompt.requestId, { kind: 'allow' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('turn 2')
    await next(run, (e) => e.type === 'turn_end')
    run.send('turn 3')
    const b3 = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(b3.prompt.kind).toBe('question')
    run.respond(b3.prompt.requestId, {
      kind: 'answers',
      answers: { 'Which color do you prefer?': 'Blue' }
    })
    await next(run, (e) => e.type === 'turn_end')
    const last = recorded()
      .filter((r) => r.stdin?.type === 'control_response')
      .at(-1)
    expect(last.stdin.response.response.updatedInput.answers).toEqual({
      'Which color do you prefer?': 'Blue'
    })
    expect(last.stdin.response.response.updatedInput.questions).toHaveLength(1)
    await run.stop()
  })

  it('denies with the owner’s reason, and refuses a second answer to the same request', async () => {
    const { run, recorded } = start('deny-interrupt-continue.jsonl')
    run.send('Create secret.txt')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    expect(
      run.respond(b.prompt.requestId, {
        kind: 'deny',
        reason: 'Use another name'
      })
    ).toBe(true)
    expect(run.respond(b.prompt.requestId, { kind: 'allow' })).toBe(false)
    await next(run, (e) => e.type === 'turn_end')
    const deny = recorded().find((r) => r.stdin?.type === 'control_response')
    expect(deny.stdin.response.response).toEqual({
      behavior: 'deny',
      message: 'Use another name'
    })
    await run.stop()
  })

  it('emits answered when a prompt is answered', async () => {
    const { run, events } = start('deny-interrupt-continue.jsonl')
    run.send('x')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    expect(events).toContainEqual({
      type: 'answered',
      requestId: b.prompt.requestId
    })
    await run.stop()
  })

  it('interrupts a running turn: the turn ends interrupted and the process lives on', async () => {
    const { run } = start('deny-interrupt-continue.jsonl')
    run.send('turn 1')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('write a long story')
    await next(run, (e) => e.type === 'init')
    expect(run.interrupt()).toBe(true)
    const end = await next(run, (e) => e.type === 'turn_end')
    expect(end).toMatchObject({ interrupted: true, ok: false })
    expect(run.alive).toBe(true)
    await run.stop()
  })

  it('reads lines split across chunks and skips a non-JSON line', async () => {
    const { run, events } = start('resume.jsonl', {
      FAKE_CLAUDE_SPLIT: '1',
      FAKE_CLAUDE_GARBAGE: '1'
    })
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['init', 'text', 'turn_end'])
    )
    await run.stop()
  })

  it('reports an unexpected exit with stderr’s tail, and refuses writes after', async () => {
    const { run } = start('allow-write-bash-question.jsonl', {
      FAKE_CLAUDE_DIE_AFTER: '3'
    })
    run.send('go')
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ code: 1, expected: false })
    expect((exit as { stderrTail: string }).stderrTail).toMatch(/boom/)
    expect(run.alive).toBe(false)
    expect(run.send('again')).toBe(false)
    expect(run.respond('nope', { kind: 'allow' })).toBe(false)
  })

  it('reports a spawn failure as an exit, not a throw', async () => {
    const run = startClaudeCode({
      binPath: '/nonexistent/claude',
      cwd: tmpdir(),
      env: {},
      permissionMode: 'default',
      logPath: join(mkdtempSync(join(tmpdir(), 'x-')), 'l')
    })
    const exit = await next(run, (e) => e.type === 'exit')
    expect(exit).toMatchObject({ code: null, expected: false })
  })

  it('catches an unprompted turn after the last answer', async () => {
    const { run } = start('deny-and-unprompted-turn.jsonl', {
      FAKE_CLAUDE_AUTOPLAY_AFTER: '3'
    })
    let ends = 0
    run.on((e) => {
      if (e.type === 'turn_end') ends++
    })
    run.send('1')
    const b = (await next(run, (e) => e.type === 'blocked')) as Extract<
      AgentEvent,
      { type: 'blocked' }
    >
    run.respond(b.prompt.requestId, { kind: 'deny' })
    await next(run, (e) => e.type === 'turn_end')
    run.send('2')
    await next(run, (e) => e.type === 'turn_end')
    run.send('3')
    await next(run, (e) => e.type === 'turn_end')
    await next(run, (e) => e.type === 'turn_end') // nobody asked for this one
    expect(ends).toBe(4)
    await run.stop()
  })

  it('logs every stdout line verbatim', async () => {
    const { run, logPath } = start('resume.jsonl')
    run.send('hello')
    await next(run, (e) => e.type === 'turn_end')
    await run.stop()
    const logged = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    expect(logged.length).toBe(
      readFileSync(join(FIX, 'resume.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean).length
    )
  })

  it('stop ends the process and marks the exit expected', async () => {
    const { run } = start('resume.jsonl')
    const exited = next(run, (e) => e.type === 'exit')
    await run.stop()
    expect(await exited).toMatchObject({ expected: true })
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (module missing)

Run: `bunx vitest run tests/unit/main/lib/agents/claude-code/run.test.ts`

- [ ] **Step 4: Implement `run.ts`**

```ts
// src/main/lib/agents/claude-code/run.ts
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { createInterface } from 'readline'

import type { AgentAnswer } from '@actovia/shared/types/agents'

import type { AgentEvent, AgentRun, StartInput } from '../driver'
import { parseLine } from './protocol'

const STDERR_KEEP = 4096

export function buildArgs(input: StartInput): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    input.permissionMode
  ]
  if (input.model) args.push('--model', input.model)
  if (input.resume) args.push('--resume', input.resume)
  return args
}

/** One `claude -p` process in stream-json (spec §2, §8). Never throws: failures arrive as `exit`. */
export function startClaudeCode(input: StartInput): AgentRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const pending = new Map<string, Record<string, unknown>>()
  const log = createWriteStream(input.logPath, { flags: 'a' })
  let cliSessionId: string | null = null
  let alive = true
  let busy = false
  let stopping = false
  let interruptRequested = false
  let interrupts = 0
  let stderr = ''

  const emit = (e: AgentEvent) => {
    for (const l of [...listeners]) l(e)
  }

  const child = spawn(input.binPath, buildArgs(input), {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const write = (o: unknown): boolean => {
    if (!alive || !child.stdin.writable) return false
    child.stdin.write(JSON.stringify(o) + '\n')
    return true
  }

  createInterface({ input: child.stdout }).on('line', (line) => {
    log.write(line + '\n')
    const { events, control } = parseLine(line)
    if (control) pending.set(control.requestId, control.input)
    for (const e of events) {
      if (e.type === 'init') {
        cliSessionId = e.cliSessionId
        busy = true
      }
      if (e.type === 'turn_end') {
        busy = false
        pending.clear()
        if (interruptRequested) {
          interruptRequested = false
          emit({ ...e, interrupted: true })
          continue
        }
      }
      emit(e)
    }
  })

  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-STDERR_KEEP)
  })

  let exited = false
  const onExit = (code: number | null, message?: string) => {
    if (exited) return
    exited = true
    alive = false
    busy = false
    pending.clear()
    log.end()
    emit({
      type: 'exit',
      code,
      stderrTail: (message ?? stderr).trim(),
      expected: stopping
    })
  }
  child.on('error', (err) => onExit(null, err.message))
  child.on('exit', (code) => onExit(code))

  return {
    get cliSessionId() {
      return cliSessionId
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
      const ok = write({
        type: 'user',
        message: { role: 'user', content: text }
      })
      if (ok) busy = true
      return ok
    },
    respond(requestId, answer: AgentAnswer) {
      const original = pending.get(requestId)
      if (!original || !alive) return false
      const response =
        answer.kind === 'deny'
          ? {
              behavior: 'deny',
              message: answer.reason?.trim() || 'The owner declined.'
            }
          : answer.kind === 'answers'
            ? {
                behavior: 'allow',
                updatedInput: { ...original, answers: answer.answers }
              }
            : { behavior: 'allow', updatedInput: original }
      if (
        !write({
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response }
        })
      )
        return false
      pending.delete(requestId)
      emit({ type: 'answered', requestId })
      return true
    },
    interrupt() {
      if (!busy) return false
      interruptRequested = true
      return write({
        type: 'control_request',
        request_id: `interrupt-${++interrupts}`,
        request: { subtype: 'interrupt' }
      })
    },
    stop() {
      if (!alive) return Promise.resolve()
      stopping = true
      return new Promise<void>((done) => {
        child.once('exit', () => done())
        child.once('error', () => done())
        child.stdin.end()
        const term = setTimeout(() => alive && child.kill('SIGTERM'), 1500)
        const kill = setTimeout(() => alive && child.kill('SIGKILL'), 3000)
        child.once('exit', () => {
          clearTimeout(term)
          clearTimeout(kill)
        })
      })
    }
  }
}
```

- [ ] **Step 5: Run — expect PASS.** The fake is the only moving part you may need to adjust; never weaken an assertion about what Actovia writes.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
bun run typecheck && bunx oxlint src/main/lib/agents
git add tests/fixtures/claude-code/fake-claude.mjs src/main/lib/agents/claude-code/run.ts tests/unit/main/lib/agents/claude-code/run.test.ts
git commit -m "feat(agents): run Claude Code as a process — send tasks, answer permissions and questions with the original input, interrupt, stop, log every line; failures arrive as an exit, never a throw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The card — folding driver events into what the owner sees

**Files:**

- Create: `src/main/lib/agents/card.ts`
- Test: `tests/unit/main/lib/agents/card.test.ts`

**Interfaces:**

- Consumes: `AgentCard` (Task 1), `AgentEvent` (Task 5), `parseLine` (for fixtures).
- Produces:
  - `newCard(init: Pick<AgentCard, 'sessionId' | 'agentId' | 'runtime' | 'model' | 'projectName' | 'cwd' | 'branch'>): AgentCard` — state `working`, everything else empty / zero / false
  - `applyAgentEvent(card: AgentCard, e: AgentEvent): AgentCard` — pure, returns a new object
  - `cardText(card: AgentCard): string` — `[...blocks, pending]` non-empty, joined by a blank line
  - `touchedFiles(card: AgentCard): string[]` — unique summaries of `Write` / `Edit` / `NotebookEdit` steps that ended `ok`

Rules: `init` → `working`, clears `error` (an unprompted turn reopens a done card); `text_delta` appends to `pending`; `text` pushes to `blocks` and clears `pending`; `step_start` appends a `running` step (ignored if the id exists); `step_end` sets `ok`/`error`; `blocked` adds the prompt, state `blocked`; `answered` removes it, state `working` when none are left; `notice` appends unless it equals the last; `turn_end` clears prompts, flushes `pending` into `blocks`, adds cost (null + n = n) and denials, state `stopped` if interrupted, `done` if ok, else `error` with `text` or `"The turn ended with an error."`; `exit` while `working`/`blocked` → `stopped` if expected, else `error` with the stderr tail or `"Claude Code exited (code N)."`; `exit` after `done` changes nothing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/agents/card.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  applyAgentEvent,
  cardText,
  newCard,
  touchedFiles
} from '@main/lib/agents/card'
import { parseLine } from '@main/lib/agents/claude-code/protocol'
import type { AgentEvent } from '@main/lib/agents/driver'
import { describe, expect, it } from 'vitest'

const FIX = resolve(import.meta.dirname, '../../../../fixtures/claude-code')
const events = (name: string): AgentEvent[] =>
  readFileSync(resolve(FIX, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => parseLine(l).events)
const base = () =>
  newCard({
    sessionId: 's',
    agentId: 'a',
    runtime: 'claude-code',
    model: null,
    projectName: 'p',
    cwd: '/p',
    branch: null
  })

describe('agent card', () => {
  it('ends a recorded run done, with steps ticked, cost summed and the text kept', () => {
    const card = events('allow-write-bash-question.jsonl').reduce(
      applyAgentEvent,
      base()
    )
    expect(card.state).toBe('done')
    expect(card.steps.map((s) => [s.tool, s.status])).toEqual([
      ['Write', 'ok'],
      ['Bash', 'ok'],
      ['AskUserQuestion', 'ok']
    ])
    expect(card.costUsd).toBeGreaterThan(0.1)
    expect(cardText(card)).toMatch(/You chose Blue!/)
    expect(card.prompts).toEqual([])
    expect(touchedFiles(card)).toEqual(['/tmp/actovia-project/hello.txt'])
  })

  it('is blocked while a prompt waits and working again once it is answered', () => {
    const blocked = applyAgentEvent(base(), {
      type: 'blocked',
      prompt: {
        kind: 'permission',
        requestId: 'r1',
        tool: 'Bash',
        summary: 'npm i'
      }
    })
    expect(blocked.state).toBe('blocked')
    const answered = applyAgentEvent(blocked, {
      type: 'answered',
      requestId: 'r1'
    })
    expect(answered).toMatchObject({ state: 'working', prompts: [] })
  })

  it('counts a denial, is stopped after an interrupted turn, and done after the next', () => {
    const evs = events('deny-interrupt-continue.jsonl')
    const ends = evs.flatMap((e, i) => (e.type === 'turn_end' ? [i] : []))
    // The run (Task 6) marks the turn it interrupted; the parser cannot know.
    const marked = evs.map((e, i) =>
      i === ends[1] ? ({ ...e, interrupted: true } as AgentEvent) : e
    )
    const afterInterrupt = marked
      .slice(0, ends[1] + 1)
      .reduce(applyAgentEvent, base())
    expect(afterInterrupt.state).toBe('stopped')
    expect(afterInterrupt.denials).toBe(1)
    expect(marked.reduce(applyAgentEvent, base()).state).toBe('done')
  })

  it('streams text into pending and settles it into a block', () => {
    let c = applyAgentEvent(base(), { type: 'text_delta', delta: 'Hel' })
    c = applyAgentEvent(c, { type: 'text_delta', delta: 'lo' })
    expect(cardText(c)).toBe('Hello')
    c = applyAgentEvent(c, { type: 'text', text: 'Hello' })
    expect(c).toMatchObject({ blocks: ['Hello'], pending: '' })
  })

  it('reopens a done card for an unprompted turn', () => {
    let c = applyAgentEvent(base(), {
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: 'ok',
      costUsd: 0.01,
      denials: 0
    })
    expect(c.state).toBe('done')
    c = applyAgentEvent(c, { type: 'init', cliSessionId: 'x', model: null })
    expect(c.state).toBe('working')
  })

  it('fails on an unexpected exit mid-turn with the stderr tail, but not after done', () => {
    const failed = applyAgentEvent(base(), {
      type: 'exit',
      code: 1,
      stderrTail: 'boom',
      expected: false
    })
    expect(failed).toMatchObject({ state: 'error', error: 'boom' })
    const quiet = applyAgentEvent(base(), {
      type: 'exit',
      code: 1,
      stderrTail: '',
      expected: false
    })
    expect(quiet.error).toBe('Claude Code exited (code 1).')
    const done = applyAgentEvent(base(), {
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: '',
      costUsd: null,
      denials: 0
    })
    expect(
      applyAgentEvent(done, {
        type: 'exit',
        code: 0,
        stderrTail: '',
        expected: false
      }).state
    ).toBe('done')
  })

  it('keeps a repeated notice once', () => {
    let c = applyAgentEvent(base(), {
      type: 'notice',
      text: 'Rate limit: rejected'
    })
    c = applyAgentEvent(c, { type: 'notice', text: 'Rate limit: rejected' })
    expect(c.notices).toEqual(['Rate limit: rejected'])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/card.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/lib/agents/card.ts
import type { AgentCard } from '@actovia/shared/types/agents'

import type { AgentEvent } from './driver'

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export function newCard(
  init: Pick<
    AgentCard,
    | 'sessionId'
    | 'agentId'
    | 'runtime'
    | 'model'
    | 'projectName'
    | 'cwd'
    | 'branch'
  >
): AgentCard {
  return {
    kind: 'agent_card',
    ...init,
    state: 'working',
    steps: [],
    blocks: [],
    pending: '',
    prompts: [],
    notices: [],
    costUsd: null,
    denials: 0,
    error: null,
    continuedInTerminal: false,
    queued: false
  }
}

export function cardText(card: AgentCard): string {
  return [...card.blocks, card.pending].filter((t) => t.trim()).join('\n\n')
}

export function touchedFiles(card: AgentCard): string[] {
  return [
    ...new Set(
      card.steps
        .filter((s) => EDIT_TOOLS.has(s.tool) && s.status === 'ok' && s.summary)
        .map((s) => s.summary)
    )
  ]
}

export function applyAgentEvent(card: AgentCard, e: AgentEvent): AgentCard {
  switch (e.type) {
    case 'init':
      return {
        ...card,
        state: card.prompts.length ? 'blocked' : 'working',
        error: null,
        queued: false
      }
    case 'text_delta':
      return { ...card, pending: card.pending + e.delta }
    case 'text':
      return { ...card, blocks: [...card.blocks, e.text], pending: '' }
    case 'step_start':
      if (card.steps.some((s) => s.id === e.id)) return card
      return {
        ...card,
        steps: [
          ...card.steps,
          { id: e.id, tool: e.tool, summary: e.summary, status: 'running' }
        ]
      }
    case 'step_end':
      return {
        ...card,
        steps: card.steps.map((s) =>
          s.id === e.id ? { ...s, status: e.isError ? 'error' : 'ok' } : s
        )
      }
    case 'blocked':
      return { ...card, state: 'blocked', prompts: [...card.prompts, e.prompt] }
    case 'answered': {
      const prompts = card.prompts.filter((p) => p.requestId !== e.requestId)
      return { ...card, prompts, state: prompts.length ? 'blocked' : 'working' }
    }
    case 'notice':
      return card.notices.at(-1) === e.text
        ? card
        : { ...card, notices: [...card.notices, e.text] }
    case 'turn_end': {
      const blocks = card.pending.trim()
        ? [...card.blocks, card.pending]
        : card.blocks
      const state = e.interrupted ? 'stopped' : e.ok ? 'done' : 'error'
      return {
        ...card,
        blocks,
        pending: '',
        prompts: [],
        costUsd:
          e.costUsd === null ? card.costUsd : (card.costUsd ?? 0) + e.costUsd,
        denials: card.denials + e.denials,
        state,
        error:
          state === 'error' ? e.text || 'The turn ended with an error.' : null
      }
    }
    case 'exit':
      if (card.state !== 'working' && card.state !== 'blocked') return card
      return {
        ...card,
        prompts: [],
        state: e.expected ? 'stopped' : 'error',
        error: e.expected
          ? null
          : e.stderrTail || `Claude Code exited (code ${e.code ?? '?'}).`
      }
  }
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/agents/card.ts tests/unit/main/lib/agents/card.test.ts
git commit -m "feat(agents): the agent card — steps, streamed text, prompts, notices, cost and the run's state folded from driver events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Projects — new and opened folders, the meta, the alias, worktrees, the plan's home

**Files:**

- Create: `src/main/lib/agents/projects.ts`
- Modify: `src/main/lib/ai/philharmonic/plan-mirror.ts:59-63` (where `plan.md` goes)
- Test: `tests/unit/main/lib/agents/projects.test.ts`

**Interfaces:**

- Consumes: `agentSettings()` (Task 4), project / conversation queries (Task 2), `getActoviaHome()`, `getGroupDir()` (`paths.ts`), `getConversationById()` (`conversation-queries.ts`).
- Produces:
  - `slugify(name: string): string`
  - `assertWorkableFolder(folder: string): Promise<string>` — the real path, or throws `ValidationError` (from `@actovia/shared`, the class `validateSchema` throws) with one of: `"Not a folder"`, `"Your home folder is too broad — choose a folder inside it"`, `"The root folder cannot be used"`, `"Actovia's own data folder cannot be used"`
  - `createNewProject(name: string): Promise<Project>`
  - `openFolderAsProject(folder: string): Promise<Project>`
  - `bindConversation(conversationId: string, projectId: string | null): Promise<void>`
  - `metaDir(project: Pick<Project, 'dir'>): string` → `<dir>/.actovia`
  - `sessionLogPath(project, sessionId): string` → `<meta>/logs/<id>.jsonl`
  - `writeSessionMeta(project, session: AgentSession): Promise<void>` → `<meta>/sessions/<id>.json`
  - `gitBranch(dir: string): Promise<string | null>`
  - `prepareWorkDir(project: Project, sessionId: string, othersRunning: boolean): Promise<{ cwd: string; branch: string | null; note: string | null }>`
  - `planDirFor(conversationId: string): Promise<string>` — the project's meta dir when the group has one, else `getGroupDir(conversationId)`

`project.json` (spec §4): `{ "id", "name", "workDir", "createdAt", "conversationId" }` — `conversationId` is the last group bound. The alias for an opened folder is a **symlink** named after the folder (Finder shows and follows it like an alias). Worktrees: only when `project.useWorktrees`, `othersRunning` and `workDir` is a git work tree; `git worktree add -b actovia/<first 8 of session id> <meta>/worktrees/<session id>`; when `workDir === dir` (a new project that is its own repo), add `.actovia/` to `<workDir>/.git/info/exclude` first so the repo never sees the meta.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/agents/projects.test.ts
import { execFileSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// macOS' tmpdir is a symlink (/var → /private/var); the code works on real paths.
const tmp = (prefix: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)))
const projectsDir = tmp('actovia-projects-')
vi.mock('@main/lib/agents/settings', () => ({
  agentSettings: async () => ({
    projectsDir,
    maxRunning: 2,
    keepAliveMinutes: 10,
    worktrees: true,
    cliPaths: {}
  })
}))

// In-memory project + conversation rows.
const rows = new Map<string, Record<string, unknown>>()
const convs = new Map<string, Record<string, unknown>>()
let n = 0
vi.mock('@main/lib/db/project-queries', () => ({
  createProject: async (d: Record<string, unknown>) => {
    const row = {
      id: `p${++n}`,
      useWorktrees: true,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      ...d
    }
    rows.set(row.id as string, row)
    return row
  },
  getProjectById: async (id: string) => rows.get(id),
  getProjectByDir: async (dir: string) =>
    [...rows.values()].find((r) => r.dir === dir),
  updateProject: async (id: string, d: Record<string, unknown>) =>
    Object.assign(rows.get(id)!, d),
  listRecentProjects: async () => [...rows.values()]
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async (id: string) => convs.get(id),
  updateConversation: async (id: string, d: Record<string, unknown>) =>
    Object.assign(convs.get(id)!, d)
}))
const findByWorkDir = () => [...rows.values()]

const P = await import('@main/lib/agents/projects')

beforeEach(() => {
  rows.clear()
  convs.clear()
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
function repo(): string {
  const dir = tmp('repo-')
  git(dir, 'init', '-q', '-b', 'main')
  git(
    dir,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
  return dir
}

describe('projects', () => {
  it('slugifies a name for a folder', () => {
    expect(P.slugify('Notes Prototype!')).toBe('notes-prototype')
    expect(P.slugify('笔记 原型')).toBe('笔记-原型')
    expect(P.slugify('  ')).toBe('project')
  })

  it('creates a new project folder with its hidden meta and works in it', async () => {
    const p = await P.createNewProject('Notes Prototype')
    expect(p.dir).toBe(join(projectsDir, 'notes-prototype'))
    expect(p.workDir).toBe(p.dir)
    expect(existsSync(join(p.dir, '.actovia/sessions'))).toBe(true)
    expect(existsSync(join(p.dir, '.actovia/logs'))).toBe(true)
    const meta = JSON.parse(
      readFileSync(join(p.dir, '.actovia/project.json'), 'utf8')
    )
    expect(meta).toMatchObject({
      id: p.id,
      name: 'Notes Prototype',
      workDir: p.dir
    })
  })

  it('never reuses a folder name', async () => {
    const a = await P.createNewProject('x')
    const b = await P.createNewProject('x')
    expect(b.dir).toBe(join(projectsDir, 'x-2'))
    expect(a.dir).not.toBe(b.dir)
  })

  it('opens an existing folder: meta in the projects folder, an alias to it, nothing written into it', async () => {
    const folder = tmp('tax-pdfs-')
    writeFileSync(join(folder, 'a.pdf'), '')
    const p = await P.openFolderAsProject(folder)
    expect(p.workDir).toBe(folder)
    expect(p.dir.startsWith(projectsDir)).toBe(true)
    const alias = join(p.dir, p.name)
    expect(lstatSync(alias).isSymbolicLink()).toBe(true)
    expect(readlinkSync(alias)).toBe(folder)
    expect(existsSync(join(folder, '.actovia'))).toBe(false)
  })

  it('opening the same folder twice returns the same project', async () => {
    const folder = tmp('same-')
    rows.clear()
    const a = await P.openFolderAsProject(folder)
    const b = await P.openFolderAsProject(folder)
    expect(b.id).toBe(a.id)
    expect(findByWorkDir()).toHaveLength(1)
  })

  it.each([
    ['home', homedir(), /home folder/],
    ['root', '/', /root folder/],
    ["Actovia's data", process.env.ACTOVIA_HOME!, /data folder/]
  ])('refuses %s', async (_label, folder, message) => {
    await expect(P.assertWorkableFolder(folder)).rejects.toThrow(message)
  })

  it('refuses anything inside Actovia’ data and a file', async () => {
    const inside = join(process.env.ACTOVIA_HOME!, 'groups', 'g')
    mkdirSync(inside, { recursive: true })
    await expect(P.assertWorkableFolder(inside)).rejects.toThrow(/data folder/)
    const file = join(tmp('f-'), 'x.txt')
    writeFileSync(file, '')
    await expect(P.assertWorkableFolder(file)).rejects.toThrow(/Not a folder/)
  })

  it('binds a group to a project and back to none', async () => {
    convs.set('c1', { id: 'c1', projectId: null })
    const p = await P.createNewProject('bound')
    await P.bindConversation('c1', p.id)
    expect(convs.get('c1')!.projectId).toBe(p.id)
    expect(
      JSON.parse(readFileSync(join(p.dir, '.actovia/project.json'), 'utf8'))
        .conversationId
    ).toBe('c1')
    expect(await P.planDirFor('c1')).toBe(join(p.dir, '.actovia'))
    await P.bindConversation('c1', null)
    expect(convs.get('c1')!.projectId).toBeNull()
  })

  it('works in the folder itself when nobody else is running', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    const w = await P.prepareWorkDir(p, '12345678-aaaa', false)
    expect(w).toEqual({ cwd: dir, branch: 'main', note: null })
  })

  it('gives a second agent its own worktree on its own branch', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    const w = await P.prepareWorkDir(p, 'abcdef12-3456', true)
    expect(w.branch).toBe('actovia/abcdef12')
    expect(w.cwd).toBe(join(p.dir, '.actovia/worktrees/abcdef12-3456'))
    expect(git(w.cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'actovia/abcdef12'
    )
  })

  it('shares a folder that is not a git repo, and says so', async () => {
    const folder = tmp('plain-')
    const p = await P.openFolderAsProject(folder)
    expect(await P.prepareWorkDir(p, 'abcdef12-3456', true)).toEqual({
      cwd: folder,
      branch: null,
      note: 'not-git'
    })
  })

  it('keeps the meta out of a new project that is its own repo', async () => {
    const p = await P.createNewProject('own-repo')
    git(p.dir, 'init', '-q', '-b', 'main')
    git(
      p.dir,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'i'
    )
    await P.prepareWorkDir(p, 'ffffffff-0000', true)
    expect(readFileSync(join(p.dir, '.git/info/exclude'), 'utf8')).toMatch(
      /^\.actovia\/$/m
    )
    expect(git(p.dir, 'status', '--porcelain')).toBe('')
  })

  it('falls back to the shared folder when the worktree cannot be made', async () => {
    const dir = repo()
    const p = await P.openFolderAsProject(dir)
    git(dir, 'branch', 'actovia/deadbeef') // the branch it would create already exists
    const w = await P.prepareWorkDir(p, 'deadbeef-0000', true)
    expect(w.cwd).toBe(dir)
    expect(w.note).toMatch(/^worktree-failed/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/projects.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/lib/agents/projects.ts
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile
} from 'fs/promises'
import { homedir } from 'os'
import { basename, join, sep } from 'path'

import { ErrorCode, ValidationError } from '@actovia/shared'

import {
  getConversationById,
  updateConversation
} from '../db/conversation-queries'
import {
  createProject,
  getProjectByDir,
  getProjectById,
  listRecentProjects,
  updateProject
} from '../db/project-queries'
import type { AgentSession, Project } from '../db/schema'
import { getActoviaHome, getGroupDir } from '../paths'
import { agentSettings } from './settings'

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'project'
}

const fail = (message: string): never => {
  throw new ValidationError(ErrorCode.VALIDATION_FAILED, message)
}

/** Spec §4 / §7.3: a real folder, never `~`, `/`, or Actovia's own data. */
export async function assertWorkableFolder(folder: string): Promise<string> {
  let real: string
  try {
    real = await realpath(folder)
  } catch {
    return fail('Not a folder')
  }
  if (!(await stat(real)).isDirectory()) fail('Not a folder')
  if (real === '/') fail('The root folder cannot be used')
  if (real === (await realpath(homedir())))
    fail('Your home folder is too broad — choose a folder inside it')
  const data = await realpath(getActoviaHome()).catch(() => getActoviaHome())
  if (real === data || real.startsWith(data + sep))
    fail("Actovia's own data folder cannot be used")
  return real
}

export const metaDir = (project: Pick<Project, 'dir'>) =>
  join(project.dir, '.actovia')
export const sessionLogPath = (
  project: Pick<Project, 'dir'>,
  sessionId: string
) => join(metaDir(project), 'logs', `${sessionId}.jsonl`)

async function uniqueDir(parent: string, name: string): Promise<string> {
  const base = slugify(name)
  for (let i = 1; ; i++) {
    const dir = join(parent, i === 1 ? base : `${base}-${i}`)
    if (!existsSync(dir) && !(await getProjectByDir(dir))) return dir
  }
}

async function writeProjectJson(
  project: Project,
  conversationId: string | null = null
) {
  const file = join(metaDir(project), 'project.json')
  const previous = await readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  await writeFile(
    file,
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        workDir: project.workDir,
        createdAt: project.createdAt,
        conversationId: conversationId ?? previous.conversationId ?? null
      },
      null,
      2
    ) + '\n'
  )
}

async function makeMeta(dir: string) {
  await mkdir(join(dir, '.actovia', 'sessions'), { recursive: true })
  await mkdir(join(dir, '.actovia', 'logs'), { recursive: true })
}

export async function createNewProject(name: string): Promise<Project> {
  const { projectsDir } = await agentSettings()
  await mkdir(projectsDir, { recursive: true })
  const dir = await uniqueDir(projectsDir, name)
  await makeMeta(dir)
  const project = await createProject({
    name: name.trim() || basename(dir),
    dir,
    workDir: dir
  })
  await writeProjectJson(project)
  return project
}

export async function openFolderAsProject(folder: string): Promise<Project> {
  const workDir = await assertWorkableFolder(folder)
  const { projectsDir } = await agentSettings()
  const existing = (await listRecentProjects(1000)).find(
    (p) => p.workDir === workDir
  )
  if (existing) return updateProject(existing.id, { lastUsedAt: new Date() })
  await mkdir(projectsDir, { recursive: true })
  const name = basename(workDir)
  const dir = await uniqueDir(projectsDir, name)
  await makeMeta(dir)
  await symlink(workDir, join(dir, name))
  const project = await createProject({ name, dir, workDir })
  await writeProjectJson(project)
  return project
}

export async function bindConversation(
  conversationId: string,
  projectId: string | null
): Promise<void> {
  await updateConversation(conversationId, { projectId })
  if (!projectId) return
  const project = await getProjectById(projectId)
  if (!project) return
  await updateProject(projectId, { lastUsedAt: new Date() })
  await writeProjectJson(project, conversationId)
}

export async function writeSessionMeta(
  project: Pick<Project, 'dir'>,
  session: AgentSession
): Promise<void> {
  await mkdir(join(metaDir(project), 'sessions'), { recursive: true })
  await writeFile(
    join(metaDir(project), 'sessions', `${session.id}.json`),
    JSON.stringify(session, null, 2) + '\n'
  )
}

function git(
  cwd: string,
  args: string[]
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 15_000 }, (err, stdout, stderr) =>
      resolve({
        ok: !err,
        out: String(err ? stderr || err.message : stdout).trim()
      })
    )
  })
}

export async function gitBranch(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok && r.out !== 'HEAD' ? r.out : null
}

/** Spec §4: the folder itself, or — a second agent in a git repo — a worktree of its own. */
export async function prepareWorkDir(
  project: Project,
  sessionId: string,
  othersRunning: boolean
): Promise<{ cwd: string; branch: string | null; note: string | null }> {
  const inside = await git(project.workDir, [
    'rev-parse',
    '--is-inside-work-tree'
  ])
  if (!inside.ok || inside.out !== 'true')
    return { cwd: project.workDir, branch: null, note: 'not-git' }
  const current = await gitBranch(project.workDir)
  if (!project.useWorktrees || !othersRunning)
    return { cwd: project.workDir, branch: current, note: null }

  if (project.workDir === project.dir) {
    const gitDir = await git(project.workDir, ['rev-parse', '--git-dir'])
    const exclude = join(project.workDir, gitDir.out, 'info', 'exclude')
    const text = await readFile(exclude, 'utf8').catch(() => '')
    if (!/^\.actovia\/$/m.test(text)) {
      await mkdir(join(project.workDir, gitDir.out, 'info'), {
        recursive: true
      })
      await appendFile(
        exclude,
        `${text && !text.endsWith('\n') ? '\n' : ''}.actovia/\n`
      )
    }
  }
  const branch = `actovia/${sessionId.slice(0, 8)}`
  const cwd = join(metaDir(project), 'worktrees', sessionId)
  const added = await git(project.workDir, [
    'worktree',
    'add',
    '-b',
    branch,
    cwd
  ])
  if (!added.ok)
    return {
      cwd: project.workDir,
      branch: current,
      note: `worktree-failed: ${added.out}`
    }
  return { cwd, branch, note: null }
}

/** Where a group's `plan.md` lives: its project's meta (spec §4), else the group dir as before. */
export async function planDirFor(conversationId: string): Promise<string> {
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  if (!project) return getGroupDir(conversationId)
  await mkdir(metaDir(project), { recursive: true })
  return metaDir(project)
}
```

- [ ] **Step 4: Move `plan.md`** — in `plan-mirror.ts`, `writePlanMirror` starts with `const dir = getGroupDir(conversationId)`; make it `const dir = await planDirFor(conversationId)` (import from `../../agents/projects`). If `tests/unit/main/lib/ai/philharmonic/plan-mirror.test.ts` mocks `paths`, also mock `@main/lib/agents/projects` there: `planDirFor: async (id: string) => getGroupDir(id)` with the test's existing group dir.

- [ ] **Step 5: Run the projects and plan-mirror tests — expect PASS.**

Run: `bunx vitest run tests/unit/main/lib/agents/projects.test.ts tests/unit/main/lib/ai/philharmonic/plan-mirror.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/agents/projects.ts src/main/lib/ai/philharmonic/plan-mirror.ts tests/unit/main/lib/agents/projects.test.ts tests/unit/main/lib/ai/philharmonic/plan-mirror.test.ts
git commit -m "feat(agents): projects — a new folder or an opened one, the hidden .actovia meta in ~/Actovia Projects, an alias to an opened folder, a worktree for a second agent in a repo; a group's plan.md moves into its project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The registry — running limit, one step at a time per employee, keep-alive, quit

**Files:**

- Create: `src/main/lib/agents/registry.ts`
- Test: `tests/unit/main/lib/agents/registry.test.ts`

**Interfaces:**

- Consumes: `AgentRun` (Task 5), `agentSettings()` (Task 4).
- Produces: `class AgentRegistry` and the app's instance `agentRegistry`:
  - `constructor(deps: { maxRunning(): Promise<number>; keepAliveMs(): Promise<number> })`
  - `acquireSlot(signal?: AbortSignal): Promise<() => void>` — resolves when fewer than `maxRunning` turns are in flight; the returned function releases (idempotent); rejects with `signal.reason` if aborted while waiting
  - `queue<T>(key: string, fn: () => Promise<T>): Promise<T>` — FIFO per key (`<projectId>:<agentId>`), so one employee never runs two steps in one project at once; a rejected `fn` does not block the next
  - `attach(key: string, sessionId: string, projectId: string, run: AgentRun): void` — on the run's `exit`, forgets it
  - `live(key: string): AgentRun | undefined` — only an `alive` run
  - `bySession(sessionId: string): AgentRun | undefined`
  - `runningInProject(projectId: string): number` — attached runs that are `alive && busy`
  - `scheduleIdleExit(key: string): void` / `cancelIdleExit(key: string): void` — after `keepAliveMs`, `stop()` the run if not `busy`; 0 = stop at once
  - `stopSession(sessionId: string): Promise<void>`
  - `stopAll(): Promise<void>` — `interrupt()` then `stop()` every live run, in parallel

- [ ] **Step 1: Write the failing test**

```ts
import type { AgentEvent, AgentRun } from '@main/lib/agents/driver'
// tests/unit/main/lib/agents/registry.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/agents/settings', () => ({
  agentSettings: async () => ({ maxRunning: 2, keepAliveMinutes: 10 })
}))
const { AgentRegistry } = await import('@main/lib/agents/registry')

function fakeRun(): AgentRun & {
  fire(e: AgentEvent): void
  stops: number
  interrupts: number
  busyFlag: boolean
} {
  const listeners = new Set<(e: AgentEvent) => void>()
  const run = {
    cliSessionId: 'x',
    alive: true,
    busyFlag: false,
    get busy() {
      return run.busyFlag
    },
    stops: 0,
    interrupts: 0,
    on(l: (e: AgentEvent) => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    send: () => true,
    respond: () => true,
    interrupt() {
      run.interrupts++
      return true
    },
    async stop() {
      run.stops++
      run.alive = false
      run.fire({ type: 'exit', code: 0, stderrTail: '', expected: true })
    },
    fire(e: AgentEvent) {
      for (const l of [...listeners]) l(e)
    }
  }
  return run as never
}

const registry = (max = 2, keepMs = 1000) =>
  new AgentRegistry({
    maxRunning: async () => max,
    keepAliveMs: async () => keepMs
  })

afterEach(() => vi.useRealTimers())

describe('agent registry', () => {
  it('lets no more than the limit through, and the next in when one releases', async () => {
    const r = registry(2)
    const a = await r.acquireSlot()
    await r.acquireSlot()
    let third = false
    const pending = r.acquireSlot().then((release) => {
      third = true
      return release
    })
    await Promise.resolve()
    expect(third).toBe(false)
    a()
    a() // releasing twice frees one slot, not two
    await pending
    expect(third).toBe(true)
  })

  it('gives up waiting when aborted', async () => {
    const r = registry(1)
    await r.acquireSlot()
    const ctrl = new AbortController()
    const waiting = r.acquireSlot(ctrl.signal)
    ctrl.abort(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
  })

  it('runs one step at a time per employee and project, in order, past a failure', async () => {
    const r = registry()
    const order: string[] = []
    const slow =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<void>((ok, no) =>
          setTimeout(() => {
            order.push(name)
            fail ? no(new Error(name)) : ok()
          }, ms)
        )
    const first = r.queue('p:a', slow('first', 30, true))
    const second = r.queue('p:a', slow('second', 1))
    const other = r.queue('p:b', slow('other', 1))
    await expect(first).rejects.toThrow('first')
    await Promise.all([second, other])
    expect(order).toEqual(['other', 'first', 'second'])
  })

  it('finds a live run by key and by session, and forgets it when it exits', async () => {
    const r = registry()
    const run = fakeRun()
    r.attach('p:a', 's1', 'p', run)
    expect(r.live('p:a')).toBe(run)
    expect(r.bySession('s1')).toBe(run)
    run.alive = false
    run.fire({ type: 'exit', code: 1, stderrTail: '', expected: false })
    expect(r.live('p:a')).toBeUndefined()
    expect(r.bySession('s1')).toBeUndefined()
  })

  it('counts the busy runs of a project', () => {
    const r = registry()
    const a = fakeRun()
    const b = fakeRun()
    r.attach('p:a', 's1', 'p', a)
    r.attach('p:b', 's2', 'p', b)
    a.busyFlag = true
    expect(r.runningInProject('p')).toBe(1)
    expect(r.runningInProject('other')).toBe(0)
  })

  it('stops an idle run after the keep-alive, not a busy one, and not one picked up again', async () => {
    vi.useFakeTimers()
    const r = registry(2, 1000)
    const idle = fakeRun()
    const busy = fakeRun()
    const reused = fakeRun()
    r.attach('k1', 's1', 'p', idle)
    r.attach('k2', 's2', 'p', busy)
    r.attach('k3', 's3', 'p', reused)
    busy.busyFlag = true
    r.scheduleIdleExit('k1')
    r.scheduleIdleExit('k2')
    r.scheduleIdleExit('k3')
    await vi.advanceTimersByTimeAsync(10)
    r.cancelIdleExit('k3')
    await vi.advanceTimersByTimeAsync(1000)
    expect(idle.stops).toBe(1)
    expect(busy.stops).toBe(0)
    expect(reused.stops).toBe(0)
  })

  it('stops everything at quit, interrupting first', async () => {
    const r = registry()
    const a = fakeRun()
    const b = fakeRun()
    r.attach('k1', 's1', 'p', a)
    r.attach('k2', 's2', 'p', b)
    await r.stopAll()
    expect([a.interrupts, a.stops, b.interrupts, b.stops]).toEqual([1, 1, 1, 1])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/registry.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/lib/agents/registry.ts
import type { AgentRun } from './driver'
import { agentSettings } from './settings'

interface Entry {
  run: AgentRun
  sessionId: string
  projectId: string
  idleTimer?: ReturnType<typeof setTimeout>
  /** Set by `cancelIdleExit`; a timer armed after the cancel (the settings read is async) checks it. */
  idleCancelled?: boolean
}

/** Live agent runs (spec §8): the running limit, one step at a time per employee and project, the keep-alive, quit. */
export class AgentRegistry {
  private entries = new Map<string, Entry>()
  private queues = new Map<string, Promise<unknown>>()
  private inFlight = 0
  private waiters: Array<() => void> = []

  constructor(
    private deps: {
      maxRunning(): Promise<number>
      keepAliveMs(): Promise<number>
    }
  ) {}

  async acquireSlot(signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason
      if (this.inFlight < (await this.deps.maxRunning())) break
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          this.waiters = this.waiters.filter((w) => w !== wake)
          reject(signal!.reason)
        }
        this.waiters.push(wake)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    this.inFlight++
    let released = false
    return () => {
      if (released) return
      released = true
      this.inFlight--
      this.waiters.shift()?.()
    }
  }

  queue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(fn)
    const tail = next.catch(() => undefined)
    this.queues.set(key, tail)
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return next
  }

  attach(
    key: string,
    sessionId: string,
    projectId: string,
    run: AgentRun
  ): void {
    this.entries.set(key, { run, sessionId, projectId })
    const off = run.on((e) => {
      if (e.type !== 'exit') return
      off()
      const entry = this.entries.get(key)
      if (entry?.run === run) {
        clearTimeout(entry.idleTimer)
        this.entries.delete(key)
      }
    })
  }

  live(key: string): AgentRun | undefined {
    const run = this.entries.get(key)?.run
    return run?.alive ? run : undefined
  }

  bySession(sessionId: string): AgentRun | undefined {
    for (const e of this.entries.values())
      if (e.sessionId === sessionId && e.run.alive) return e.run
    return undefined
  }

  runningInProject(projectId: string): number {
    let n = 0
    for (const e of this.entries.values())
      if (e.projectId === projectId && e.run.alive && e.run.busy) n++
    return n
  }

  scheduleIdleExit(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    clearTimeout(entry.idleTimer)
    entry.idleCancelled = false
    void this.deps.keepAliveMs().then((ms) => {
      if (this.entries.get(key) !== entry || entry.idleCancelled) return
      entry.idleTimer = setTimeout(() => {
        if (!entry.idleCancelled && !entry.run.busy) void entry.run.stop()
      }, ms)
    })
  }

  cancelIdleExit(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.idleCancelled = true
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  async stopSession(sessionId: string): Promise<void> {
    for (const e of this.entries.values())
      if (e.sessionId === sessionId) await e.run.stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (e) => {
        e.run.interrupt()
        await e.run.stop()
      })
    )
  }
}

export const agentRegistry = new AgentRegistry({
  maxRunning: async () => (await agentSettings()).maxRunning,
  keepAliveMs: async () => (await agentSettings()).keepAliveMinutes * 60_000
})
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/agents/registry.ts tests/unit/main/lib/agents/registry.test.ts
git commit -m "feat(agents): the registry — at most N agent turns at once, one step at a time per employee and project, idle processes stopped after the keep-alive, all stopped at quit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: A step run by a CLI employee, wired into Philharmonic

**Files:**

- Create: `src/main/lib/agents/run-agent-employee.ts`
- Modify: `src/main/lib/ai/philharmonic/execution-engine.ts` (l.29-66: the return type and the runtime branch)
- Modify: `src/main/lib/ai/philharmonic/pm-coordinator.ts` (l.~257-330 the delegate callback; l.~140 the roster)
- Test: `tests/unit/main/lib/agents/run-agent-employee.test.ts`; update `tests/unit/main/lib/ai/philharmonic/execution-engine.test.ts` and `pm-coordinator.test.ts` for the new return shape

**Interfaces:**

- Consumes: everything from Tasks 2–9; `SseEmitter` (`employee-loop.ts:29`); `emitToConversation` (`server/routes/philharmonic-sse.ts`); `updateTask` (`philharmonic-queries.ts`); `notifyIfBackground` (`philharmonic-notifications.ts`); `mainT(key, default, vars)` (`src/main/lib/i18n.ts`).
- Produces:
  - `interface DelegatedOutput { output: string; parts?: Record<string, unknown>[]; sessionId?: string }` (exported from `execution-engine.ts`)
  - `runDelegatedTask(args): Promise<DelegatedOutput>` (was `Promise<string>`)
  - `runAgentEmployee(args: RunAgentEmployeeArgs, deps?: RunAgentEmployeeDeps): Promise<DelegatedOutput>` with
    `interface RunAgentEmployeeArgs { agent: Agent; instructions: string; taskId: string; conversationId: string; emit: SseEmitter; signal?: AbortSignal }` and
    `interface RunAgentEmployeeDeps { start(input: StartInput): AgentRun; registry: AgentRegistry; cliStatus(): Promise<CliStatus>; env(): Promise<Record<string, string>> }`
  - `formatAgentOutput(card: AgentCard, sessionId: string): string` — what the PM reads
  - `agentCardMessageText(card: AgentCard): string` — the message's `content` (the card's text)

Flow of `runAgentEmployee` (spec §5):

1. The group's project: `getConversationById` → `projectId` → `getProjectById`; none → throw `Error('This group has no folder. Choose one in the composer before giving Claude Code a step.')`.
2. `cliStatus()`; not `ready` → throw `Error(\`Claude Code is not ready (\${state}): \${detail ?? ''}\`)`.
3. `key = \`\${project.id}:\${agent.id}\``; everything below runs inside `registry.queue(key, …)`.
4. `messageId = uuidV4()`; `emit message_start` (role `employee`, `agentId`); a card with `queued: true` is emitted until `acquireSlot(signal)` returns.
5. Session: `findResumableSession(project.id, agent.id)`. Reuse `registry.live(key)` when alive (`cancelIdleExit`); else start a process — `cwd`/`branch` from the session row when it exists (Claude Code resumes per directory), else `prepareWorkDir(project, newId, registry.runningInProject(project.id) > 0)`. A new session row is created **before** the process with `state: 'working'`; an existing one is updated to `working`, `continuedInTerminal: false`. `writeSessionMeta` after each state change.
6. `run.send(prompt)` where `prompt = agent.systemPrompt?.trim() ? \`\${agent.systemPrompt.trim()}\n\n\${instructions}\` : instructions`.
7. Listen: every event → `card = applyAgentEvent(card, e)` → emit `agent_card` throttled to one per 40 ms (always the latest; flush on `turn_end`, `blocked`, `exit`). `init` → store `cliSessionId`. `blocked` → `updateTask(taskId, { status: 'waiting_for_user' })`, session `blocked`, `notifyIfBackground` with title `mainT('philharmonic:agents.notify.waitingTitle', '{{name}} is waiting for you', { name: agent.name })` and body = the prompt's summary or first question. `answered` (no prompts left) → task `running`, session `working`. `turn_end` → resolve. `exit` before `turn_end` → reject `Error(card.error ?? 'Claude Code stopped')`.
8. `signal` abort → `run.interrupt()`; the step resolves when the interrupted `turn_end` arrives.
9. Finally (always): release the slot; `emit message_end`; session state = card state (`done`/`stopped`/`error`); `registry.scheduleIdleExit(key)`.
10. After the step resolved, the listener stays while the process lives: an **unprompted turn** keeps folding into the card; once the session row has a `messageId` (set by the PM callback), each update is written with `updateConversationMessageParts(messageId, [card])` and emitted with `emitToConversation(conversationId, { type: 'agent_card', conversationId, messageId, card })`.

Return `{ output: formatAgentOutput(card, session.id), parts: [card], sessionId: session.id }`, where `formatAgentOutput` is:

```
[Claude Code · done]                      ← the card's state
<cardText(card), or "(no reply)">
Files changed: a.ts, b.ts                 ← touchedFiles; line omitted when none
The owner denied 1 request.               ← omitted when 0
Session: <session id>
```

- [ ] **Step 1: Write the failing test**

```ts
import type { AgentEvent, AgentRun, StartInput } from '@main/lib/agents/driver'
// tests/unit/main/lib/agents/run-agent-employee.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const updateTask = vi.fn()
const notify = vi.fn()
const sessions = new Map<string, Record<string, unknown>>()
let resumable: Record<string, unknown> | undefined
vi.mock('@main/lib/db/philharmonic-queries', () => ({ updateTask }))
vi.mock('@main/lib/philharmonic-notifications', () => ({
  notifyIfBackground: notify
}))
vi.mock('@main/lib/i18n', () => ({
  mainT: (_k: string, d: string, v?: Record<string, string>) =>
    d.replace('{{name}}', v?.name ?? '')
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn()
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async (id: string) =>
    id === 'no-folder' ? { id, projectId: null } : { id, projectId: 'p1' },
  updateConversationMessageParts: vi.fn()
}))
vi.mock('@main/lib/db/project-queries', () => ({
  getProjectById: async () => ({
    id: 'p1',
    name: 'notes',
    dir: '/x/notes',
    workDir: '/x/notes',
    useWorktrees: true
  })
}))
vi.mock('@main/lib/db/agent-session-queries', () => ({
  findResumableSession: async () => resumable,
  createAgentSession: async (d: Record<string, unknown>) => {
    const row = { id: 'sess-1', ...d }
    sessions.set('sess-1', row)
    return row
  },
  updateAgentSession: async (id: string, d: Record<string, unknown>) =>
    Object.assign(
      sessions.get(id) ?? (sessions.set(id, { id }), sessions.get(id))!,
      d
    ),
  getAgentSession: async (id: string) => sessions.get(id)
}))
vi.mock('@main/lib/agents/projects', () => ({
  prepareWorkDir: async () => ({ cwd: '/x/notes', branch: 'main', note: null }),
  sessionLogPath: () => '/x/notes/.actovia/logs/s.jsonl',
  writeSessionMeta: async () => {}
}))

const { AgentRegistry } = await import('@main/lib/agents/registry')
const { runAgentEmployee, formatAgentOutput } =
  await import('@main/lib/agents/run-agent-employee')

interface FakeRun {
  cliSessionId: string | null
  alive: boolean
  busy: boolean
  sent: string[]
  interrupted: number
  on(l: (e: AgentEvent) => void): () => void
  send(text: string): boolean
  respond(): boolean
  interrupt(): boolean
  stop(): Promise<void>
  fire(e: AgentEvent): void
}
function makeRun(script: (run: FakeRun) => void): FakeRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const run: FakeRun = {
    cliSessionId: null as string | null,
    alive: true,
    busy: false,
    sent: [] as string[],
    interrupted: 0,
    on(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    send(text) {
      run.sent.push(text)
      run.busy = true
      queueMicrotask(() => script(run))
      return true
    },
    respond: () => true,
    interrupt() {
      run.interrupted++
      queueMicrotask(() =>
        run.fire({
          type: 'turn_end',
          ok: false,
          interrupted: true,
          text: '',
          costUsd: null,
          denials: 0
        })
      )
      return true
    },
    async stop() {
      run.alive = false
    },
    fire(e: AgentEvent) {
      if (e.type === 'init') run.cliSessionId = e.cliSessionId
      if (e.type === 'turn_end') run.busy = false
      for (const l of [...listeners]) l(e)
    }
  }
  return run
}

const agent = {
  id: 'a1',
  name: 'Claude Code',
  systemPrompt: 'You review.',
  model: 'opus',
  permissionMode: null,
  runtime: 'claude-code'
} as never
const ready = async () =>
  ({
    id: 'claude-code',
    state: 'ready',
    path: '/bin/claude',
    version: '2.1.294',
    authMethod: 'claude.ai',
    detail: null,
    checkedAt: 0
  }) as never

function deps(run: ReturnType<typeof makeRun>, starts: StartInput[] = []) {
  return {
    start: (input: StartInput) => {
      starts.push(input)
      return run as unknown as AgentRun
    },
    registry: new AgentRegistry({
      maxRunning: async () => 2,
      keepAliveMs: async () => 60_000
    }),
    cliStatus: ready,
    env: async () => ({ PATH: '/bin' })
  }
}

beforeEach(() => {
  sessions.clear()
  resumable = undefined
  updateTask.mockClear()
  notify.mockClear()
})

const happy = (run: FakeRun) => {
  run.fire({ type: 'init', cliSessionId: 'cli-1', model: 'opus' })
  run.fire({
    type: 'step_start',
    id: 't1',
    tool: 'Write',
    summary: 'index.html'
  })
  run.fire({ type: 'step_end', id: 't1', isError: false })
  run.fire({ type: 'text', text: 'Built it.' })
  run.fire({
    type: 'turn_end',
    ok: true,
    interrupted: false,
    text: 'Built it.',
    costUsd: 0.02,
    denials: 0
  })
}

describe('runAgentEmployee', () => {
  it('refuses a group without a folder', async () => {
    const run = makeRun(happy)
    await expect(
      runAgentEmployee(
        {
          agent,
          instructions: 'x',
          taskId: 't',
          conversationId: 'no-folder',
          emit: vi.fn()
        },
        deps(run)
      )
    ).rejects.toThrow(/no folder/)
  })

  it('refuses when Claude Code is not ready, with its state', async () => {
    const run = makeRun(happy)
    const d = {
      ...deps(run),
      cliStatus: async () =>
        ({ state: 'logged_out', detail: 'run claude' }) as never
    }
    await expect(
      runAgentEmployee(
        {
          agent,
          instructions: 'x',
          taskId: 't',
          conversationId: 'c',
          emit: vi.fn()
        },
        d
      )
    ).rejects.toThrow(/logged_out/)
  })

  it('runs a step: the instructions after the employee’s own, a card streamed, the PM told what happened', async () => {
    const run = makeRun(happy)
    const emit = vi.fn()
    const starts: StartInput[] = []
    const out = await runAgentEmployee(
      {
        agent,
        instructions: 'Build a page',
        taskId: 't',
        conversationId: 'c',
        emit
      },
      deps(run, starts)
    )
    expect(run.sent).toEqual(['You review.\n\nBuild a page'])
    expect(starts[0]).toMatchObject({
      cwd: '/x/notes',
      model: 'opus',
      permissionMode: 'default',
      resume: null
    })
    const types = emit.mock.calls.map((c) => c[0].type)
    expect(types[0]).toBe('message_start')
    expect(types).toContain('agent_card')
    expect(types.at(-1)).toBe('message_end')
    expect(out.output).toBe(
      '[Claude Code · done]\nBuilt it.\nFiles changed: index.html\nSession: sess-1'
    )
    expect(out.parts?.[0]).toMatchObject({ kind: 'agent_card', state: 'done' })
    expect(sessions.get('sess-1')).toMatchObject({
      cliSessionId: 'cli-1',
      state: 'done'
    })
  })

  it('resumes the employee’s last session in its own folder', async () => {
    resumable = {
      id: 'sess-old',
      cliSessionId: 'cli-old',
      cwd: '/x/notes/.actovia/worktrees/w',
      branch: 'actovia/w'
    }
    sessions.set('sess-old', { ...resumable })
    const run = makeRun(happy)
    const starts: StartInput[] = []
    await runAgentEmployee(
      {
        agent,
        instructions: 'Add tests',
        taskId: 't',
        conversationId: 'c',
        emit: vi.fn()
      },
      deps(run, starts)
    )
    expect(starts[0]).toMatchObject({
      resume: 'cli-old',
      cwd: '/x/notes/.actovia/worktrees/w'
    })
  })

  it('waits for the owner: the task is waiting, a notification goes out, and work resumes on the answer', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.fire({
        type: 'blocked',
        prompt: {
          kind: 'permission',
          requestId: 'q1',
          tool: 'Bash',
          summary: 'npm install'
        }
      })
      setTimeout(() => {
        r.fire({ type: 'answered', requestId: 'q1' })
        r.fire({
          type: 'turn_end',
          ok: true,
          interrupted: false,
          text: 'ok',
          costUsd: null,
          denials: 0
        })
      }, 5)
    })
    await runAgentEmployee(
      {
        agent,
        instructions: 'x',
        taskId: 'task-9',
        conversationId: 'c',
        emit: vi.fn()
      },
      deps(run)
    )
    expect(updateTask).toHaveBeenCalledWith('task-9', {
      status: 'waiting_for_user'
    })
    expect(updateTask).toHaveBeenCalledWith('task-9', { status: 'running' })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Claude Code is waiting for you',
        body: 'npm install'
      })
    )
  })

  it('interrupts when the group is stopped, and reports it stopped', async () => {
    const run = makeRun((r) =>
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
    )
    const ctrl = new AbortController()
    const pending = runAgentEmployee(
      {
        agent,
        instructions: 'x',
        taskId: 't',
        conversationId: 'c',
        emit: vi.fn(),
        signal: ctrl.signal
      },
      deps(run)
    )
    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()
    const out = await pending
    expect(run.interrupted).toBe(1)
    expect(out.output.startsWith('[Claude Code · stopped]')).toBe(true)
  })

  it('fails the step when the process dies mid-turn', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.alive = false
      r.fire({ type: 'exit', code: 1, stderrTail: 'boom', expected: false })
    })
    await expect(
      runAgentEmployee(
        {
          agent,
          instructions: 'x',
          taskId: 't',
          conversationId: 'c',
          emit: vi.fn()
        },
        deps(run)
      )
    ).rejects.toThrow('boom')
    expect(sessions.get('sess-1')).toMatchObject({ state: 'error' })
  })

  it('formats what the PM reads', () => {
    const card = {
      state: 'done',
      blocks: ['Done.'],
      pending: '',
      steps: [],
      denials: 2
    } as never
    expect(formatAgentOutput(card, 's')).toBe(
      '[Claude Code · done]\nDone.\nThe owner denied 2 requests.\nSession: s'
    )
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/run-agent-employee.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/main/lib/agents/run-agent-employee.ts
import type {
  AgentCard,
  CliStatus,
  PermissionMode
} from '@actovia/shared/types/agents'
import { CLI_NAMES } from '@actovia/shared/types/agents'
import { v4 as uuidV4 } from 'uuid'

import type { SseEmitter } from '../ai/philharmonic/employee-loop'
import {
  createAgentSession,
  findResumableSession,
  getAgentSession,
  updateAgentSession
} from '../db/agent-session-queries'
import {
  getConversationById,
  updateConversationMessageParts
} from '../db/conversation-queries'
import { updateTask } from '../db/philharmonic-queries'
import { getProjectById } from '../db/project-queries'
import type { Agent, AgentSession } from '../db/schema'
import { mainT } from '../i18n'
import { notifyIfBackground } from '../philharmonic-notifications'
import { emitToConversation } from '../server/routes/philharmonic-sse'
import { applyAgentEvent, cardText, newCard, touchedFiles } from './card'
import { startClaudeCode } from './claude-code/run'
import { getCliStatus } from './cli-check'
import type { AgentRun, StartInput } from './driver'
import { loginShellEnv } from './login-shell'
import { prepareWorkDir, sessionLogPath, writeSessionMeta } from './projects'
import { AgentRegistry, agentRegistry } from './registry'

export interface DelegatedOutput {
  output: string
  parts?: Record<string, unknown>[]
  sessionId?: string
}

export interface RunAgentEmployeeArgs {
  agent: Agent
  instructions: string
  taskId: string
  conversationId: string
  emit: SseEmitter
  signal?: AbortSignal
}

export interface RunAgentEmployeeDeps {
  start(input: StartInput): AgentRun
  registry: AgentRegistry
  cliStatus(): Promise<CliStatus>
  env(): Promise<Record<string, string>>
}

const defaultDeps: RunAgentEmployeeDeps = {
  start: startClaudeCode,
  registry: agentRegistry,
  cliStatus: () => getCliStatus('claude-code'),
  env: loginShellEnv
}

const THROTTLE_MS = 40

export function formatAgentOutput(card: AgentCard, sessionId: string): string {
  const lines = [
    `[${CLI_NAMES['claude-code']} · ${card.state}]`,
    cardText(card) || '(no reply)'
  ]
  const files = touchedFiles(card)
  if (files.length) lines.push(`Files changed: ${files.join(', ')}`)
  if (card.denials)
    lines.push(
      `The owner denied ${card.denials} request${card.denials === 1 ? '' : 's'}.`
    )
  lines.push(`Session: ${sessionId}`)
  return lines.join('\n')
}

export const agentCardMessageText = (card: AgentCard) => cardText(card)

export async function runAgentEmployee(
  args: RunAgentEmployeeArgs,
  deps: RunAgentEmployeeDeps = defaultDeps
): Promise<DelegatedOutput> {
  const { agent, instructions, taskId, conversationId, emit, signal } = args
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  if (!project)
    throw new Error(
      'This group has no folder. Choose one in the composer before giving Claude Code a step.'
    )
  const status = await deps.cliStatus()
  if (status.state !== 'ready' || !status.path) {
    throw new Error(
      `Claude Code is not ready (${status.state}): ${status.detail ?? ''}`.trim()
    )
  }
  const binPath = status.path
  const key = `${project.id}:${agent.id}`

  return deps.registry.queue(key, async () => {
    const messageId = uuidV4()
    emit({
      type: 'message_start',
      conversationId,
      messageId,
      role: 'employee',
      agentId: agent.id
    })
    let sessionId: string | null = null
    let card: AgentCard | null = null
    let release: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastEmit = 0

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      lastEmit = Date.now()
      if (card) emit({ type: 'agent_card', conversationId, messageId, card })
    }
    const throttled = () => {
      const wait = THROTTLE_MS - (Date.now() - lastEmit)
      if (wait <= 0) return flush()
      timer ??= setTimeout(flush, wait)
    }

    try {
      // The session row first: its id names the worktree and the log.
      const previous = await findResumableSession(project.id, agent.id)
      const session = previous
        ? await updateAgentSession(previous.id, {
            state: 'working',
            continuedInTerminal: false,
            conversationId
          })
        : await (async () => {
            const id = uuidV4()
            const w = await prepareWorkDir(
              project,
              id,
              deps.registry.runningInProject(project.id) > 0
            )
            return createAgentSession({
              id,
              projectId: project.id,
              agentId: agent.id,
              conversationId,
              runtime: 'claude-code',
              cwd: w.cwd,
              branch: w.branch,
              state: 'working'
            })
          })()
      sessionId = session.id
      card = {
        ...newCard({
          sessionId: session.id,
          agentId: agent.id,
          runtime: 'claude-code',
          model: agent.model ?? null,
          projectName: project.name,
          cwd: session.cwd,
          branch: session.branch ?? null
        }),
        queued: true
      }
      flush()
      release = await deps.registry.acquireSlot(signal)
      card = { ...card, queued: false }
      flush()

      let run = deps.registry.live(key)
      if (run) {
        deps.registry.cancelIdleExit(key)
      } else {
        run = deps.start({
          binPath,
          cwd: session.cwd,
          env: await deps.env(),
          model: agent.model,
          permissionMode:
            (agent.permissionMode as PermissionMode | null) ?? 'default',
          resume: previous?.cliSessionId ?? null,
          logPath: sessionLogPath(project, session.id)
        })
        deps.registry.attach(key, session.id, project.id, run)
      }
      await writeSessionMeta(project, session)

      const liveRun = run
      const prompt = agent.systemPrompt?.trim()
        ? `${agent.systemPrompt.trim()}\n\n${instructions}`
        : instructions
      let stepDone = false

      const result = new Promise<void>((resolve, reject) => {
        const off = liveRun.on((e) => {
          card = applyAgentEvent(card!, e)
          if (stepDone) {
            // An unprompted turn after the step (spec §2.1): keep the persisted card current.
            const latest = card
            void getAgentSession(session.id).then((row) => {
              if (!row?.messageId) return
              void updateConversationMessageParts(row.messageId, [
                latest as never
              ])
              emitToConversation(conversationId, {
                type: 'agent_card',
                conversationId,
                messageId: row.messageId,
                card: latest
              })
            })
            if (e.type === 'exit') off()
            return
          }
          switch (e.type) {
            case 'init':
              void updateAgentSession(session.id, {
                cliSessionId: e.cliSessionId
              })
              throttled()
              break
            case 'blocked': {
              flush()
              void updateTask(taskId, { status: 'waiting_for_user' })
              void updateAgentSession(session.id, { state: 'blocked' })
              const p = e.prompt
              notifyIfBackground({
                title: mainT(
                  'philharmonic:agents.notify.waitingTitle',
                  '{{name}} is waiting for you',
                  { name: agent.name }
                ),
                body:
                  p.kind === 'permission'
                    ? p.summary || p.tool
                    : (p.questions[0]?.question ?? '')
              })
              break
            }
            case 'answered':
              throttled()
              if (card!.prompts.length === 0) {
                void updateTask(taskId, { status: 'running' })
                void updateAgentSession(session.id, { state: 'working' })
              }
              break
            case 'turn_end':
              flush()
              stepDone = true
              resolve()
              break
            case 'exit':
              flush()
              off()
              reject(new Error(card!.error ?? 'Claude Code stopped'))
              break
            default:
              throttled()
          }
        })
      })

      const onAbort = () => liveRun.interrupt()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        if (!liveRun.send(prompt)) throw new Error('Claude Code is not running')
        await result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
      return {
        output: formatAgentOutput(card, session.id),
        parts: [card as never],
        sessionId: session.id
      }
    } finally {
      release?.()
      if (timer) clearTimeout(timer)
      if (sessionId) {
        const state =
          !card || card.state === 'working' || card.state === 'blocked'
            ? 'error'
            : card.state
        const row = await updateAgentSession(sessionId, { state })
        await writeSessionMeta(project, row)
      }
      emit({ type: 'message_end', conversationId, messageId })
      deps.registry.scheduleIdleExit(key)
    }
  })
}
```

- [ ] **Step 4: Branch in the execution engine** — `execution-engine.ts`: export `DelegatedOutput` from `../../agents/run-agent-employee` (re-export), change the return type to `Promise<DelegatedOutput>`, and replace the `withRetry(() => runEmployeeLoop(...))` call with:

```ts
const outcome: DelegatedOutput =
  agent.runtime === 'actovia'
    ? {
        output: await withRetry(
          () =>
            runEmployeeLoop({
              agent,
              instructions,
              executionId: execution.id,
              conversationId,
              emit,
              signal
            }),
          { policy, signal, onRetry /* unchanged */ }
        )
      }
    : // A CLI step is never retried: a second run would redo the work.
      await runAgentEmployee({
        agent,
        instructions,
        taskId,
        conversationId,
        emit,
        signal
      })
const output = outcome.output
```

Everything after (task completed, `rememberTaskOutcome(... output ...)`) keeps using `output`; return `outcome` at the end instead of `output`.

- [ ] **Step 5: Persist the card** — in `pm-coordinator.ts`'s delegate callback:

```ts
const { output, parts, sessionId } = await runDelegatedTask({/* unchanged */})
const message = await createConversationMessage({
  conversationId,
  role: 'employee',
  agentId: employeeId,
  content: output,
  parts: parts ?? null,
  taskId: childTask.id
})
if (sessionId) await updateAgentSession(sessionId, { messageId: message.id })
```

(import `updateAgentSession` from `../../db/agent-session-queries`). The rest of the callback (`updateStep(... output)`, `return output`) is unchanged.

- [ ] **Step 6: Tell the PM who is a coding agent** — where the roster is built for `createDelegateTaskTool` (`employees.map((e) => ({ id, name, description }))`), describe CLI employees:

```ts
      employees.map((e) => ({
        id: e.id,
        name: e.name,
        description:
          e.runtime === 'actovia'
            ? e.description
            : `${e.description ?? ''} [Coding agent — Claude Code on the owner's machine; it works in this group's folder${conversationRow?.projectId ? '' : ' — UNAVAILABLE: this group has no folder yet'}. Give it whole tasks with a clear "done"; its reply says what it changed.]`.trim()
      })),
```

- [ ] **Step 7: Update the existing engine and coordinator tests** for `DelegatedOutput` (`expect(result).toBe('x')` → `expect(result.output).toBe('x')`; mocks of `runDelegatedTask` return `{ output: 'x' }`), add `runtime: 'actovia'` to their agent fixtures, and mock `@main/lib/agents/run-agent-employee` in the engine test with one case asserting a `claude-code` agent goes there and is not retried.

- [ ] **Step 8: Run all Philharmonic and agents tests — expect PASS**

Run: `bunx vitest run tests/unit/main/lib/agents tests/unit/main/lib/ai/philharmonic`

- [ ] **Step 9: Commit**

```bash
git add src/main/lib/agents/run-agent-employee.ts src/main/lib/ai/philharmonic/execution-engine.ts src/main/lib/ai/philharmonic/pm-coordinator.ts tests/unit/main/lib/agents/run-agent-employee.test.ts tests/unit/main/lib/ai/philharmonic
git commit -m "feat(philharmonic): a step for a Claude Code employee runs the owner's CLI in the group's folder — queued behind the running limit, resumed per employee, a live card persisted with the message, the owner notified when it waits, never retried

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Server routes, Terminal, quit — and the 409 when a prompt is gone

**Files:**

- Create: `src/main/lib/agents/terminal.ts`
- Create: `src/main/lib/server/routes/agents.ts`, `src/main/lib/server/routes/projects.ts`
- Modify: `src/main/lib/server/app.ts:115-146` (mount both)
- Modify: `packages/shared/src/constants/error-codes.ts` (two codes, status 409, default messages) and `packages/shared/src/i18n/locales/*/errors.json` (`code.AGENT_PROMPT_GONE`, `code.AGENT_NOT_RUNNING` in every locale)
- Modify: `src/main/main.ts` (after `runMigrate()` ~l.86; in `will-quit` ~l.228)
- Test: `tests/unit/main/lib/agents/terminal.test.ts`, `tests/unit/main/lib/server/routes/agents.test.ts`

**Interfaces:**

- Consumes: `agentRegistry`, `getCliStatus`, `resetLoginShellEnv`, projects (Task 8), session queries (Task 2), `emitToConversation`, `applyAgentEvent` is **not** needed here (the run emits `answered`, which the step's listener folds).
- Produces:
  - `shellQuote(s: string): string`, `appleScriptString(s: string): string`, `openInTerminal(cwd: string, binPath: string, cliSessionId: string): Promise<void>`
  - `ErrorCode.AGENT_PROMPT_GONE` ("This request was already answered, or Claude Code has moved on.") and `ErrorCode.AGENT_NOT_RUNNING` ("Claude Code is not running for this step."), both 409
  - Routes under `/api/v1/agents`:
    - `GET /clis` → `CliStatus[]`
    - `POST /clis/:id/check` → `CliStatus` (re-reads the login shell first)
    - `POST /sessions/:id/respond` body `{ requestId: string, answer: AgentAnswer }` → `{ success: true }`, or 409 `AGENT_PROMPT_GONE`
    - `POST /sessions/:id/interrupt` → `{ success: true }`, or 409 `AGENT_NOT_RUNNING`
    - `POST /sessions/:id/terminal` → `{ success: true }` — stops Actovia's process for that session first, opens Terminal, marks the session `continuedInTerminal`
    - `POST /sessions/:id/open-folder` → `{ success: true }` (`shell.openPath(cwd)`)
  - Routes under `/api/v1/projects`:
    - `GET /` → `Project[]` (recent)
    - `POST /` body `{ name }` → `Project`
    - `POST /pick` → `{ path: string | null }` (the system folder dialog, in main)
    - `POST /open` body `{ folder }` → `Project` (400 with the validation message for a refused folder)
    - `GET /conversations/:id` → `{ project: Project | null; missing: boolean; branch: string | null }`
    - `PUT /conversations/:id` body `{ projectId: string | null }` → `{ success: true }`
    - `PATCH /:id` body `{ useWorktrees: boolean }` → `Project`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  appleScriptString,
  shellQuote,
  terminalCommand
} from '@main/lib/agents/terminal'
// tests/unit/main/lib/agents/terminal.test.ts
import { describe, expect, it } from 'vitest'

describe('Continue in Terminal', () => {
  it('single-quotes for the shell, escaping single quotes', () => {
    expect(shellQuote("/Users/o/it's here")).toBe(`'/Users/o/it'\\''s here'`)
    expect(shellQuote('$(rm -rf ~)')).toBe(`'$(rm -rf ~)'`)
  })

  it('quotes for AppleScript, escaping backslashes and double quotes', () => {
    expect(appleScriptString('say "hi" \\ bye')).toBe(`"say \\"hi\\" \\\\ bye"`)
  })

  it('builds cd && claude --resume with everything quoted', () => {
    expect(terminalCommand('/p/my "repo"', '/bin/claude', 'abc-123')).toBe(
      `cd '/p/my "repo"' && '/bin/claude' --resume 'abc-123'`
    )
  })
})
```

```ts
// tests/unit/main/lib/server/routes/agents.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
  dialog: {}
}))
const respond = vi.fn()
const interrupt = vi.fn()
let live: { respond: typeof respond; interrupt: typeof interrupt } | undefined
vi.mock('@main/lib/agents/registry', () => ({
  agentRegistry: { bySession: () => live, stopSession: vi.fn(async () => {}) }
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  getCliStatus: vi.fn(async () => ({ id: 'claude-code', state: 'ready' }))
}))
vi.mock('@main/lib/agents/login-shell', () => ({ resetLoginShellEnv: vi.fn() }))
vi.mock('@main/lib/agents/terminal', () => ({
  openInTerminal: vi.fn(async () => {})
}))
vi.mock('@main/lib/db/agent-session-queries', () => ({
  getAgentSession: async () => ({
    id: 's1',
    cwd: '/p',
    cliSessionId: 'cli',
    conversationId: 'c'
  }),
  updateAgentSession: vi.fn(async () => ({}))
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation: vi.fn()
}))

const { Hono } = await import('hono')
const { errorHandler } = await import('@main/lib/server/middlewares')
const { default: agentsRouter } = await import('@main/lib/server/routes/agents')
const app = new Hono()
app.route('/', agentsRouter)
app.onError(errorHandler)

const post = (path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })

describe('agents routes', () => {
  it('passes an answer to the live run', async () => {
    live = { respond: respond.mockReturnValue(true), interrupt }
    const res = await post('/sessions/s1/respond', {
      requestId: 'r1',
      answer: { kind: 'deny', reason: 'no' }
    })
    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalledWith('r1', { kind: 'deny', reason: 'no' })
  })

  it('409s when the prompt was already answered or the run moved on', async () => {
    live = { respond: respond.mockReturnValue(false), interrupt }
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'allow' }
        })
      ).status
    ).toBe(409)
  })

  it('409s when nothing runs for the session', async () => {
    live = undefined
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'allow' }
        })
      ).status
    ).toBe(409)
    expect((await post('/sessions/s1/interrupt')).status).toBe(409)
  })

  it('rejects an answer of an unknown shape', async () => {
    live = { respond, interrupt }
    expect(
      (
        await post('/sessions/s1/respond', {
          requestId: 'r1',
          answer: { kind: 'yolo' }
        })
      ).status
    ).toBe(400)
  })
})
```

(`errorHandler`'s import path: use whatever `app.ts` imports it from — `app.ts:16` lists it with `lockGate`, `presenceGate`; import from the same module.)

- [ ] **Step 2: Run both — expect FAIL**

Run: `bunx vitest run tests/unit/main/lib/agents/terminal.test.ts tests/unit/main/lib/server/routes/agents.test.ts`

- [ ] **Step 3: Error codes** — in `error-codes.ts`, beside `ATTEMPT_LOCKED` in each of the three places (the enum ~l.100, the status map ~l.183 → `409`, the default-message map ~l.291):

```ts
  AGENT_PROMPT_GONE = 'AGENT_PROMPT_GONE',
  AGENT_NOT_RUNNING = 'AGENT_NOT_RUNNING'
  // status
  [ErrorCode.AGENT_PROMPT_GONE]: 409,
  [ErrorCode.AGENT_NOT_RUNNING]: 409,
  // messages
  [ErrorCode.AGENT_PROMPT_GONE]: 'This request was already answered, or Claude Code has moved on.',
  [ErrorCode.AGENT_NOT_RUNNING]: 'Claude Code is not running for this step.'
```

and in every `locales/*/errors.json` under `"code"`, beside `ATTEMPT_LOCKED`, the two keys (English text in `en`; a translation in each other locale, in that file's voice).

- [ ] **Step 4: `terminal.ts`**

```ts
// src/main/lib/agents/terminal.ts
import { execFile } from 'child_process'

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
export const appleScriptString = (s: string) =>
  `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
export const terminalCommand = (
  cwd: string,
  binPath: string,
  cliSessionId: string
) =>
  `cd ${shellQuote(cwd)} && ${shellQuote(binPath)} --resume ${shellQuote(cliSessionId)}`

/** Spec §5: the owner takes the session over by hand, in Terminal.app. */
export function openInTerminal(
  cwd: string,
  binPath: string,
  cliSessionId: string
): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script ${appleScriptString(terminalCommand(cwd, binPath, cliSessionId))}
end tell`
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], (err) =>
      err ? reject(err) : resolve()
    )
  )
}
```

- [ ] **Step 5: `routes/agents.ts`**

```ts
// src/main/lib/server/routes/agents.ts
import { ConflictError, ErrorCode, NotFoundError } from '@actovia/shared'
import {
  CLI_IDS,
  type AgentCard,
  type CliId
} from '@actovia/shared/types/agents'
import { shell } from 'electron'
import { Hono } from 'hono'
import { z } from 'zod'

import { getCliStatus } from '../../agents/cli-check'
import { resetLoginShellEnv } from '../../agents/login-shell'
import { agentRegistry } from '../../agents/registry'
import { openInTerminal } from '../../agents/terminal'
import {
  getAgentSession,
  updateAgentSession
} from '../../db/agent-session-queries'
import {
  getConversationMessageById,
  updateConversationMessageParts
} from '../../db/conversation-queries'
import type { Variables } from '../types'
import { getRequiredParam, successResponse, validateSchema } from '../utils'
import { emitToConversation } from './philharmonic-sse'

const AnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }),
  z.object({
    kind: z.literal('deny'),
    reason: z.string().max(2000).optional()
  }),
  z.object({
    kind: z.literal('answers'),
    answers: z.record(z.string(), z.string())
  })
])

const router = new Hono<{ Variables: Variables }>()

router.get('/clis', async (c) =>
  successResponse(c, await Promise.all(CLI_IDS.map((id) => getCliStatus(id))))
)

router.post('/clis/:id/check', async (c) => {
  const id = getRequiredParam(c, 'id') as CliId
  if (!CLI_IDS.includes(id)) throw new NotFoundError()
  resetLoginShellEnv()
  return successResponse(c, await getCliStatus(id, { refresh: true }))
})

router.post('/sessions/:id/respond', async (c) => {
  const id = getRequiredParam(c, 'id')
  const { requestId, answer } = validateSchema(
    z.object({ requestId: z.string().min(1), answer: AnswerSchema }),
    await c.req.json(),
    'Invalid answer'
  )
  const run = agentRegistry.bySession(id)
  if (!run || !run.respond(requestId, answer))
    throw new ConflictError(ErrorCode.AGENT_PROMPT_GONE)
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/interrupt', async (c) => {
  const run = agentRegistry.bySession(getRequiredParam(c, 'id'))
  if (!run || !run.interrupt())
    throw new ConflictError(ErrorCode.AGENT_NOT_RUNNING)
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/terminal', async (c) => {
  const id = getRequiredParam(c, 'id')
  const session = await getAgentSession(id)
  if (!session?.cliSessionId) throw new NotFoundError()
  const status = await getCliStatus('claude-code')
  if (!status.path) throw new ConflictError(ErrorCode.AGENT_NOT_RUNNING)
  // Never two drivers on one session: Actovia lets go first.
  await agentRegistry.stopSession(id)
  await openInTerminal(session.cwd, status.path, session.cliSessionId)
  await updateAgentSession(id, { continuedInTerminal: true })
  // The persisted card says so too, and an open group sees it at once.
  if (session.messageId) {
    const message = await getConversationMessageById(session.messageId)
    const card = message?.parts?.find((p) => p.kind === 'agent_card') as
      | AgentCard
      | undefined
    if (card) {
      const next = { ...card, continuedInTerminal: true }
      await updateConversationMessageParts(session.messageId, [next as never])
      emitToConversation(session.conversationId, {
        type: 'agent_card',
        conversationId: session.conversationId,
        messageId: session.messageId,
        card: next
      })
    }
  }
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/open-folder', async (c) => {
  const session = await getAgentSession(getRequiredParam(c, 'id'))
  if (!session) throw new NotFoundError()
  await shell.openPath(session.cwd)
  return successResponse(c, { success: true })
})

export default router
```

Add to `conversation-queries.ts`:

```ts
export async function getConversationMessageById(id: string) {
  const [row] = await db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.id, id))
  return row
}
```

and to the route test's `vi.mock('@main/lib/db/conversation-queries', …)`: `getConversationMessageById: async () => undefined, updateConversationMessageParts: vi.fn()`.

- [ ] **Step 6: `routes/projects.ts`**

```ts
// src/main/lib/server/routes/projects.ts
import { existsSync } from 'fs'

import { NotFoundError } from '@actovia/shared'
import { dialog } from 'electron'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  bindConversation,
  createNewProject,
  gitBranch,
  openFolderAsProject
} from '../../agents/projects'
import { getConversationById } from '../../db/conversation-queries'
import {
  getProjectById,
  listRecentProjects,
  updateProject
} from '../../db/project-queries'
import { getMainWindow } from '../../window'
import type { Variables } from '../types'
import { getRequiredParam, successResponse, validateSchema } from '../utils'

const router = new Hono<{ Variables: Variables }>()

router.get('/', async (c) => successResponse(c, await listRecentProjects()))

router.post('/', async (c) => {
  const { name } = validateSchema(
    z.object({ name: z.string().trim().min(1).max(80) }),
    await c.req.json(),
    'Invalid name'
  )
  return successResponse(c, await createNewProject(name))
})

router.post('/pick', async (c) => {
  const win = getMainWindow()
  const opts = {
    properties: ['openDirectory', 'createDirectory'] as Array<
      'openDirectory' | 'createDirectory'
    >
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  return successResponse(c, {
    path: result.canceled ? null : (result.filePaths[0] ?? null)
  })
})

router.post('/open', async (c) => {
  const { folder } = validateSchema(
    z.object({ folder: z.string().min(1) }),
    await c.req.json(),
    'Invalid folder'
  )
  return successResponse(c, await openFolderAsProject(folder))
})

router.get('/conversations/:id', async (c) => {
  const conversation = await getConversationById(getRequiredParam(c, 'id'))
  const project = conversation?.projectId
    ? ((await getProjectById(conversation.projectId)) ?? null)
    : null
  // An opened folder can be moved or deleted behind Actovia's back (spec §10).
  const missing = project ? !existsSync(project.workDir) : false
  return successResponse(c, {
    project,
    missing,
    branch: project && !missing ? await gitBranch(project.workDir) : null
  })
})

router.put('/conversations/:id', async (c) => {
  const { projectId } = validateSchema(
    z.object({ projectId: z.string().uuid().nullable() }),
    await c.req.json(),
    'Invalid project'
  )
  await bindConversation(getRequiredParam(c, 'id'), projectId)
  return successResponse(c, { success: true })
})

router.patch('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const { useWorktrees } = validateSchema(
    z.object({ useWorktrees: z.boolean() }),
    await c.req.json(),
    'Invalid project'
  )
  if (!(await getProjectById(id))) throw new NotFoundError()
  return successResponse(c, await updateProject(id, { useWorktrees }))
})

export default router
```

- [ ] **Step 7: Mount** — in `app.ts`, with the other `v1.route(...)` lines: `v1.route('/agents', agentsRouter)` and `v1.route('/projects', projectsRouter)` (default imports from `./routes/agents` and `./routes/projects`). Both sit behind the existing auth gate (a paired phone may answer; spec §9 phase 3).

- [ ] **Step 8: Start and quit** — in `main.ts`: right after `await runMigrate()`, `await markLiveSessionsStopped()` (a previous run that crashed left rows `working`). In the `will-quit` handler, before `getServer()?.close()`, race the agents down:

```ts
await Promise.race([
  agentRegistry.stopAll(),
  new Promise((r) => setTimeout(r, 3500))
])
await markLiveSessionsStopped().catch(() => {})
```

(`will-quit` already does async work under its own timeout — put these inside that same async block, keeping its order otherwise.)

- [ ] **Step 8b: A ready-made employee per Ready CLI** (spec §3: "nothing to set up before the first try") — create `src/main/lib/agents/default-employees.ts`:

```ts
import { CLI_IDS, CLI_NAMES } from '@actovia/shared/types/agents'

import { createAgent, getAllAgents } from '../db/philharmonic-queries'
import { getCliStatus } from './cli-check'

/** Once a CLI is Ready and no employee runs on it yet, add one ("Claude Code", the CLI's default model, `default` mode). */
export async function ensureDefaultCliEmployees(): Promise<void> {
  const agents = await getAllAgents()
  for (const id of CLI_IDS) {
    if (agents.some((a) => a.runtime === id)) continue
    if ((await getCliStatus(id)).state !== 'ready') continue
    await createAgent({
      name: CLI_NAMES[id],
      description: 'Writes and changes code in the group’s folder.',
      runtime: id,
      model: null,
      provider: null,
      permissionMode: null
    })
  }
}
```

Test it in `tests/unit/main/lib/agents/default-employees.test.ts` with `vi.mock('@main/lib/db/philharmonic-queries', …)` and `vi.mock('@main/lib/agents/cli-check', …)`: Ready and none → one `createAgent` call with `runtime: 'claude-code'`; already one → none; not ready → none. Call it from `main.ts` after `markLiveSessionsStopped()` as `void ensureDefaultCliEmployees().catch(() => {})` (never blocks start-up), and from `POST /clis/:id/check` after a check that comes back `ready`. Check `createAgent`'s parameter type in `philharmonic-queries.ts`; pass what it requires (e.g. `avatarSeed`) the way the Workforce page's create does.

- [ ] **Step 9: Run the tests — expect PASS**; run `bun run typecheck && bun run i18n:check`.

- [ ] **Step 10: Commit**

```bash
git add src/main/lib/agents/terminal.ts src/main/lib/agents/default-employees.ts tests/unit/main/lib/agents/default-employees.test.ts src/main/lib/server/routes/agents.ts src/main/lib/server/routes/projects.ts src/main/lib/server/app.ts src/main/main.ts src/main/lib/db/conversation-queries.ts packages/shared/src/constants/error-codes.ts packages/shared/src/i18n/locales/*/errors.json tests/unit/main/lib/agents/terminal.test.ts tests/unit/main/lib/server/routes/agents.test.ts
git commit -m "feat(agents): routes for CLI checks, answers, interrupt, Continue in Terminal and projects; a late answer is a 409, not a write to a dead process; agents stop at quit and stale sessions are cleared at start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Renderer services and Settings › Agents

**Files:**

- Create: `src/renderer/services/agents.ts`, `src/renderer/services/projects.ts`
- Create: `src/renderer/components/settings/settings-form/agents.tsx`
- Create: `src/renderer/lib/cli-status.ts` (pure: a status → its label key and tone)
- Modify: `src/renderer/components/settings/settings-menu.ts` (enum, i18n map, the "integrations" group), `src/renderer/components/settings/settings-form.tsx:~110` (render the section)
- Modify: `packages/shared/src/i18n/locales/en/settings.json` (`nav.agents.title`), `en/philharmonic.json` (`agents.settings.*`, `agents.cli.*`)
- Test: `tests/unit/renderer/lib/cli-status.test.ts`

**Interfaces:**

- Consumes: routes from Task 11; `CliStatus`, `CLI_NAMES` (Task 1); `SettingsRow`, `SettingsSection` (`../settings-row`), `SettingsIntro` (`../settings-kit`), `Controller` (react-hook-form), `UseFormReturnType`.
- Produces:
  - `services/agents.ts`: `getClis(): Promise<CliStatus[]>`, `checkCli(id: CliId): Promise<CliStatus>`, `respondToAgent(sessionId: string, requestId: string, answer: AgentAnswer): Promise<{ success: boolean }>`, `interruptAgent(sessionId: string)`, `continueInTerminal(sessionId: string)`, `openAgentFolder(sessionId: string)`
  - `services/projects.ts`: `listProjects(): Promise<ProjectData[]>`, `createProject(name: string): Promise<ProjectData>`, `pickFolder(): Promise<{ path: string | null }>`, `openFolder(folder: string): Promise<ProjectData>`, `getConversationProject(conversationId: string): Promise<{ project: ProjectData | null; branch: string | null }>`, `setConversationProject(conversationId: string, projectId: string | null)`, `setProjectWorktrees(id: string, useWorktrees: boolean): Promise<ProjectData>`; `interface ProjectData { id: string; name: string; dir: string; workDir: string; useWorktrees: boolean; lastUsedAt: string }`
  - `cliStatusView(status: CliStatus): { tone: 'ok' | 'warn' | 'error'; labelKey: string; hintKey: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/lib/cli-status.test.ts
import { describe, expect, it } from 'vitest'

import { cliStatusView } from '@/lib/cli-status'

const s = (state: string) =>
  ({
    id: 'claude-code',
    state,
    path: null,
    version: null,
    authMethod: null,
    detail: null,
    checkedAt: 0
  }) as never

describe('cliStatusView', () => {
  it.each([
    ['ready', 'ok', 'agents.cli.state.ready', null],
    [
      'not_installed',
      'warn',
      'agents.cli.state.notInstalled',
      'agents.cli.hint.install'
    ],
    ['broken', 'error', 'agents.cli.state.broken', 'agents.cli.hint.reinstall'],
    ['too_old', 'warn', 'agents.cli.state.tooOld', 'agents.cli.hint.update'],
    [
      'logged_out',
      'warn',
      'agents.cli.state.loggedOut',
      'agents.cli.hint.login'
    ]
  ])('%s', (state, tone, labelKey, hintKey) => {
    expect(cliStatusView(s(state))).toEqual({ tone, labelKey, hintKey })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then implement:

```ts
// src/renderer/lib/cli-status.ts
import type { CliStatus } from '@actovia/shared/types/agents'

const VIEW: Record<
  CliStatus['state'],
  { tone: 'ok' | 'warn' | 'error'; labelKey: string; hintKey: string | null }
> = {
  ready: { tone: 'ok', labelKey: 'agents.cli.state.ready', hintKey: null },
  not_installed: {
    tone: 'warn',
    labelKey: 'agents.cli.state.notInstalled',
    hintKey: 'agents.cli.hint.install'
  },
  broken: {
    tone: 'error',
    labelKey: 'agents.cli.state.broken',
    hintKey: 'agents.cli.hint.reinstall'
  },
  too_old: {
    tone: 'warn',
    labelKey: 'agents.cli.state.tooOld',
    hintKey: 'agents.cli.hint.update'
  },
  logged_out: {
    tone: 'warn',
    labelKey: 'agents.cli.state.loggedOut',
    hintKey: 'agents.cli.hint.login'
  }
}

export const cliStatusView = (status: CliStatus) => VIEW[status.state]
```

Run: `bunx vitest run tests/unit/renderer/lib/cli-status.test.ts` — expect PASS.

- [ ] **Step 3: Services** (the `fetcher` pattern of `services/philharmonic.ts`, which unwraps `successResponse`):

```ts
// src/renderer/services/agents.ts
import type {
  AgentAnswer,
  CliId,
  CliStatus
} from '@actovia/shared/types/agents'
import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/agents'

export const getClis = () => fetcher<CliStatus[]>(`${BASE}/clis`)
export const checkCli = (id: CliId) =>
  fetcher<CliStatus>(`${BASE}/clis/${id}/check`, { method: 'POST' })
export const respondToAgent = (
  sessionId: string,
  requestId: string,
  answer: AgentAnswer
) =>
  fetcher<{ success: boolean }>(`${BASE}/sessions/${sessionId}/respond`, {
    method: 'POST',
    body: { requestId, answer } as never
  })
export const interruptAgent = (sessionId: string) =>
  fetcher<{ success: boolean }>(`${BASE}/sessions/${sessionId}/interrupt`, {
    method: 'POST'
  })
export const continueInTerminal = (sessionId: string) =>
  fetcher<{ success: boolean }>(`${BASE}/sessions/${sessionId}/terminal`, {
    method: 'POST'
  })
export const openAgentFolder = (sessionId: string) =>
  fetcher<{ success: boolean }>(`${BASE}/sessions/${sessionId}/open-folder`, {
    method: 'POST'
  })
```

```ts
// src/renderer/services/projects.ts
import { fetcher } from '@actovia/shared/utils/http'

const BASE = '/api/v1/projects'

export interface ProjectData {
  id: string
  name: string
  dir: string
  workDir: string
  useWorktrees: boolean
  lastUsedAt: string
}

export const listProjects = () => fetcher<ProjectData[]>(BASE)
export const createProject = (name: string) =>
  fetcher<ProjectData>(BASE, { method: 'POST', body: { name } as never })
export const pickFolder = () =>
  fetcher<{ path: string | null }>(`${BASE}/pick`, { method: 'POST' })
export const openFolder = (folder: string) =>
  fetcher<ProjectData>(`${BASE}/open`, {
    method: 'POST',
    body: { folder } as never
  })
export const getConversationProject = (conversationId: string) =>
  fetcher<{
    project: ProjectData | null
    missing: boolean
    branch: string | null
  }>(`${BASE}/conversations/${conversationId}`)
export const setConversationProject = (
  conversationId: string,
  projectId: string | null
) =>
  fetcher<{ success: boolean }>(`${BASE}/conversations/${conversationId}`, {
    method: 'PUT',
    body: { projectId } as never
  })
export const setProjectWorktrees = (id: string, useWorktrees: boolean) =>
  fetcher<ProjectData>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: { useWorktrees } as never
  })
```

- [ ] **Step 4: The section**

```tsx
// src/renderer/components/settings/settings-form/agents.tsx
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { CLI_NAMES, type CliStatus } from '@actovia/shared/types/agents'
import { useEffect, useState } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cliStatusView } from '@/lib/cli-status'
import { cn } from '@/lib/utils'
import { checkCli, getClis } from '@/services/agents'
import { pickFolder } from '@/services/projects'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'

const DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive'
} as const

function CliRow({
  status,
  onCheck,
  checking
}: {
  status: CliStatus
  onCheck: () => void
  checking: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const view = cliStatusView(status)
  return (
    <SettingsRow
      label={CLI_NAMES[status.id]}
      description={
        <span className="flex flex-col gap-0.5">
          <span>
            {[status.path, status.version, status.authMethod]
              .filter(Boolean)
              .join(' · ') || t('agents.cli.notFound')}
          </span>
          {view.hintKey && <span>{t(view.hintKey)}</span>}
          {status.detail && (
            <span className="font-mono text-xs break-all">{status.detail}</span>
          )}
        </span>
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm">
          <span className={cn('size-2 rounded-full', DOT[view.tone])} />
          {t(view.labelKey)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onCheck}
          disabled={checking}
        >
          {t('agents.cli.check')}
        </Button>
      </div>
    </SettingsRow>
  )
}

/** Settings › Agents (spec §3): the CLIs on this Mac, and how coding agents run. */
export function Agents({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('philharmonic')
  const [clis, setClis] = useState<CliStatus[]>([])
  const [checking, setChecking] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getClis()
      .then((list) => !cancelled && setClis(list))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const recheck = async (id: CliStatus['id']) => {
    setChecking(id)
    try {
      const next = await checkCli(id)
      setClis((list) => list.map((c) => (c.id === id ? next : c)))
    } finally {
      setChecking(null)
    }
  }

  return (
    <>
      <SettingsIntro>{t('agents.settings.intro')}</SettingsIntro>

      <SettingsSection title={t('agents.settings.clisTitle')}>
        {clis.map((s) => (
          <CliRow
            key={s.id}
            status={s}
            checking={checking === s.id}
            onCheck={() => recheck(s.id)}
          />
        ))}
      </SettingsSection>

      <SettingsSection title={t('agents.settings.runTitle')}>
        <SettingsRow
          label={t('agents.settings.projectsDir.label')}
          description={t('agents.settings.projectsDir.description')}
        >
          <Controller
            control={form.control}
            name="agents.projectsDir"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Input
                  value={field.value ?? ''}
                  placeholder="~/Actovia Projects"
                  onChange={field.onChange}
                  className="w-64"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const { path } = await pickFolder()
                    if (path) field.onChange(path)
                  }}
                >
                  {t('agents.settings.projectsDir.choose')}
                </Button>
              </div>
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.maxRunning.label')}
          description={t('agents.settings.maxRunning.description')}
        >
          <Controller
            control={form.control}
            name="agents.maxRunning"
            render={({ field }) => (
              <Input
                type="number"
                min={1}
                max={8}
                placeholder="2"
                value={field.value ?? ''}
                onChange={field.onChange}
                className="w-20"
              />
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.keepAlive.label')}
          description={t('agents.settings.keepAlive.description')}
        >
          <Controller
            control={form.control}
            name="agents.keepAliveMinutes"
            render={({ field }) => (
              <Input
                type="number"
                min={0}
                max={120}
                placeholder="10"
                value={field.value ?? ''}
                onChange={field.onChange}
                className="w-20"
              />
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.worktrees.label')}
          description={t('agents.settings.worktrees.description')}
        >
          <Controller
            control={form.control}
            name="agents.worktrees"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>
      </SettingsSection>

      <p className="text-muted-foreground px-1 text-xs">
        {t('agents.settings.safety')}
      </p>
    </>
  )
}
```

(Check `SettingsSection`'s props in `settings-row.tsx` — if it has no `title`, wrap each section in the heading element the neighbouring sections use, e.g. `voice.tsx`; and if `SettingsRow.description` is typed `string`, render the CLI details below the row instead. `formNumber` in the schema coerces the inputs' strings.)

- [ ] **Step 5: Register the page** — in `settings-menu.ts`: `Agents = 'Agents'` in `SettingsLabel`; `[SettingsLabel.Agents]: 'nav.agents.title'` in the i18n map; `{ title: SettingsLabel.Agents, icon: CodeIcon }` in the `nav.group.integrations` items right after Computer Use (icon from `@hugeicons/core-free-icons`, the same import style as its neighbours). In `settings-form.tsx`, beside Computer Use: `{activeTitle === SettingsLabel.Agents && <Agents form={form} />}`.

- [ ] **Step 6: Strings (en)** — `settings.json` → `nav.agents.title: "Agents"`. `philharmonic.json` → add:

```json
"agents": {
  "settings": {
    "intro": "Coding agents are Philharmonic employees run by a CLI you installed and logged into. Actovia starts it in a group's folder, shows what it does, and stops for you whenever it asks.",
    "clisTitle": "On this Mac",
    "runTitle": "How they run",
    "projectsDir": { "label": "Projects folder", "description": "New projects are created here, and every project keeps its notes and logs here — even when the work happens in a folder you opened.", "choose": "Choose…" },
    "maxRunning": { "label": "Agents at once", "description": "More steps wait for a free slot. Each one uses your machine and your plan." },
    "keepAlive": { "label": "Keep an agent ready (minutes)", "description": "After a step, its process waits this long so the next step starts at once. 0 stops it right away." },
    "worktrees": { "label": "Separate worktrees", "description": "When two agents work in the same git repository at once, each gets its own worktree and branch. Merging is up to you." },
    "safety": "Coding agents run with their own permissions, in the folder you give them. Actovia never answers their questions or approves their actions for you."
  },
  "cli": {
    "check": "Check",
    "notFound": "Not found on this Mac",
    "state": { "ready": "Ready", "notInstalled": "Not installed", "broken": "Broken", "tooOld": "Too old", "loggedOut": "Not logged in" },
    "hint": {
      "install": "Install it, then press Check.",
      "reinstall": "Its launcher is there but the program it starts is missing — reinstall it.",
      "update": "Update it to the latest version, then press Check.",
      "login": "Run it once in Terminal and log in, then press Check."
    }
  },
  "notify": { "waitingTitle": "{{name}} is waiting for you" }
}
```

(Other locales are Task 16.)

- [ ] **Step 7: Typecheck, lint, the test, commit**

```bash
bun run typecheck && bun run lint && bunx vitest run tests/unit/renderer/lib/cli-status.test.ts
git add src/renderer/services/agents.ts src/renderer/services/projects.ts src/renderer/lib/cli-status.ts src/renderer/components/settings/settings-form/agents.tsx src/renderer/components/settings/settings-menu.ts src/renderer/components/settings/settings-form.tsx packages/shared/src/i18n/locales/en/settings.json packages/shared/src/i18n/locales/en/philharmonic.json tests/unit/renderer/lib/cli-status.test.ts
git commit -m "feat(settings): Settings › Agents — each CLI's state (ready, not installed, broken, too old, logged out) with a Check, the projects folder, how many agents at once, the keep-alive and worktrees

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`i18n:check` (pre-commit) reports the non-en locales' missing keys as errors for `machine`/`reviewed` locales — if it blocks this commit, do Task 16's translation step for these keys now and include those files.

---

### Task 13: The employee editor — runtime, model, permission mode

**Files:**

- Modify: `src/renderer/stores/philharmonic.ts:13` (`AgentData` + `runtime`, `permissionMode`)
- Modify: `src/main/lib/server/routes/philharmonic-crud.ts:32-45` (`employeeSchema`)
- Modify: `src/renderer/lib/provider-labels.ts` (+ `providerHasKey`, `configuredProviders`)
- Modify: `src/renderer/components/philharmonic/employees/employee-editor.tsx`
- Create: `src/renderer/lib/employee-model.ts` (pure: the picker's options and the value it saves)
- Modify: `src/renderer/components/philharmonic/chat/group-members-panel.tsx` (the model beside each name)
- Test: `tests/unit/renderer/lib/employee-model.test.ts`

**Interfaces:**

- Consumes: `useSettings`, `modelCatalog`, `PROVIDER_SHORT_LABELS`, `AGENT_RUNTIMES`, `PERMISSION_MODES`, `CLI_NAMES`, `getClis` (Task 12).
- Produces:
  - `providerHasKey(settings, provider): boolean`; `hasProviderKey(settings)` becomes `providerHasKey(settings, configuredProvider(settings))`
  - `configuredProviders(settings): AiProviders[]` — every provider with a key (or keyless, Ollama)
  - `actoviaModelOptions(settings): Array<{ value: string; label: string; provider: AiProviders; model: string }>` — `value` = `${provider}::${model}`; the first option is not here (the "Default" choice is the picker's own)
  - `parseModelValue(value: string): { provider: string | null; model: string | null }` — `''` → both null
  - `CLI_MODEL_SUGGESTIONS: Record<CliId, string[]>` = `{ 'claude-code': ['opus', 'sonnet', 'haiku'] }`
  - `employeeModelLabel(agent: AgentData, settings): string` — "Default", `modelLabel(...)`, or `Claude Code · opus`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/lib/employee-model.test.ts
import { describe, expect, it } from 'vitest'

import {
  employeeModelLabel,
  actoviaModelOptions,
  parseModelValue
} from '@/lib/employee-model'

const settings = {
  providerConfig: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  providers: { anthropicApiKey: '••••', openaiApiKey: '' },
  modelCatalog: {
    anthropic: [{ id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' }],
    openai: [{ id: 'gpt-x', displayName: 'GPT X' }]
  }
} as never

describe('employee model', () => {
  it('offers only the models of providers with a key', () => {
    const opts = actoviaModelOptions(settings)
    expect(opts.map((o) => o.value)).toEqual(['anthropic::claude-opus-5-5'])
    expect(opts[0].label).toMatch(/Claude Opus 5\.5/)
  })

  it('reads a picker value back', () => {
    expect(parseModelValue('anthropic::claude-opus-5-5')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5'
    })
    expect(parseModelValue('')).toEqual({ provider: null, model: null })
  })

  it('labels an employee by what it runs on', () => {
    expect(
      employeeModelLabel(
        { runtime: 'actovia', provider: null, model: null } as never,
        settings
      )
    ).toBe('Default')
    expect(
      employeeModelLabel(
        {
          runtime: 'actovia',
          provider: 'anthropic',
          model: 'claude-opus-5-5'
        } as never,
        settings
      )
    ).toMatch(/Opus 5\.5/)
    expect(
      employeeModelLabel(
        { runtime: 'claude-code', provider: null, model: 'opus' } as never,
        settings
      )
    ).toBe('Claude Code · opus')
    expect(
      employeeModelLabel(
        { runtime: 'claude-code', provider: null, model: null } as never,
        settings
      )
    ).toBe('Claude Code')
  })
})
```

(Use the real `AiProviders` enum values for `'anthropic'` / `'openai'` — read `packages/shared/src/types/ai.ts` and replace the strings if they differ, along with the key field names from `PROVIDER_KEY_FIELDS`.)

- [ ] **Step 2: Run — expect FAIL**, then implement:

```ts
// src/renderer/lib/provider-labels.ts — add, and rewrite hasProviderKey with it
export function providerHasKey(
  settings: Settings | undefined,
  provider: AiProviders | null
): boolean {
  if (!provider) return false
  const field = PROVIDER_KEY_FIELDS[provider]
  if (!field) return true
  return !!settings?.providers?.[field]
}

export function hasProviderKey(settings: Settings | undefined): boolean {
  return providerHasKey(settings, configuredProvider(settings))
}

export function configuredProviders(
  settings: Settings | undefined
): AiProviders[] {
  // Listed when it can answer (a key, or none needed) and its catalog was fetched.
  return (Object.values(AiProviders) as AiProviders[]).filter(
    (p) => providerHasKey(settings, p) && modelCatalog(settings, p).length > 0
  )
}
```

```ts
// src/renderer/lib/employee-model.ts
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { CLI_NAMES, type CliId } from '@actovia/shared/types/agents'
import type { AiProviders } from '@actovia/shared/types/ai'

import type { AgentData } from '@/stores/philharmonic'

import {
  configuredProviders,
  modelCatalog,
  modelLabel
} from './provider-labels'

export const CLI_MODEL_SUGGESTIONS: Record<CliId, string[]> = {
  'claude-code': ['opus', 'sonnet', 'haiku']
}

export function actoviaModelOptions(settings: Settings | undefined) {
  return configuredProviders(settings).flatMap((provider) => {
    const catalog = modelCatalog(settings, provider)
    return catalog.map((m) => ({
      value: `${provider}::${m.id}`,
      label: modelLabel(provider, m.id, catalog),
      provider,
      model: m.id
    }))
  })
}

export function parseModelValue(value: string): {
  provider: string | null
  model: string | null
} {
  const i = value.indexOf('::')
  return i < 0
    ? { provider: null, model: null }
    : { provider: value.slice(0, i), model: value.slice(i + 2) }
}

export function employeeModelLabel(
  agent: Pick<AgentData, 'runtime' | 'provider' | 'model'>,
  settings: Settings | undefined
): string {
  if (agent.runtime !== 'actovia') {
    const name = CLI_NAMES[agent.runtime]
    return agent.model ? `${name} · ${agent.model}` : name
  }
  if (!agent.provider || !agent.model) return 'Default'
  const provider = agent.provider as AiProviders
  return modelLabel(provider, agent.model, modelCatalog(settings, provider))
}
```

(`'Default'` is shown through `t('employees.model.default')` in the UI; the function returns the English word so it stays pure — the editor maps `'Default'` to the translation. Keep the `Settings` type import from wherever `provider-labels.ts` imports it.)

Run the test — expect PASS.

- [ ] **Step 3: Data and validation** — `AgentData` gets `runtime: 'actovia' | 'claude-code'` and `permissionMode: 'default' | 'acceptEdits' | 'auto' | null`. `employeeSchema` in `philharmonic-crud.ts` gets:

```ts
  runtime: z.enum(AGENT_RUNTIMES).optional(),
  permissionMode: z.enum(PERMISSION_MODES).nullable().optional()
```

(imported from `@actovia/shared/types/agents`). A CLI employee is saved with `provider: null`.

- [ ] **Step 4: The editor** — in `employee-editor.tsx`, after the description field and before the system prompt, add (reading `useSettings()` and `getClis()` once on mount):

```tsx
;<Field label={t('philharmonic:employees.runtime.label')}>
  <Select
    value={draft.runtime}
    onValueChange={(runtime) =>
      setDraft((d) => ({
        ...d,
        runtime: runtime as AgentData['runtime'],
        provider: null,
        model: null,
        permissionMode: null
      }))
    }
  >
    <SelectTrigger className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="actovia">
        {t('philharmonic:employees.runtime.actovia')}
      </SelectItem>
      {clis.map((c) => (
        <SelectItem
          key={c.id}
          value={c.id}
          disabled={c.state !== 'ready' && draft.runtime !== c.id}
        >
          {CLI_NAMES[c.id]}
          {c.state !== 'ready' && ` — ${t(cliStatusView(c).labelKey)}`}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</Field>

{
  draft.runtime === 'actovia' ? (
    <Field label={t('philharmonic:employees.model.label')}>
      <Select
        value={
          draft.provider && draft.model
            ? `${draft.provider}::${draft.model}`
            : ''
        }
        onValueChange={(v) =>
          setDraft((d) => ({ ...d, ...parseModelValue(v) }))
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={t('philharmonic:employees.model.default')}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">
            {t('philharmonic:employees.model.default')}
          </SelectItem>
          {actoviaModelOptions(settings).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  ) : (
    <>
      <Field
        label={t('philharmonic:employees.model.label')}
        hint={t('philharmonic:employees.model.cliHint')}
      >
        <Input
          list="cli-models"
          value={draft.model ?? ''}
          placeholder={t('philharmonic:employees.model.cliDefault')}
          onChange={(e) =>
            setDraft((d) => ({ ...d, model: e.target.value.trim() || null }))
          }
        />
        <datalist id="cli-models">
          {CLI_MODEL_SUGGESTIONS[draft.runtime].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field
        label={t('philharmonic:employees.permission.label')}
        hint={t('philharmonic:employees.permission.hint')}
      >
        <Select
          value={draft.permissionMode ?? 'default'}
          onValueChange={(v) =>
            setDraft((d) => ({
              ...d,
              permissionMode:
                v === 'default' ? null : (v as AgentData['permissionMode'])
            }))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`philharmonic:employees.permission.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}
```

`Field` stands for however the editor already lays out a labelled field (read the name / description fields and copy their wrapper exactly — do not introduce a new component). For a CLI employee, hide the skills and MCP-servers fields (`draft.runtime === 'actovia' && …`) and relabel the system prompt `t('philharmonic:employees.systemPrompt.cliLabel')` ("Instructions added to every task"). `Select` is `@/components/ui/select`; if its `SelectItem` refuses `value=""`, use the sentinel `'__default__'` and map it in `onValueChange`.

- [ ] **Step 5: The member list** — in `group-members-panel.tsx`, under each member's name, a muted `text-xs` line `employeeModelLabel(member, settings)` (`'Default'` → `t('philharmonic:employees.model.default')`).

- [ ] **Step 6: Strings (en, `philharmonic.json` → `employees`)**

```json
"runtime": { "label": "Runs on", "actovia": "Actovia" },
"model": {
  "label": "Model",
  "default": "Default (the app's model)",
  "cliDefault": "The CLI's default",
  "cliHint": "As the CLI names it: opus, sonnet, haiku, or a full model id."
},
"permission": {
  "label": "Permissions",
  "hint": "What it may do without asking you. It always asks for anything else.",
  "default": "Ask before changes",
  "acceptEdits": "Edit files freely, ask before commands",
  "auto": "Auto (the CLI decides what is safe)"
},
"systemPrompt": { "cliLabel": "Instructions added to every task" }
```

(merge into the existing `employees` object; keep its existing keys.)

- [ ] **Step 7: Run typecheck, lint, the renderer tests and the crud route tests; commit**

```bash
bun run typecheck && bun run lint && bunx vitest run tests/unit/renderer tests/unit/main/lib/server/routes
git add src/renderer/stores/philharmonic.ts src/main/lib/server/routes/philharmonic-crud.ts src/renderer/lib/provider-labels.ts src/renderer/lib/employee-model.ts src/renderer/components/philharmonic/employees/employee-editor.tsx src/renderer/components/philharmonic/chat/group-members-panel.tsx packages/shared/src/i18n/locales/en/philharmonic.json tests/unit/renderer/lib/employee-model.test.ts
git commit -m "feat(philharmonic): the employee editor picks what an employee runs on — Actovia with its own model, or Claude Code with a model and a permission mode; the member list shows each one's model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The folder chip in the group composer

**Files:**

- Create: `src/renderer/components/philharmonic/chat/folder-chip.tsx`
- Modify: `src/renderer/components/philharmonic/chat/composer.tsx` (a chip row above the pill), `group-chat.tsx` (pass `conversationId`)
- Modify: `packages/shared/src/i18n/locales/en/philharmonic.json` (`chat.folder.*`)

**Interfaces:**

- Consumes: `services/projects.ts` (Task 12); `DropdownMenu*` (`@/components/ui/dropdown-menu`, as `workspace-switcher.tsx` uses it); `Switch`; `sileo` for errors.
- Produces: `<FolderChip conversationId={string} />`; `Composer` gains a required `conversationId: string` prop.

Behaviour (spec §4, the owner's screenshot): a chip `🗂 <project name> ▾` (or `No folder`) and, for a git folder, a second chip `⑂ <branch> · worktree [switch]`. The menu: **No folder** · separator · **Recent** (up to 8, a tick on the bound one) · separator · **New project…** (a small inline name field in the menu, Enter creates and binds) · **Open folder…** (system dialog → open → bind). A refused folder shows the server's message in a `sileo.error` toast. The chips sit on a row above the pill, left-aligned with it, `text-xs`, ghost style like Chat's model chip (`model-chip.tsx`'s `CHIP` classes).

- [ ] **Step 1: Write the chip**

```tsx
// src/renderer/components/philharmonic/chat/folder-chip.tsx
import {
  ArrowDown01Icon,
  Folder01Icon,
  GitBranchIcon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  createProject,
  getConversationProject,
  listProjects,
  openFolder,
  pickFolder,
  setConversationProject,
  setProjectWorktrees,
  type ProjectData
} from '@/services/projects'

const CHIP =
  'no-drag h-6 max-w-56 gap-1 rounded-full px-2.5 text-xs font-normal'

/** The group's folder (spec §4): where its coding agents work. */
export function FolderChip({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('philharmonic')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [recent, setRecent] = useState<ProjectData[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    const r = await getConversationProject(conversationId)
    setProject(r.project)
    setBranch(r.branch)
    setMissing(r.missing)
  }, [conversationId])

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  const bind = async (next: ProjectData | null) => {
    try {
      await setConversationProject(conversationId, next?.id ?? null)
      await refresh()
    } catch (err) {
      sileo.error({
        title: t('chat.folder.failed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const openPicked = async () => {
    try {
      const { path } = await pickFolder()
      if (!path) return
      await bind(await openFolder(path))
    } catch (err) {
      sileo.error({
        title: t('chat.folder.refused'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const createNamed = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setNaming(false)
    setName('')
    try {
      await bind(await createProject(trimmed))
    } catch (err) {
      sileo.error({
        title: t('chat.folder.failed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu
        onOpenChange={(open) =>
          open &&
          void listProjects()
            .then(setRecent)
            .catch(() => {})
        }
      >
        <DropdownMenuTrigger
          render={<Button variant="outline" size="xs" className={CHIP} />}
        >
          <HugeiconsIcon icon={Folder01Icon} className="size-3.5" />
          <span className={cn('truncate', missing && 'text-destructive')}>
            {project
              ? missing
                ? t('chat.folder.missing', { name: project.name })
                : project.name
              : t('chat.folder.none')}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="text-muted-foreground size-3"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-60 rounded-xl"
        >
          <DropdownMenuItem onClick={() => bind(null)}>
            <span className="flex-1">{t('chat.folder.none')}</span>
            {!project && <HugeiconsIcon icon={Tick02Icon} className="size-4" />}
          </DropdownMenuItem>
          {recent.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('chat.folder.recent')}</DropdownMenuLabel>
              {recent.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => bind(p)}
                  title={p.workDir}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {project?.id === p.id && (
                    <HugeiconsIcon icon={Tick02Icon} className="size-4" />
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          {naming ? (
            <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
              <Input
                autoFocus
                value={name}
                placeholder={t('chat.folder.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNamed()
                  if (e.key === 'Escape') setNaming(false)
                }}
                className="h-8"
              />
            </div>
          ) : (
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => setNaming(true)}
            >
              {t('chat.folder.new')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void openPicked()}>
            {t('chat.folder.open')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {project && branch && (
        <span className="text-muted-foreground flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs">
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
          <span className="max-w-32 truncate">{branch}</span>
          <span aria-hidden>·</span>
          <label className="no-drag flex items-center gap-1">
            {t('chat.folder.worktree')}
            <Switch
              size="sm"
              checked={project.useWorktrees}
              onCheckedChange={async (on) =>
                setProject(await setProjectWorktrees(project.id, on))
              }
            />
          </label>
        </span>
      )}
    </div>
  )
}
```

(Check the names against the libraries: `DropdownMenuItem`'s "keep open" prop (`closeOnClick` in Base UI menus), `Switch`'s `size` prop, and the three Hugeicons names — `Folder01Icon`, `GitBranchIcon`, `ArrowDown01Icon` — exist in `@hugeicons/core-free-icons`; pick the nearest existing ones if not.)

- [ ] **Step 2: Place it** — `Composer` takes `conversationId: string`; above the pill, inside `BorderBeam`'s parent… the pill is the `BorderBeam` root, so wrap: return a `<div className="mx-auto flex w-[calc(100%-2rem)] max-w-2xl flex-col gap-2">` holding `<FolderChip conversationId={conversationId} />` and the `BorderBeam` (whose own width classes become `w-full`). `group-chat.tsx` passes `conversationId={conversationId}`.

- [ ] **Step 3: Strings (en, `philharmonic.json` → `chat.folder`)**

```json
"folder": {
  "none": "No folder",
  "recent": "Recent",
  "new": "New project…",
  "namePlaceholder": "Project name, then Enter",
  "open": "Open folder…",
  "worktree": "Worktree",
  "failed": "Could not change the folder",
  "refused": "This folder can't be used",
  "missing": "{{name}} — folder missing; choose it again with Open folder…"
}
```

- [ ] **Step 4: Typecheck, lint; manual check in the running app** — open a group: the chip reads "No folder"; New project… creates `~/Actovia Projects/<name>/.actovia/`; Open folder… on `~` shows "This folder can't be used" with the reason; Recent lists both; opening a git repo shows the branch chip.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/philharmonic/chat/folder-chip.tsx src/renderer/components/philharmonic/chat/composer.tsx src/renderer/components/philharmonic/chat/group-chat.tsx packages/shared/src/i18n/locales/en/philharmonic.json
git commit -m "feat(philharmonic): a group's folder chip above the composer — no folder, recent projects, a new project or an opened folder; a git folder shows its branch and the worktree switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The agent card — live, persisted, answerable

**Files:**

- Create: `src/renderer/lib/agent-card.ts` (pure helpers), `src/renderer/components/philharmonic/chat/agent-card.tsx`
- Modify: `src/renderer/hooks/use-conversation-stream.ts` (`agent_card` → `agentCards` map + the live bubble), `src/renderer/components/philharmonic/chat/group-message-bubble.tsx` (`BubbleModel.agentCard`, render it instead of the text for employee messages that have one), `group-chat.tsx` (history `parts` → `agentCard`; live map wins)
- Modify: `packages/shared/src/i18n/locales/en/philharmonic.json` (`agents.card.*`)
- Test: `tests/unit/renderer/lib/agent-card.test.ts`

**Interfaces:**

- Consumes: `AgentCard`, `AgentPrompt`, `AgentAnswer` (Task 1); `respondToAgent`, `interruptAgent`, `continueInTerminal`, `openAgentFolder` (Task 12); `Markdown` rendering the group bubbles already use for text (reuse the bubble's own); the questionnaire look — `QuestionnaireStaticChoice` / `ChoiceIndicator` / `CHOICE_ROW` from `@/components/ui/questionnaire`.
- Produces:
  - `agentCardFromParts(parts: unknown[] | null | undefined): AgentCard | undefined`
  - `visibleSteps(card: AgentCard, max = 6): { shown: AgentCardStep[]; hidden: number }` — the last `max`
  - `cardStateKey(card: AgentCard): string` — `agents.card.state.<working|waiting|done|stopped|failed|queued>`
  - `ConversationStream.agentCards: Record<string, AgentCard>` keyed by `sessionId`
  - `<AgentCardView card={AgentCard} />`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/lib/agent-card.test.ts
import { describe, expect, it } from 'vitest'

import {
  agentCardFromParts,
  cardStateKey,
  visibleSteps
} from '@/lib/agent-card'

const card = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'agent_card',
    sessionId: 's',
    state: 'working',
    queued: false,
    steps: [],
    prompts: [],
    ...over
  }) as never

describe('agent card helpers', () => {
  it('finds the card among a message’s parts', () => {
    expect(agentCardFromParts([{ kind: 'artifact' }, card()])).toMatchObject({
      sessionId: 's'
    })
    expect(agentCardFromParts([{ kind: 'artifact' }])).toBeUndefined()
    expect(agentCardFromParts(null)).toBeUndefined()
  })

  it('shows the last steps and counts the rest', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({
      id: `${i}`,
      tool: 'Read',
      summary: `${i}`,
      status: 'ok'
    }))
    const { shown, hidden } = visibleSteps(card({ steps }), 6)
    expect(shown.map((s) => s.id)).toEqual(['3', '4', '5', '6', '7', '8'])
    expect(hidden).toBe(3)
  })

  it('names the state, queued and waiting first', () => {
    expect(cardStateKey(card({ queued: true }))).toBe(
      'agents.card.state.queued'
    )
    expect(cardStateKey(card({ state: 'blocked' }))).toBe(
      'agents.card.state.waiting'
    )
    expect(cardStateKey(card({ state: 'error' }))).toBe(
      'agents.card.state.failed'
    )
    expect(cardStateKey(card({ state: 'done' }))).toBe('agents.card.state.done')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then implement:

```ts
// src/renderer/lib/agent-card.ts
import type { AgentCard, AgentCardStep } from '@actovia/shared/types/agents'

export function agentCardFromParts(
  parts: unknown[] | null | undefined
): AgentCard | undefined {
  return (parts ?? []).find(
    (p): p is AgentCard =>
      typeof p === 'object' &&
      p !== null &&
      (p as { kind?: unknown }).kind === 'agent_card'
  )
}

export function visibleSteps(
  card: AgentCard,
  max = 6
): { shown: AgentCardStep[]; hidden: number } {
  const hidden = Math.max(0, card.steps.length - max)
  return { shown: card.steps.slice(hidden), hidden }
}

const STATE: Record<AgentCard['state'], string> = {
  working: 'working',
  blocked: 'waiting',
  done: 'done',
  stopped: 'stopped',
  error: 'failed'
}

export const cardStateKey = (card: AgentCard) =>
  `agents.card.state.${card.queued ? 'queued' : STATE[card.state]}`
```

Run — expect PASS.

- [ ] **Step 3: The stream** — in `use-conversation-stream.ts`: `LiveBubble` gains `agentCard?: AgentCard`; state `const [agentCards, setAgentCards] = useState<Record<string, AgentCard>>({})` (reset with the others on conversation switch); a case:

```ts
        case 'agent_card':
          setAgentCards((prev) => ({ ...prev, [evt.card.sessionId]: evt.card }))
          setBubbles((prev) =>
            prev.map((b) => (b.messageId === evt.messageId ? { ...b, agentCard: evt.card } : b))
          )
          break
```

and return `agentCards` from the hook (add it to `ConversationStream`).

- [ ] **Step 4: Bubbles** — `BubbleModel` gains `agentCard?: AgentCard`. In `group-chat.tsx`'s history mapping: `agentCard: agentCardFromParts(h.parts)`; then for both history and live bubbles, prefer the live copy: `agentCard: card ? (stream.agentCards[card.sessionId] ?? card) : undefined` (the live map carries unprompted-turn updates for a message already in history). Pass `stream.agentCards` into `GroupChat` the way `busyAgents` is passed today. In `group-message-bubble.tsx`, for `role === 'employee'` with `bubble.agentCard`, render `<AgentCardView card={bubble.agentCard} />` in place of the text body (keep the avatar and name header).

- [ ] **Step 5: The card component**

```tsx
// src/renderer/components/philharmonic/chat/agent-card.tsx
import type { AgentCard, AgentPrompt } from '@actovia/shared/types/agents'
import { CLI_NAMES } from '@actovia/shared/types/agents'
import { capitalCase } from 'change-case'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QuestionnaireStaticChoice } from '@/components/ui/questionnaire'
import { Spinner } from '@/components/ui/spinner'
import { cardStateKey, visibleSteps } from '@/lib/agent-card'
import { cn } from '@/lib/utils'
import {
  continueInTerminal,
  interruptAgent,
  openAgentFolder,
  respondToAgent
} from '@/services/agents'

import { BubbleMarkdown } from './group-message-bubble'

async function send(
  sessionId: string,
  requestId: string,
  answer: Parameters<typeof respondToAgent>[2],
  t: (k: string) => string
) {
  try {
    await respondToAgent(sessionId, requestId, answer)
  } catch (err) {
    // 409: answered elsewhere, or the agent moved on — the card's next update shows where it is.
    sileo.error({
      title: t('agents.card.answerFailed'),
      description: err instanceof Error ? err.message : String(err)
    })
  }
}

function PermissionPrompt({
  card,
  prompt
}: {
  card: AgentCard
  prompt: Extract<AgentPrompt, { kind: 'permission' }>
}) {
  const { t } = useTranslation('philharmonic')
  const [reason, setReason] = useState('')
  return (
    <div className="bg-muted/60 flex flex-col gap-2 rounded-xl p-3">
      <p className="text-sm">
        {t('agents.card.wantsTo', {
          name: CLI_NAMES[card.runtime],
          tool: capitalCase(prompt.tool)
        })}
        {prompt.summary && (
          <code className="ml-1 font-mono text-xs break-all">
            {prompt.summary}
          </code>
        )}
      </p>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('agents.card.reasonPlaceholder')}
        className="h-8 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            send(
              card.sessionId,
              prompt.requestId,
              { kind: 'deny', reason: reason || undefined },
              t
            )
          }
        >
          {t('agents.card.deny')}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            send(card.sessionId, prompt.requestId, { kind: 'allow' }, t)
          }
        >
          {t('agents.card.allow')}
        </Button>
      </div>
    </div>
  )
}

function QuestionPrompt({
  card,
  prompt
}: {
  card: AgentCard
  prompt: Extract<AgentPrompt, { kind: 'question' }>
}) {
  const { t } = useTranslation('philharmonic')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const toggle = (q: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[q] ?? []
      return {
        ...p,
        [q]: multi
          ? cur.includes(label)
            ? cur.filter((l) => l !== label)
            : [...cur, label]
          : [label]
      }
    })
  const answers = Object.fromEntries(
    prompt.questions.map((q) => [
      q.question,
      [...(picked[q.question] ?? []), other[q.question]?.trim()]
        .filter(Boolean)
        .join(', ')
    ])
  )
  const complete = prompt.questions.every((q) => answers[q.question])
  return (
    <div className="bg-muted/60 flex flex-col gap-3 rounded-xl p-3">
      {prompt.questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{q.question}</p>
          {q.options.map((o) => (
            <button
              key={o.label}
              type="button"
              className="text-left"
              onClick={() => toggle(q.question, o.label, q.multiSelect)}
            >
              <QuestionnaireStaticChoice
                type={q.multiSelect ? 'checkbox' : 'radio'}
                checked={(picked[q.question] ?? []).includes(o.label)}
              >
                {o.label}
                {o.description && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {o.description}
                  </span>
                )}
              </QuestionnaireStaticChoice>
            </button>
          ))}
          <Input
            value={other[q.question] ?? ''}
            onChange={(e) =>
              setOther((p) => ({ ...p, [q.question]: e.target.value }))
            }
            placeholder={t('agents.card.other')}
            className="h-8 text-sm"
          />
        </div>
      ))}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!complete}
          onClick={() =>
            send(
              card.sessionId,
              prompt.requestId,
              { kind: 'answers', answers },
              t
            )
          }
        >
          {t('agents.card.submit')}
        </Button>
      </div>
    </div>
  )
}

/** A coding agent's step in the group (spec §5). */
export function AgentCardView({ card }: { card: AgentCard }) {
  const { t } = useTranslation('philharmonic')
  const { shown, hidden } = visibleSteps(card)
  const running = card.state === 'working' || card.state === 'blocked'
  const text = [...card.blocks, card.pending]
    .filter((b) => b.trim())
    .join('\n\n')

  return (
    <div className="border-border/60 flex flex-col gap-2 rounded-2xl border p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">
          {CLI_NAMES[card.runtime]}
          {card.model && ` (${card.model})`}
        </span>
        <button
          type="button"
          className="text-muted-foreground truncate hover:underline"
          onClick={() => void openAgentFolder(card.sessionId)}
        >
          {card.projectName}
          {card.branch && ` · ${card.branch}`}
        </button>
        <span
          className={cn(
            'ml-auto flex items-center gap-1',
            card.state === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {running && !card.queued && card.state === 'working' && (
            <Spinner className="size-3" />
          )}
          {t(cardStateKey(card))}
        </span>
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {hidden > 0 && (
            <li className="text-muted-foreground">
              {t('agents.card.moreSteps', { count: hidden })}
            </li>
          )}
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  'w-3 text-center',
                  s.status === 'error' && 'text-destructive'
                )}
              >
                {s.status === 'running' ? '◌' : s.status === 'ok' ? '✓' : '✕'}
              </span>
              <span className="font-medium">{capitalCase(s.tool)}</span>
              {s.summary && (
                <code className="text-muted-foreground truncate font-mono">
                  {s.summary}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}

      {text && <BubbleMarkdown text={text} />}

      {card.prompts.map((p) =>
        p.kind === 'permission' ? (
          <PermissionPrompt key={p.requestId} card={card} prompt={p} />
        ) : (
          <QuestionPrompt key={p.requestId} card={card} prompt={p} />
        )
      )}

      {card.error && (
        <p className="text-destructive text-xs whitespace-pre-wrap">
          {card.error}
        </p>
      )}
      {card.notices.map((n) => (
        <p key={n} className="text-muted-foreground text-xs">
          {n}
        </p>
      ))}
      {card.continuedInTerminal && (
        <p className="text-muted-foreground text-xs">
          {t('agents.card.inTerminal')}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {running ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => void interruptAgent(card.sessionId).catch(() => {})}
          >
            {t('agents.card.stop')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              void continueInTerminal(card.sessionId).catch((err) =>
                sileo.error({
                  title: t('agents.card.terminalFailed'),
                  description: String(err)
                })
              )
            }
          >
            {t('agents.card.continueInTerminal')}
          </Button>
        )}
      </div>
    </div>
  )
}
```

`BubbleMarkdown` is whatever `group-message-bubble.tsx` uses to render an employee's Markdown today — export it from there under that name (wrap the existing call in a small exported component if it is inline). `capitalCase` is the same helper the thinking timeline uses for tool names (`change-case`, already a dependency — confirm with `grep -rn "capitalCase" src/renderer`). The question rows are buttons wrapping `QuestionnaireStaticChoice` so the look matches the answered questionnaire; if `QuestionnaireStaticChoice`'s props differ (read `components/ui/questionnaire.tsx`), adapt the call, not the look.

- [ ] **Step 6: Strings (en, `philharmonic.json` → `agents.card`)**

```json
"card": {
  "state": { "queued": "Waiting for a free slot", "working": "Working", "waiting": "Waiting for you", "done": "Done", "stopped": "Stopped", "failed": "Failed" },
  "moreSteps_one": "{{count}} earlier step",
  "moreSteps_other": "{{count}} earlier steps",
  "wantsTo": "{{name}} wants to use {{tool}}",
  "reasonPlaceholder": "Tell it why (optional, sent if you deny)",
  "allow": "Allow",
  "deny": "Deny",
  "other": "Other…",
  "submit": "Answer",
  "answerFailed": "Your answer didn't reach it",
  "stop": "Stop",
  "continueInTerminal": "Continue in Terminal",
  "terminalFailed": "Could not open Terminal",
  "inTerminal": "Continued in Terminal — Actovia picks it up again on its next step."
}
```

- [ ] **Step 7: Typecheck, lint, tests; manual check** — with the fake CLI is not possible in the app; use the real one (Task 16's checklist covers it). Commit:

```bash
bun run typecheck && bun run lint && bunx vitest run tests/unit/renderer
git add src/renderer/lib/agent-card.ts src/renderer/components/philharmonic/chat/agent-card.tsx src/renderer/hooks/use-conversation-stream.ts src/renderer/components/philharmonic/chat/group-message-bubble.tsx src/renderer/components/philharmonic/chat/group-chat.tsx packages/shared/src/i18n/locales/en/philharmonic.json tests/unit/renderer/lib/agent-card.test.ts
git commit -m "feat(philharmonic): the agent card — a coding agent's steps, text and state live in the group, Allow / Deny with a reason, its questions answered in the questionnaire's rows, Stop, Continue in Terminal; persisted with the message and kept current after it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Translations, the full gate, and the owner's checklist

**Files:**

- Modify: every `packages/shared/src/i18n/locales/<locale>/{philharmonic,settings,errors}.json` whose `_status.json` source is `machine` or `reviewed` (de, es, fr, it, ja, ko, pt-BR, zh-Hant-HK, zh-Hant-TW — confirm in each `_status.json`)
- Modify: `docs/manual-qa-checklist.md` (a "Coding agents" section)

- [ ] **Step 1: Translate** every key added in Tasks 11–15 (`errors.code.AGENT_*`, `settings.nav.agents.title`, `philharmonic.agents.*`, `philharmonic.employees.{runtime,model,permission,systemPrompt.cliLabel}`, `philharmonic.chat.folder.*`) into each locale, in the voice of that file's existing strings. Keep `{{name}}`, `{{tool}}`, `{{count}}` exactly; keep "Claude Code", "Terminal" and "worktree" untranslated where the locale's existing strings leave product and git terms in English. Plural keys follow each locale's existing plural style (`_one`/`_other`, and `_few`/`_many` where that file already uses them).

- [ ] **Step 2: The full gate**

```bash
bun run i18n:check && bun run typecheck && bun run lint && bun run fmt:check && bun run test
```

Expected: all green. Fix, never skip.

- [ ] **Step 3: The owner's checklist** — append to `docs/manual-qa-checklist.md`:

```markdown
## Coding agents (Claude Code employees) — spec 2026-10-09

Needs Claude Code ≥ 2.1.294 installed and logged in.

- [ ] Settings › Agents shows Claude Code Ready with its path, version and "claude.ai"; Check re-runs it.
- [ ] With `claude` renamed away, Check says Not installed; restored, Ready again.
- [ ] Workforce: a new employee "Claude Code (Haiku)", runs on Claude Code, model haiku, permissions "Ask before changes".
- [ ] A group with that employee and **no folder**: asking it to build something — the PM says the folder is missing (no CLI is started).
- [ ] New project… "notes-prototype": `~/Actovia Projects/notes-prototype/.actovia/` exists, with `project.json`.
- [ ] "Build a single-page notes app in plain HTML": a card appears, steps tick, a Write asks — Allow — the file lands in the project; the card ends Done and the PM summarises.
- [ ] A second request in the same group: the card continues the same session (the agent remembers the first).
- [ ] Deny with a reason ("call it app.html"): the agent follows the reason.
- [ ] A request that makes it ask a question (AskUserQuestion): the rows answer it.
- [ ] Stop on the card mid-step: the card says Stopped; the group carries on.
- [ ] Stop the whole group mid-step: the agent is interrupted too.
- [ ] Quit Actovia mid-step, reopen: the step shows Stopped; a new request resumes the session.
- [ ] Continue in Terminal: Terminal opens `claude --resume` in the project; the card says so; the next step in Actovia resumes.
- [ ] Open folder… on a git repo with two Claude Code employees given parallel steps: the second works in `.actovia/worktrees/…` on an `actovia/…` branch; the branch chip and Worktree switch show.
- [ ] Open folder… on `~`: refused with the reason.
- [ ] With the window in the background, a permission prompt raises a notification "… is waiting for you".
- [ ] Settings › Agents → Agents at once = 1, two parallel steps: the second card says "Waiting for a free slot" until the first ends.
- [ ] An Actovia employee given its own model (Workforce → Model): its step runs on that model (cost view / logs); removing that provider's key makes its next step fail with the reason.
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/i18n/locales docs/manual-qa-checklist.md
git commit -m "feat(agents): coding-agent strings in every locale, and the owner's checklist for Claude Code employees

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final review** — a whole-branch review of Tasks 1–16 against the spec (superpowers:requesting-code-review), then hand the checklist to the owner. Nothing is pushed.
