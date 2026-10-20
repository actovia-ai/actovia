import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { useTranslation } from 'react-i18next'

import { HeaderButton } from '@/components/chat/header/header-button'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Philharmonic's title-bar action, where Chat keeps its history arrows: beside
 * the sidebar toggle in the sidebar's top row, and in the content bar once the
 * sidebar is away (owner, 2026-10-09: the arrows had nothing to step through
 * here; a new group is what this surface starts from).
 */
export function NewGroupButton({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation('philharmonic')
  return (
    <TooltipProvider>
      <HeaderButton
        label={t('chat.conversationList.newGroupMenuItem')}
        icon={PencilEdit02Icon}
        onClick={onCreate}
        testId={TEST_IDS.philharmonic.newGroup}
      />
    </TooltipProvider>
  )
}
