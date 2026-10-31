import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import {
  getActiveCronTasks,
  getTaskById,
  getUpcomingOneOffTasks
} from '../../db/philharmonic-queries'
import {
  chatScheduleOwner,
  deleteChatSchedule,
  saveChatSchedule
} from '../chat-schedules'

const schema = Type.Object({
  action: Type.Union(
    ['list', 'get', 'create', 'update', 'delete'].map((v) => Type.Literal(v))
  ),
  taskId: Type.Optional(
    Type.String({
      description: 'Existing task id for get/update/delete. Never invent one.'
    })
  ),
  title: Type.Optional(Type.String()),
  description: Type.Optional(
    Type.String({
      description:
        'Complete instructions to execute at each firing, without needing another clarification.'
    })
  ),
  cronExpression: Type.Optional(
    Type.String({
      description:
        'Five-field cron in the computer local time zone. Omit for a one-off.'
    })
  ),
  runAt: Type.Optional(
    Type.String({
      description:
        'One-off future ISO-8601 time with an explicit UTC offset. Omit for recurring.'
    })
  )
})

/** Bound only to interactive Chat, never a Group employee or a scheduled run. */
export function manageSchedule(chatId: string): AgentTool<typeof schema> {
  return {
    name: TOOL_NAMES.manageSchedule,
    label: 'Manage Schedule',
    description: `Manage scheduled tasks for this Chat. Read with list/get before editing or deleting. Clarify ambiguous instructions, time, recurrence and timezone in conversation before saving; if already clear, save directly. Create binds to this Chat. For update, provide the complete title, description and exactly one schedule field, copying unchanged values from get. Update keeps the same task id; when its original Chat was deleted, saving adopts it into this Chat. Philharmonic tasks are read-only. Results run locally while Actovia is open; do not promise push notifications. For relative times, call list first to obtain the current clock and computer time zone.`,
    parameters: schema,
    execute: async (_id, args, signal) => {
      if (signal?.aborted) throw new Error('Aborted')
      let result: unknown
      if (args.action === 'list') {
        const rows = [
          ...(await getUpcomingOneOffTasks()),
          ...(await getActiveCronTasks())
        ]
        result = {
          now: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          tasks: rows.filter((t) => chatScheduleOwner(t) === chatId)
        }
      } else if (args.action === 'get') {
        if (!args.taskId) throw new Error('taskId is required')
        result = await getTaskById(args.taskId)
        if (!result) throw new Error('Scheduled task not found')
      } else if (args.action === 'delete') {
        if (!args.taskId) throw new Error('taskId is required')
        result = await deleteChatSchedule(args.taskId, chatId)
      } else {
        if (args.action === 'update' && !args.taskId)
          throw new Error('taskId is required')
        result = await saveChatSchedule(
          chatId,
          {
            title: args.title ?? '',
            description: args.description ?? '',
            cronExpression: args.cronExpression || null,
            runAt: args.runAt || null
          },
          args.action === 'update' ? args.taskId : undefined
        )
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result
      }
    }
  }
}
