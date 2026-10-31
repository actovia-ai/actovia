import cron from 'node-cron'
import { z } from 'zod'

import {
  createTask,
  getTaskById,
  updateChatScheduledTask
} from '../db/philharmonic-queries'
import { getChatById } from '../db/queries'
import type { Task } from '../db/schema'

export const chatScheduleSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(20_000),
    cronExpression: z.string().nullable(),
    runAt: z.string().datetime({ offset: true }).nullable()
  })
  .refine((d) => Boolean(d.cronExpression) !== Boolean(d.runAt), {
    message: 'Set exactly one of cronExpression or runAt'
  })

export type ChatSchedule = z.infer<typeof chatScheduleSchema>

export function chatScheduleOwner(
  task: Pick<Task, 'input' | 'conversationId'>
): string | null {
  return !task.conversationId &&
    task.input?.kind === 'chat-schedule' &&
    typeof task.input.chatId === 'string'
    ? task.input.chatId
    : null
}

export async function requireChatSchedule(id: string) {
  const task = await getTaskById(id)
  if (!task) throw new Error('Scheduled task not found')
  if (!chatScheduleOwner(task))
    throw new Error('Philharmonic tasks are read-only here')
  if (!task.cronExpression && !task.runAt)
    throw new Error('This is not a scheduled task')
  return task
}

function validateTime(data: ChatSchedule) {
  if (data.cronExpression && !cron.validate(data.cronExpression))
    throw new Error('Invalid cron expression')
  if (data.runAt && new Date(data.runAt).getTime() <= Date.now())
    throw new Error('Choose a future time')
}

/** A missing origin can be adopted only when a real new Chat saves an edit. */
export async function saveChatSchedule(
  chatId: string,
  data: ChatSchedule,
  taskId?: string
) {
  data = chatScheduleSchema.parse(data)
  validateTime(data)
  if (!(await getChatById({ id: chatId })))
    throw new Error('Chat no longer exists')
  const existing = taskId ? await requireChatSchedule(taskId) : null
  if (existing) {
    const owner = chatScheduleOwner(existing)!
    if (owner !== chatId && (await getChatById({ id: owner })))
      throw new Error('Edit this task in its original Chat conversation')
    if (
      existing.status === 'running' ||
      existing.status === 'cancelled' ||
      existing.status === 'completed'
    )
      throw new Error('This task cannot be edited in its current state')
  }
  const values = {
    ...data,
    runAt: data.runAt ? new Date(data.runAt) : null,
    input: { kind: 'chat-schedule', chatId },
    status: 'pending' as const,
    lastRunStatus: null
  }
  const row = existing
    ? await updateChatScheduledTask(
        existing.id,
        chatScheduleOwner(existing)!,
        values
      )
    : await createTask(values)
  if (!row)
    throw new Error('Task changed while editing; read it again and retry')
  const { scheduleTask, unscheduleTask } =
    await import('./philharmonic/scheduler')
  unscheduleTask(row.id)
  if (row.cronExpression) scheduleTask(row.id, row.cronExpression)
  return row
}

/** Soft deletion keeps run history, and never requires the origin to exist. */
export async function deleteChatSchedule(
  id: string,
  requestingChatId?: string
) {
  const task = await requireChatSchedule(id)
  const owner = chatScheduleOwner(task)!
  if (
    requestingChatId &&
    owner !== requestingChatId &&
    (await getChatById({ id: owner }))
  )
    throw new Error('Delete this task in its original Chat conversation')
  if (task.status === 'cancelled') return task
  const row = await updateChatScheduledTask(
    id,
    owner,
    { status: 'cancelled' },
    true
  )
  if (!row) throw new Error('Task changed while deleting; refresh and retry')
  const { unscheduleTask } = await import('./philharmonic/scheduler')
  unscheduleTask(id)
  return row
}
