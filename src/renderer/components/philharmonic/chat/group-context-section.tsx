import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePmContext } from '@/hooks/use-pm-context'

import { ContextView } from '../../chat/panel/context-section'

export function GroupContextSection({
  conversationId,
  revision
}: {
  conversationId: string
  revision: number
}) {
  const { t } = useTranslation(['chat', 'common'])
  const { data, isPending, isError, refetch } = usePmContext({
    conversationId,
    revision,
    enabled: true
  })

  if (isPending) return <Skeleton className="m-3 h-40 rounded-lg" />
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
        <p className="text-muted-foreground text-sm">
          {t('common:clipboard.genericError')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common:action.retry')}
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <p className="text-muted-foreground px-3 py-6 text-center text-sm">
        {t('chat:panel.context.empty')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground truncate px-3 pt-2 text-xs">
        {data.model}
      </p>
      <ContextView
        snapshot={data}
        testId={TEST_IDS.philharmonic.contextSection}
      />
    </div>
  )
}
