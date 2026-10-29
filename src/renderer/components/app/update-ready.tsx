import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useUpdater } from '@/hooks/use-updater'
import { cn } from '@/lib/cn'
import { ENTER_UP } from '@/lib/motion'

/**
 * An update downloaded by itself waits for a restart, and it is installed on
 * quit — but the window only hides on close, so a quit can be weeks away.
 * This card, above the account menu, says it is there and restarts on the
 * click; nothing restarts by itself.
 */
export function UpdateReadyCard({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const { payload, install } = useUpdater()
  const [restarting, setRestarting] = useState(false)

  if (payload.state !== 'ready' || payload.mode !== 'auto') return null

  return (
    <div
      data-testid={TEST_IDS.chatLayout.updateReady}
      className={cn(
        'bg-sidebar-accent text-sidebar-accent-foreground flex items-center gap-2 rounded-lg px-3 py-2',
        ENTER_UP,
        className
      )}
    >
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="text-ui truncate font-medium">
          {payload.availableVersion
            ? t('sidebar.update.ready', { version: payload.availableVersion })
            : t('sidebar.update.readyNoVersion')}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {t('sidebar.update.hint')}
        </span>
      </div>
      <Button
        size="xs"
        disabled={restarting}
        data-testid={TEST_IDS.chatLayout.updateRestart}
        onClick={() => {
          setRestarting(true)
          void install()
        }}
      >
        {t('sidebar.update.restart')}
      </Button>
    </div>
  )
}

/**
 * The sidebar toggle a header shows while the sidebar is away, with a dot
 * while an update waits — the card it would show is hidden with it.
 */
export function HeaderSidebarTrigger({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const { payload } = useUpdater()
  const ready = payload.state === 'ready' && payload.mode === 'auto'

  return (
    <span className="no-drag relative inline-flex shrink-0">
      <SidebarTrigger className={className} />
      {ready && (
        <>
          <span
            aria-hidden
            data-testid={TEST_IDS.chatLayout.updateDot}
            className="bg-primary ring-card pointer-events-none absolute top-1 right-1 size-1.5 rounded-full ring-2"
          />
          <span className="sr-only">{t('sidebar.update.hint')}</span>
        </>
      )}
    </span>
  )
}
