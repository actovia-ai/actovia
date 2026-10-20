// src/main/lib/server/routes/philharmonic-tasks.ts
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import cron from 'node-cron'
import { z } from 'zod'

import { scheduleTask, unscheduleTask } from '../../ai/philharmonic/scheduler'
import {
  createTask,
  getActiveCronTasks,
  getUpcomingOneOffTasks,
  updateTask
} from '../../db/philharmonic-queries'
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
    conversationId: z.string().uuid(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    cronExpression: z.string().min(1).optional().nullable(),
    runAt: z.string().datetime().optional().nullable()
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
  const row = await handleDatabaseOperation(
    () =>
      createTask({
        title: data.title,
        description: data.description,
        conversationId: data.conversationId,
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
