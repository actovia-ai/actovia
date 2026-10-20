// src/renderer/services/philharmonic-tasks.ts
import { fetcher } from '@actovia/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'
import type { TaskData } from '@/stores/philharmonic'

const BASE = '/api/v1/philharmonic'

export const getUpcomingTasks = () =>
  fetcher<TaskData[]>(`${BASE}/tasks/upcoming`)

export const getRecurringTasks = () =>
  fetcher<TaskData[]>(`${BASE}/tasks/recurring`)

// A scheduled task's run is a PM run: loopback needs the window's token.
export const createScheduledTask = async (data: {
  title: string
  description?: string
  conversationId: string
  priority?: TaskData['priority']
  cronExpression?: string | null
  runAt?: string | null
}) =>
  fetcher<TaskData>(`${BASE}/tasks`, {
    method: 'POST',
    body: data as never,
    headers: await presenceHeaders()
  })

export const cancelScheduledTask = async (id: string) =>
  fetcher<TaskData>(`${BASE}/tasks/${id}`, {
    method: 'PATCH',
    body: { status: 'cancelled' } as never,
    headers: await presenceHeaders()
  })
