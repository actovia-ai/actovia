import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql
} from 'drizzle-orm'

import { db } from './db'
import {
  agent,
  agentMemory,
  task,
  taskExecution,
  taskExecutionEvent,
  type Task
} from './schema'

// ─── Agent CRUD ─────────────────────────────────────────────────────────────

export async function getAllAgents() {
  return db.select().from(agent).orderBy(asc(agent.createdAt))
}

export async function getAgentById(id: string) {
  const [result] = await db.select().from(agent).where(eq(agent.id, id))
  return result
}

export async function createAgent(data: typeof agent.$inferInsert) {
  const [result] = await db.insert(agent).values(data).returning()
  return result
}

export async function updateAgent(
  id: string,
  data: Partial<typeof agent.$inferInsert>
) {
  const [result] = await db
    .update(agent)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agent.id, id))
    .returning()
  return result
}

export async function deleteAgent(id: string) {
  return db.delete(agent).where(eq(agent.id, id))
}

export async function getActiveAgents() {
  return db
    .select()
    .from(agent)
    .where(eq(agent.isActive, true))
    .orderBy(asc(agent.createdAt))
}

// ─── Agent Memory ───────────────────────────────────────────────────────────

/**
 * Read an agent's memories.
 *
 * - When `conversationId` is provided, returns ONLY rows from that Group.
 *   This is the runtime path the employee loop uses, so memories from a
 *   different Group never bleed into the current LLM call.
 * - When omitted, returns every row across every Group — the inspection
 *   path used by the Workforce → Employee editor.
 */
export async function getAgentMemories(
  agentId: string,
  conversationId?: string
) {
  const filter = conversationId
    ? and(
        eq(agentMemory.agentId, agentId),
        eq(agentMemory.conversationId, conversationId)
      )
    : eq(agentMemory.agentId, agentId)
  return db
    .select()
    .from(agentMemory)
    .where(filter)
    .orderBy(desc(agentMemory.createdAt))
}

export async function createAgentMemory(data: typeof agentMemory.$inferInsert) {
  const [result] = await db.insert(agentMemory).values(data).returning()
  return result
}

// ─── Task CRUD ──────────────────────────────────────────────────────────────

export async function getAllTasks() {
  // Only return top-level tasks (no parentTaskId) — child tasks (cron instances, delegated sub-tasks) are excluded
  return db
    .select()
    .from(task)
    .where(isNull(task.parentTaskId))
    .orderBy(desc(task.createdAt))
}

export async function getChildTasksByParentId(parentTaskId: string) {
  return db
    .select()
    .from(task)
    .where(eq(task.parentTaskId, parentTaskId))
    .orderBy(desc(task.createdAt))
}

/**
 * All cron (recurring) task rows, regardless of status. Used by
 * `initScheduler()` to re-register jobs on process restart — do not add a
 * status filter here, or cancelled/completed jobs won't get cleaned up and
 * pending ones may be missed depending on filter choice.
 */
export async function getCronTasks() {
  return db.select().from(task).where(isNotNull(task.cronExpression))
}

/** Active (non-cancelled) recurring tasks, for the Recurring list UI. */
export async function getActiveCronTasks() {
  return db
    .select()
    .from(task)
    .where(and(isNotNull(task.cronExpression), eq(task.status, 'pending')))
}

/** Pending one-off tasks with a runAt set, soonest first — for the Upcoming list. */
export async function getUpcomingOneOffTasks() {
  return db
    .select()
    .from(task)
    .where(and(eq(task.status, 'pending'), isNotNull(task.runAt)))
    .orderBy(asc(task.runAt))
}

/** Pending one-off tasks whose runAt has passed and haven't fired yet. */
export async function getDueOneOffTasks() {
  return db
    .select()
    .from(task)
    .where(
      and(
        eq(task.status, 'pending'),
        isNull(task.cronExpression),
        isNotNull(task.runAt),
        lte(task.runAt, new Date())
      )
    )
}

