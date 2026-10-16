// src/main/lib/ai/philharmonic/scheduler.ts
import cron, { type ScheduledTask } from 'node-cron'

import { createConversationMessage } from '../../db/conversation-queries'
import {
  claimOneOffTask,
  getCronTasks,
  getDueOneOffTasks,
  getTaskById,
  updateTask
} from '../../db/philharmonic-queries'
import { logger } from '../../logger'
import { withTrace } from '../../logger/trace-context'
import type { SseEmitter } from './employee-loop'
import { runPmCoordinator } from './pm-coordinator'

const scheduledJobs = new Map<string, ScheduledTask>()
let globalEmit: SseEmitter = () => {}

export function setSchedulerEmitter(emit: SseEmitter) {
  globalEmit = emit
}

/** One scheduled firing: inject a system round-start message, run the PM loop. */
export async function runScheduledRound(
  taskId: string,
  emit: SseEmitter
): Promise<void> {
  // Each firing is its own unit of work — trace it so every logger.* call the
  // PM loop makes shares one traceId.
  return withTrace(async () => {
    const template = await getTaskById(taskId)
    if (
      !template ||
      template.status === 'cancelled' ||
      !template.conversationId
    ) {
      unscheduleTask(taskId)
      return
    }
    const label = `[Scheduled] ${template.title}`
    await createConversationMessage({
      conversationId: template.conversationId,
      role: 'system',
      content: label
    })
    emit({
      type: 'round_start',
      conversationId: template.conversationId,
      label
    })
    await updateTask(taskId, { lastRunAt: new Date() })

    await runPmCoordinator({
      conversationId: template.conversationId,
      userText: `${template.title}\n\n${template.description ?? ''}`.trim(),
      trigger: 'scheduled',
      emit
    })
    await updateTask(taskId, { lastRunStatus: 'completed' })
  })
}

export function scheduleTask(taskId: string, cronExpression: string): boolean {
  if (!cron.validate(cronExpression)) {
    logger.error('scheduler', 'Invalid cron expression', {
      taskId,
      cronExpression
    })
    return false
  }
  unscheduleTask(taskId)
  const job = cron.schedule(cronExpression, () => {
    runScheduledRound(taskId, globalEmit).catch((err) =>
      logger.error('scheduler', 'Scheduled round error', {
        taskId,
        error: err
      })
    )
  })
  scheduledJobs.set(taskId, job)
  logger.info('scheduler', 'Scheduled task', { taskId, cronExpression })
  return true
}

export function unscheduleTask(taskId: string) {
  const job = scheduledJobs.get(taskId)
  if (job) {
    job.stop()
    scheduledJobs.delete(taskId)
    logger.info('scheduler', 'Unscheduled task', { taskId })
  }
}

export function getScheduledTaskIds(): string[] {
  return Array.from(scheduledJobs.keys())
}

/**
 * Fire every due one-off task once. Each task is claimed via a
 * compare-and-swap (`claimOneOffTask`, only flips `'pending'` -> `'running'`)
 * before `runScheduledRound` starts, so a concurrent sweep tick that fetched
 * its own stale `due` snapshot while this one was still mid-run can't
 * re-claim and double-execute a task this sweep already finished. Errors —
 * including a failed claim itself — are isolated per task so one failure
 * doesn't abort the rest of the sweep or leave the task stuck re-firing
 * forever.
 */
export async function runDueOneOffTasks(emit: SseEmitter): Promise<void> {
  const due = await getDueOneOffTasks()
  for (const t of due) {
    let claimed
    try {
      claimed = await claimOneOffTask(t.id)
    } catch (err) {
      logger.error('scheduler', 'Failed to claim one-off task', {
        taskId: t.id,
        error: err
      })
      continue
    }
    if (!claimed) continue // already claimed by a concurrent sweep tick
    try {
      await runScheduledRound(t.id, emit)
      await updateTask(t.id, { status: 'completed' })
    } catch (err) {
      logger.error('scheduler', 'One-off task failed', {
        taskId: t.id,
        error: err
      })
      await updateTask(t.id, { status: 'failed' })
    }
  }
}

export async function initScheduler(emit: SseEmitter): Promise<void> {
  setSchedulerEmitter(emit)
  const tasks = await getCronTasks()
  let count = 0
  for (const t of tasks) {
    if (t.cronExpression && scheduleTask(t.id, t.cronExpression)) count++
  }
  cron.schedule('* * * * *', () => {
    runDueOneOffTasks(globalEmit).catch((err) =>
      logger.error('scheduler', 'One-off sweep error', { error: err })
    )
  })
  await runDueOneOffTasks(emit).catch((err) =>
    logger.error('scheduler', 'Initial one-off sweep error', {
      error: err
    })
  )
  logger.info('scheduler', 'Initialized', { activeTasks: count })
}
