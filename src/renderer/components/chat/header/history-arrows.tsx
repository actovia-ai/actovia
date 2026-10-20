import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { useTranslation } from 'react-i18next'

import { TooltipProvider } from '@/components/ui/tooltip'
import { useRouteHistory } from '@/hooks/use-route-history'

import { HeaderButton } from './header-button'

/**
 * `←` `→` over the app's own page history (spec 2026-10-08 §3), beside the
 * sidebar toggle wherever it is — the sidebar's top row while the sidebar is
 * open, the content header once it is away (owner, 2026-10-08: the arrows
 * belong with the fold icon, as in Claude's app).
 */
export function HistoryArrows() {
  const { t } = useTranslation('chat')
  const { canGoBack, canGoForward, goBack, goForward } = useRouteHistory()

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        <HeaderButton
          label={t('header.back')}
          icon={ArrowLeft01Icon}
          disabled={!canGoBack}
          onClick={goBack}
          testId={TEST_IDS.chat.header.back}
        />
        <HeaderButton
          label={t('header.forward')}
          icon={ArrowRight01Icon}
          disabled={!canGoForward}
          onClick={goForward}
          testId={TEST_IDS.chat.header.forward}
        />
      </div>
    </TooltipProvider>
  )
}
