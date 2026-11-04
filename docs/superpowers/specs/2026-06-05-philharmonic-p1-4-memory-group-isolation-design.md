# Philharmonic P1-4 — Agent memory isolated per Group

**Date:** 2026-06-05
**Status:** Implemented; extended by ISSUE-346
**Scope:** `agent_memory` rows become per-(agent, conversation) instead of per-agent. The runtime view (what the employee LLM sees) is scoped to the current Group. The Workforce → Employee inspection view continues to show every memory across every Group it was earned in (admin transparency).

> Follow-up: the original hard-isolation rule remains true for ordinary task
> memories. ISSUE-346 adds a narrow exception: only after the PM marks a
> completed task's plan step done, a best-effort reflection may store a few
> redacted, reusable lessons with a null `conversationId`. Those employee-level
> lessons are the only cross-Group memory; raw task output is never written as
> shared experience. This follow-up supersedes the original `NOT NULL` schema
> decision and migration description below.

## Goal

Today an employee that worked on a finance task in Group A carries that memory into Group B's marketing task. Per the user's "class vs instance" framing, the agent is a class and each Group's use of it is an instance — instance state (accumulated task experience) must not bleed between instances.

The employee loop sees the current Group's ordinary memories and the employee's
PM-reviewed reusable lessons. Other Groups' raw task memories never bleed into
the current LLM call.

## Decisions

- **Two layers, one narrow exception.** Ordinary memories remain scoped to a Group. A null `conversationId` is reserved for compact, PM-reviewed employee experience, protected by a partial unique index on employee and task key.
- **Fresh project, no legacy data.** User confirmed: dump existing rows in the migration before adding the NOT NULL column. No backfill, no fallback path.
- **Inspection view shows everything.** The Employee editor's "Memory (read-only)" panel still calls `getAgentMemories(agentId)` without a conversation filter — it's the admin's window into what the agent has ever learned. We'll group results by conversation in a future polish (out of scope here).
- **Cascade on conversation delete.** When a Group is deleted, its agent_memory rows go with it (`ON DELETE CASCADE`). No orphaned rows.

## Schema

```ts
export const agentMemory = pgTable('agent_memory', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  agentId: uuid('agentId')
    .notNull()
    .references(() => agent.id, { onDelete: 'cascade' }),
  // NEW: every memory row is scoped to the Group it was learned in.
  conversationId: uuid('conversationId')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  source: agentMemorySourceEnum('source').notNull().default('task'),
  confidence: real('confidence').default(0.8),
  isActive: boolean('isActive').default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})
```

### Migration

The initial migration added `conversationId` as NOT NULL after clearing old
rows. The ISSUE-346 follow-up makes it nullable and adds a partial unique index
for employee-level reviewed lessons; preserve existing Group-scoped rows.

```sql
ALTER TABLE "agent_memory" ALTER COLUMN "conversationId" DROP NOT NULL;
CREATE UNIQUE INDEX "agent_memory_employee_experience_idx"
  ON "agent_memory" ("agentId", "key")
  WHERE "conversationId" IS NULL;
```

Acceptable because the user confirmed the project has no production data worth keeping.

## Query API

```ts
// db/philharmonic-queries.ts
export async function getAgentMemories(
  agentId: string,
  conversationId?: string // when provided, filter to this Group
)
export async function createAgentMemory(
  data: typeof agentMemory.$inferInsert // null is reserved for reviewed employee experience
)
```

`getAgentMemories(agentId)` — admin/inspection (returns all)
`getAgentMemories(agentId, conversationId)` — runtime (this Group plus reviewed employee experience)

## Runtime wiring

- `reflectOnReviewedTask(taskId, conversationId, pmReview)` — checks that the task completed in the expected Group and is not blocked; reflects only after PM acceptance, redacts known secrets, and never fails task completion.
- Raw employee output is not written to shared memory when a delegation returns.
- `runEmployeeLoop` calls `getAgentMemories(agent.id, conversationId)` so the system prompt only mentions this Group's prior task outcomes.

## Out of scope

- A general-purpose memory write-judge; the only shared learning path is the PM-reviewed reflection described above.
- Cross-Group "global" memory tier.
- UI grouping of inspection-view memories by Group.

## File touchpoints

| File                                             | Change                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/main/lib/db/schema.ts`                      | Nullable `conversationId`; partial unique index for reviewed experience |
| `resources/drizzle/0023_*.sql`                   | Make `conversationId` nullable; add employee/task uniqueness            |
| `src/main/lib/db/philharmonic-queries.ts`        | Group notes + reviewed experience at runtime                            |
| `src/main/lib/ai/philharmonic/agent-memory.ts`   | Reflect only after PM acceptance; scrub and persist lessons             |
| `src/main/lib/ai/philharmonic/pm-coordinator.ts` | Trigger reflection when a task-backed step becomes done                 |
| `src/main/lib/ai/philharmonic/employee-loop.ts`  | Separate employee lessons from Group notes in the prompt                |
| Tests                                            | Cover review gating, redaction, isolation, and migration behavior       |
