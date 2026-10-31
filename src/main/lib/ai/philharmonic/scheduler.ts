import { existsSync } from 'fs'
import { isAbsolute, resolve } from 'path'

// src/main/lib/ai/philharmonic/scheduler.ts
import cron, { type ScheduledTask } from 'node-cron'

import { createConversationMessage } from '../../db/conversation-queries'
import {
  claimOneOffTask,
  getCronTasks,
  getDueOneOffTasks,
  getTaskById,
  updateChatScheduledTask,
  updateTask
} from '../../db/philharmonic-queries'
import { getChatById } from '../../db/queries'
import { logger } from '../../logger'
import { withTrace } from '../../logger/trace-context'
import { getGroupDir } from '../../paths'
import type { SseEmitter } from './employee-loop'
import { runPmCoordinator } from './pm-coordinator'
import { pmRunRegistry } from './pm-run-registry'
import { runScheduledChat } from './scheduled-chat'

const scheduledJobs = new Map<string, ScheduledTask>()
let globalEmit: SseEmitter = () => {}

export function setSchedulerEmitter(emit: SseEmitter) {
  globalEmit = emit
}

/** One scheduled firing: inject a system round-start message, run the PM loop. */
export async function runScheduledRound(
  taskId: string,
  emit: SseEmitter
): Promise<boolean> {
  // Each firing is its own unit of work — trace it so every logger.* call the
  // PM loop makes shares one traceId.
  return withTrace(async () => {
    const template = await getTaskById(taskId)
    const chatId =
      template?.input?.kind === 'chat-schedule' &&
      typeof template.input.chatId === 'string'
        ? template.input.chatId
        : null
    if (template && template.status !== 'cancelled' && chatId) {
      if (!(await getChatById({ id: chatId }))) {
        const failed = await updateChatScheduledTask(
          taskId,
          chatId,
          { status: 'failed', lastRunStatus: 'failed' },
          true
        )
        if (failed) unscheduleTask(taskId)
        return false
      }
      await updateTask(taskId, { lastRunAt: new Date() })
      await pmRunRegistry.run(`chat:${chatId}`, (signal) =>
        runScheduledChat(
          chatId,
          `[Scheduled] ${template.title}\n\n${template.description ?? ''}`.trim(),
          signal
        )
      )
      await updateTask(taskId, { lastRunStatus: 'completed' })
      return true
    }
    if (
      !template ||
      template.status === 'cancelled' ||
      !template.conversationId
    ) {
      unscheduleTask(taskId)
      return false
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

    await pmRunRegistry.run(template.conversationId, (signal) =>
      runPmCoordinator({
        conversationId: template.conversationId!,
        userText: `${template.title}\n\n${template.description ?? ''}`.trim(),
        trigger: 'scheduled',
        emit,
        signal
      })
    )
    await updateTask(taskId, { lastRunStatus: 'completed' })
    return true
  }).catch(async (error) => {
    await updateTask(taskId, { lastRunStatus: 'failed' })
    throw error
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
      const input = t.input as Record<string, unknown> | null
      if (input?.kind === 'watch') {
        const conversationId =
          typeof t.conversationId === 'string' ? t.conversationId : null
        const path = typeof input.path === 'string' ? input.path : null
        const deadline =
          typeof input.deadline === 'string' ? new Date(input.deadline) : null
        const intervalSec =
          typeof input.intervalSec === 'number' ? input.intervalSec : 60
        const root = conversationId ? getGroupDir(conversationId) : null
        const target =
          root && path && !isAbsolute(path) ? resolve(root, path) : null
        const timedOut = !!deadline && deadline.getTime() <= Date.now()
        if (!target || (!existsSync(target) && !timedOut)) {
          await updateTask(t.id, {
            status: 'pending',
            runAt: new Date(Date.now() + Math.max(60, intervalSec) * 1000)
          })
          continue
        }
        await updateTask(t.id, {
          description: timedOut
            ? `${t.description ?? ''}\nWatch deadline reached.`
            : `${t.description ?? ''}\nWatch file appeared: ${path}.`
        })
      }
      if (await runScheduledRound(t.id, emit))
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
    if (
      t.status === 'pending' &&
      t.cronExpression &&
      scheduleTask(t.id, t.cronExpression)
    )
      count++
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
