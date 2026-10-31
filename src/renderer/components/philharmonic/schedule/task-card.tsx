import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  Loading03Icon,
  Delete02Icon,
  Edit02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TaskData } from '@/stores/philharmonic'

export function TaskCard({
  task,
  groupTitle,
  subtitle,
  originExists = false,
  onEdit,
  onCancel,
  cancelling
}: {
  task: TaskData
  groupTitle: string
  /** Recurring: cron expression + next-run text. One-off: time of day. */
  subtitle: string
  originExists?: boolean
  onEdit?: (task: TaskData) => void
  onCancel: (id: string) => void
  cancelling: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const statusLabel: Record<TaskData['status'], string> = useMemo(
    () => ({
      pending: t('schedule.taskCard.status.pending'),
      running: t('schedule.taskCard.status.running'),
      completed: t('schedule.taskCard.status.completed'),
      failed: t('schedule.taskCard.status.failed'),
      cancelled: t('schedule.taskCard.status.cancelled'),
      waiting_for_user: t('schedule.taskCard.status.waiting_for_user')
    }),
    [t]
  )
  const priorityLabel: Record<TaskData['priority'], string> = useMemo(
    () => ({
      low: t('schedule.taskCard.priority.low'),
      medium: t('schedule.taskCard.priority.medium'),
      high: t('schedule.taskCard.priority.high'),
      urgent: t('schedule.taskCard.priority.urgent')
    }),
    [t]
  )
  const chatId =
    !task.conversationId &&
    task.input?.kind === 'chat-schedule' &&
    typeof task.input.chatId === 'string'
      ? task.input.chatId
      : null
  const editable =
    Boolean(chatId) && ['pending', 'failed'].includes(task.status)
  const cancellable =
    Boolean(chatId) && ['pending', 'failed', 'running'].includes(task.status)
  return (
    <div
      data-testid={TEST_IDS.schedule.taskCard}
      className="bg-muted flex items-start justify-between gap-3 rounded-2xl px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold break-words">
            {task.title}
          </span>
          <Badge variant="outline" className="bg-background text-2xs shrink-0">
            {priorityLabel[task.priority]}
          </Badge>
          <Badge
            variant={task.status === 'failed' ? 'destructive' : 'secondary'}
            className="text-2xs shrink-0"
          >
            {statusLabel[task.status]}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {originExists ? (
            <Link
              data-testid={TEST_IDS.schedule.originLink}
              to={
                chatId
                  ? `/chat/${chatId}`
                  : `/philharmonic/groups/${task.conversationId}`
              }
              className="hover:text-foreground max-w-full truncate underline-offset-4 hover:underline"
              title={groupTitle}
            >
              {t(
                chatId ? 'schedule.form.chatLabel' : 'schedule.form.groupLabel'
              )}{' '}
              · {groupTitle}
            </Link>
          ) : (
            <span data-testid={TEST_IDS.schedule.originDeleted}>
              {t('schedule.manage.originDeleted')}
            </span>
          )}
          <span>{subtitle}</span>
        </div>
        {chatId && !originExists && (
          <p className="text-muted-foreground mt-1 text-xs">
            {t('schedule.manage.resumeInChat')}
          </p>
        )}
        {!chatId && (
          <p className="text-muted-foreground mt-1 text-xs">
            {t('schedule.manage.groupReadOnly')}
          </p>
        )}
        {task.description && (
          <p className="text-muted-foreground mt-2 line-clamp-2 text-sm break-words">
            {task.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {editable && onEdit && (
          <Button
            data-testid={TEST_IDS.schedule.editButton}
            variant="ghost"
            size="icon-sm"
            aria-label={t('schedule.manage.edit')}
            title={t('schedule.manage.edit')}
            onClick={() => onEdit(task)}
          >
            <HugeiconsIcon icon={Edit02Icon} className="size-4" />
          </Button>
        )}
        {cancellable && (
          <Button
            data-testid={TEST_IDS.schedule.cancelButton}
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
            disabled={cancelling}
            onClick={() => onCancel(task.id)}
            aria-label={t('schedule.manage.delete')}
            title={t('schedule.manage.delete')}
          >
            {cancelling ? (
              <HugeiconsIcon
                icon={Loading03Icon}

                className="h-3.5 w-3.5 animate-spin"
              />
            ) : (
              <HugeiconsIcon
                icon={Delete02Icon}

                className="h-3.5 w-3.5"
              />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