export async function getTaskById(id: string) {
  const [result] = await db.select().from(task).where(eq(task.id, id))
  return result
}

export async function getTasksByStatus(statuses: string[]) {
  return db
    .select()
    .from(task)
    .where(inArray(task.status, statuses as Task['status'][]))
    .orderBy(desc(task.createdAt))
}

export async function createTask(data: typeof task.$inferInsert) {
  const [result] = await db.insert(task).values(data).returning()
  return result
}

export async function updateTask(
  id: string,
  data: Partial<typeof task.$inferInsert>
) {
  const [result] = await db
    .update(task)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(task.id, id))
    .returning()
  return result
}

/**
 * Conditionally claims a pending one-off task by flipping it to 'running' —
 * only if it's still 'pending'. Returns the updated row on success, or
 * undefined if another sweep already claimed it first (no row matched).
 */
export async function claimOneOffTask(id: string) {
  const [result] = await db
    .update(task)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(task.id, id), eq(task.status, 'pending')))
    .returning()
  return result
}

/** Bump retryCount by 1 and return the new value. Used by execution-engine
 * on each backoff before re-entering runEmployeeLoop. */
export async function incrementTaskRetryCount(id: string): Promise<number> {
  const [row] = await db
    .update(task)
    .set({
      retryCount: sql`${task.retryCount} + 1`,
      updatedAt: new Date()
    })
    .where(eq(task.id, id))
    .returning({ retryCount: task.retryCount })
  return row?.retryCount ?? 0
}

// ─── Task Execution ─────────────────────────────────────────────────────────

export async function createTaskExecution(
  data: typeof taskExecution.$inferInsert
) {
  const [result] = await db.insert(taskExecution).values(data).returning()
  return result
}

export async function updateTaskExecution(
  id: string,
  data: Partial<typeof taskExecution.$inferInsert>
) {
  const [result] = await db
    .update(taskExecution)
    .set(data)
    .where(eq(taskExecution.id, id))
    .returning()
  return result
}

export async function getExecutionsByTaskId(taskId: string) {
  return db
    .select()
    .from(taskExecution)
    .where(eq(taskExecution.taskId, taskId))
    .orderBy(desc(taskExecution.startedAt))
}

// ─── Task Execution Events ──────────────────────────────────────────────────

export async function createTaskExecutionEvent(
  data: typeof taskExecutionEvent.$inferInsert
) {
  const [result] = await db.insert(taskExecutionEvent).values(data).returning()
  return result
}

export async function getEventsByExecutionId(executionId: string) {
  return db
    .select()
    .from(taskExecutionEvent)
    .where(eq(taskExecutionEvent.executionId, executionId))
    .orderBy(asc(taskExecutionEvent.createdAt))
}

/** One-time cleanup: tasks stuck in waiting_for_user → failed */
export async function cleanupStaleWaitingTasks() {
  await db
    .update(task)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(task.status, 'waiting_for_user'))
}

/**
 * One-time cleanup: one-off tasks stuck in `running` → `failed`.
 *
 * `running` is only ever set by `claimOneOffTask()`'s compare-and-swap and
 * cleared once execution finishes (to `completed` or `failed`). A task still
 * `running` at startup means the previous process died mid-execution —
 * reconciled to `failed` (not reset to `pending`) since a crash mid-run may
 * have left partial side effects, and silently auto-retrying risks
 * duplicating work. Matches `cleanupStaleWaitingTasks()`'s precedent.
 */
export async function cleanupStaleRunningTasks() {
  await db
    .update(task)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(task.status, 'running'))
}

// MCP Server queries moved to mcp-queries.ts
export {
  createMcpServer,
  deleteMcpServer,
  getAllMcpServers,
  getMcpServerById,
  getMcpServersByNames,
  updateMcpServer
} from './mcp-queries'
