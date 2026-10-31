import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ScheduleTab } from '@/components/philharmonic/schedule/schedule-tab'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useChatHistory } from '@/hooks/use-chat-history'
import { getConversations } from '@/services/philharmonic-chat'

export function Scheduled() {
  const { t } = useTranslation(['philharmonic', 'common'])
  const groups = useQuery({
    queryKey: ['schedule-conversations'],
    queryFn: getConversations
  })
  const chats = useChatHistory()
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={TEST_IDS.schedule.page}
    >
      {groups.isPending || chats.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : groups.isError || chats.error ? (
        <div className="m-auto flex flex-col items-center gap-3">
          <p>{t('schedule.toast.loadUpcomingFailed')}</p>
          <Button
            onClick={() => {
              void groups.refetch()
              void chats.refetch()
            }}
          >
            {t('common:action.retry')}
          </Button>
        </div>
      ) : (
        <ScheduleTab
          standalone
          conversations={groups.data ?? []}
          chats={chats.data ?? []}
        />
      )}
    </div>
  )
}
