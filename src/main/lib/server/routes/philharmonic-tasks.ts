// src/main/lib/server/routes/philharmonic-tasks.ts
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import cron from 'node-cron'
import { z } from 'zod'

import { scheduleTask, unscheduleTask } from '../../ai/philharmonic/scheduler'
import { getConversationById } from '../../db/conversation-queries'
import {
  createTask,
  getActiveCronTasks,
  getUpcomingOneOffTasks,
  updateTask
} from '../../db/philharmonic-queries'
import { getChatById } from '../../db/queries'
import type { Variables } from '../types'
import {
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const philharmonicTasks = new Hono<{ Variables: Variables }>()

/** Exactly one of cronExpression/runAt distinguishes recurring vs one-off. */
export const scheduleTaskSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    conversationId: z.string().uuid().optional(),
    chatId: z.string().uuid().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    cronExpression: z.string().min(1).optional().nullable(),
    runAt: z.string().datetime().optional().nullable()
  })
  .refine((d) => Boolean(d.conversationId) !== Boolean(d.chatId), {
    message: 'Choose exactly one chat or Group'
  })
  .refine((d) => Boolean(d.cronExpression) !== Boolean(d.runAt), {
    message: 'Exactly one of cronExpression or runAt must be set'
  })

const cancelTaskSchema = z.object({ status: z.literal('cancelled') })

// ─── Scheduled tasks ────────────────────────────────────────────────────────

philharmonicTasks.get('/tasks/upcoming', async (c) =>
  successResponse(
    c,
    await handleDatabaseOperation(
      () => getUpcomingOneOffTasks(),
      'Failed to list upcoming tasks'
    )
  )
)

philharmonicTasks.get('/tasks/recurring', async (c) =>
  successResponse(
    c,
    await handleDatabaseOperation(
      () => getActiveCronTasks(),
      'Failed to list recurring tasks'
    )
  )
)

philharmonicTasks.post('/tasks', async (c) => {
  const data = validateSchema(
    scheduleTaskSchema,
    await c.req.json(),
    'Invalid scheduled task'
  )
  if (data.cronExpression && !cron.validate(data.cronExpression)) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Invalid cron expression'
    )
  }
  if (data.runAt && new Date(data.runAt).getTime() <= Date.now())
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Choose a future time'
    )
  const target = data.chatId
    ? await getChatById({ id: data.chatId })
    : await getConversationById(data.conversationId!)
  if (!target)
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'The selected conversation no longer exists'
    )
  const row = await handleDatabaseOperation(
    () =>
      createTask({
        title: data.title,
        description: data.description,
        conversationId: data.conversationId,
        input: data.chatId
          ? { kind: 'chat-schedule', chatId: data.chatId }
          : null,
        priority: data.priority,
        cronExpression: data.cronExpression ?? null,
        runAt: data.runAt ? new Date(data.runAt) : null
      }),
    'Failed to create scheduled task'
  )
  if (data.cronExpression) scheduleTask(row.id, data.cronExpression)
  return successResponse(c, row, 201)
})

philharmonicTasks.patch('/tasks/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  validateSchema(cancelTaskSchema, await c.req.json(), 'Invalid task update')
  unscheduleTask(id)
  return successResponse(
    c,
    await handleDatabaseOperation(
      () => updateTask(id, { status: 'cancelled' }),
      'Failed to cancel task'
    )
  )
})

export default philharmonicTasks
