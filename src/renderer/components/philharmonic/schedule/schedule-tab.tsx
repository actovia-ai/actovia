import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { PhilharmonicHeaderSlot } from '@/layouts/philharmonic-layout/philharmonic-content-header'
import {
  cancelScheduledTask,
  getRecurringTasks,
  getUpcomingTasks
} from '@/services/philharmonic-tasks'
import { advancedToolsAtom, attachmentAtom } from '@/stores/chat'
import { chatInputAtom, chatQuoteAtom } from '@/stores/input'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { RecurringList } from './recurring-list'
import { ScheduleTaskForm } from './schedule-task-form'
import { UpcomingList } from './upcoming-list'

export function ScheduleTab({
  conversations,
  chats = [],
  standalone = false
}: {
  conversations: ConversationData[]
  chats?: Array<{ id: string; title: string }>
  standalone?: boolean
}) {
  const { t } = useTranslation(['philharmonic', 'common'])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setInput = useSetAtom(chatInputAtom)
  const setTools = useSetAtom(advancedToolsAtom)
  const setAttachments = useSetAtom(attachmentAtom)
  const setQuote = useSetAtom(chatQuoteAtom)
  const upcomingQuery = useQuery({
    queryKey: ['scheduled-tasks', 'upcoming'],
    queryFn: getUpcomingTasks,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true
  })
  const recurringQuery = useQuery({
    queryKey: ['scheduled-tasks', 'recurring'],
    queryFn: getRecurringTasks,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true
  })
  const visibleHere = (task: TaskData) =>
    standalone || task.input?.kind !== 'chat-schedule'
  const upcoming = (upcomingQuery.data ?? []).filter(visibleHere)
  const recurring = (recurringQuery.data ?? []).filter(visibleHere)
  const [formOpen, setFormOpen] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const conversationsById = useMemo(
    () =>
      Object.fromEntries([...conversations, ...chats].map((c) => [c.id, c])),
    [conversations, chats]
  )

  const startChat = (task?: TaskData) => {
    const chatId =
      typeof task?.input?.chatId === 'string' ? task.input.chatId : null
    const originExists = chatId && chats.some((chat) => chat.id === chatId)
    setTools([])
    setAttachments(undefined)
    setQuote(null)
    setInput(
      task
        ? t('schedule.manage.editPrompt', {
            task: JSON.stringify({
              id: task.id,
              title: task.title,
              description: task.description,
              cronExpression: task.cronExpression,
              runAt: task.runAt
            })
          })
        : t('schedule.manage.createPrompt')
    )
    void navigate(originExists ? `/chat/${chatId}` : '/')
  }

  const handleCreated = useCallback(
    (_task: TaskData) => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
    [queryClient]
  )

  const handleCancel = useCallback(
    async (id: string) => {
      setCancellingId(id)
      try {
        await cancelScheduledTask(id)
        await queryClient.cancelQueries({ queryKey: ['scheduled-tasks'] })
        for (const kind of ['upcoming', 'recurring'])
          queryClient.setQueryData<TaskData[]>(
            ['scheduled-tasks', kind],
            (rows) => rows?.filter((task) => task.id !== id)
          )
        void queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
        toast.add({ type: 'success', title: t('schedule.toast.taskCancelled') })
      } catch (err) {
        toast.add({
          type: 'error',
          title: t('schedule.toast.cancelTaskFailed'),
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setCancellingId(null)
      }
    },
    [t, queryClient]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* "Schedule task" at the content bar's right end; the bar's tab names the page. */}
      {standalone && (
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4 px-6 pt-6 pb-3">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">
              {t('schedule.page.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('schedule.page.description')}
            </p>
            <p className="text-muted-foreground mt-3 text-xs">
              {t('schedule.page.localOnly')}
            </p>
          </div>
          <Button
            onClick={() => startChat()}
            data-testid={TEST_IDS.schedule.createButton}
          >
            {t('schedule.manage.newTask')}
          </Button>
        </div>
      )}
      {!standalone && (
        <PhilharmonicHeaderSlot>
          <Button
            className="no-drag rounded-full"
            data-testid={TEST_IDS.schedule.createButton}
            type="button"
            size="sm"
            onClick={() => setFormOpen(true)}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
            {t('schedule.scheduleTaskButton')}
          </Button>
        </PhilharmonicHeaderSlot>
      )}
      {upcomingQuery.isPending || recurringQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : upcomingQuery.isError || recurringQuery.isError ? (
        <div className="m-auto flex flex-col items-center gap-3 px-6 text-center">
          <p>{t('schedule.toast.loadUpcomingFailed')}</p>
          <Button
            onClick={() => {
              void upcomingQuery.refetch()
              void recurringQuery.refetch()
            }}
          >
            {t('common:action.retry')}
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="upcoming" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-auto mt-3 w-fit shrink-0">
            <TabsTrigger value="upcoming">
              {t('schedule.tab.upcomingTrigger')}
            </TabsTrigger>
            <TabsTrigger value="recurring">
              {t('schedule.tab.recurringTrigger')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="min-h-0 flex-1">
            <UpcomingList
              tasks={upcoming}
              conversationsById={conversationsById}
              cancellingId={cancellingId}
              onCancel={handleCancel}
              onEdit={standalone ? startChat : undefined}
            />
          </TabsContent>
          <TabsContent value="recurring" className="min-h-0 flex-1">
            <RecurringList
              tasks={recurring}
              conversationsById={conversationsById}
              cancellingId={cancellingId}
              onCancel={handleCancel}
              onEdit={standalone ? startChat : undefined}
            />
          </TabsContent>
        </Tabs>
      )}
      {!standalone && (
        <ScheduleTaskForm
          open={formOpen}
          onOpenChange={setFormOpen}
          conversations={conversations}
          chats={chats}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
