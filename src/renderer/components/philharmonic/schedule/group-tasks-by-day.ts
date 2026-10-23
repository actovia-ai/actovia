import { isSameDay } from 'date-fns'

import type { TaskData } from '@/stores/philharmonic'

export interface TaskDayGroup {
  day: Date
  tasks: TaskData[]
}

/**
 * Groups one-off tasks by the calendar day of their `runAt`. Tasks without
 * `runAt` are dropped. Assumes `tasks` is already sorted by `runAt` ascending
 * (true for `getUpcomingTasks()`'s response) — groups come out in that order.
 */
export function groupTasksByDay(tasks: TaskData[]): TaskDayGroup[] {
  const groups: TaskDayGroup[] = []
  for (const t of tasks) {
    if (!t.runAt) continue
    const day = new Date(t.runAt)
    const existing = groups.find((g) => isSameDay(g.day, day))
    if (existing) {
      existing.tasks.push(t)
    } else {
      groups.push({ day, tasks: [t] })
    }
  }
  return groups
}
