import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useFormat } from '@/lib/format'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { groupTasksByDay } from './group-tasks-by-day'
import { TaskCard } from './task-card'
import { taskOriginId } from './task-origin'

export function UpcomingList({
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
  const groups = groupTasksByDay(tasks)
  const { dateTime } = useFormat()

  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        {t('schedule.upcomingList.empty')}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-3">
        {groups.map((group) => (
          <div key={group.day.toISOString()}>
            <div className="bg-card text-muted-foreground sticky top-0 z-10 mb-2 py-1 text-xs font-semibold">
              {dateTime(group.day, {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
              })}
            </div>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  originExists={Boolean(conversationsById[taskOriginId(task)])}
                  onEdit={onEdit}
                  groupTitle={
                    conversationsById[taskOriginId(task)]?.title ??
                    t('schedule.unknownGroup')
                  }
                  subtitle={dateTime(new Date(task.runAt!), {
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                  onCancel={onCancel}
                  cancelling={cancellingId === task.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
