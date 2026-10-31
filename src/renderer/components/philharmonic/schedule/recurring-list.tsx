import { CronExpressionParser } from 'cron-parser'
import { type TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useFormat } from '@/lib/format'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { cronPresetKey } from './cron-presets'
import { TaskCard } from './task-card'
import { taskOriginId } from './task-origin'

/**
 * A recurring task's line: when it last ran, its schedule — by name when it
 * is one the form offers ("Every Monday at 9:00 AM"), else its cron line —
 * and when it runs next, in the user's locale.
 */
export function describeSchedule(
  task: Pick<TaskData, 'cronExpression' | 'lastRunAt'>,
  t: TFunction<'philharmonic'>,
  dateTime: (d: Date, o?: Intl.DateTimeFormatOptions) => string,
  paused = false
): string {
  if (!task.cronExpression) return ''
  const when = (d: Date) =>
    dateTime(d, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  const preset = cronPresetKey(task.cronExpression)
  const parts = [
    task.lastRunAt
      ? t('schedule.recurringList.lastRun', {
          time: when(new Date(task.lastRunAt))
        })
      : null,
    preset ? t(`schedule.form.cronPresets.${preset}`) : task.cronExpression
  ]
  try {
    const next = CronExpressionParser.parse(task.cronExpression).next().toDate()
    if (!paused)
      parts.push(t('schedule.recurringList.nextRun', { time: when(next) }))
  } catch {
    // an unparsable line still shows as written
  }
  return parts.filter(Boolean).join(' · ')
}

export function RecurringList({
  tasks,
  conversationsById,
  cancellingId,
  onCancel,
  onEdit
}: {
  tasks: TaskData[]
  conversationsById: Record<string, Pick<ConversationData, 'title'>>
  cancellingId: string | null
  onCancel: (id: string) => void
  onEdit?: (task: TaskData) => void
}) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        {t('schedule.recurringList.empty')}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl space-y-2 px-4 py-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            originExists={Boolean(conversationsById[taskOriginId(task)])}
            onEdit={onEdit}
            groupTitle={
              conversationsById[taskOriginId(task)]?.title ??
              t('schedule.unknownGroup')
            }
            subtitle={describeSchedule(
              task,
              t,
              dateTime,
              !conversationsById[taskOriginId(task)]
            )}
            onCancel={onCancel}
            cancelling={cancellingId === task.id}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
