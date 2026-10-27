import {
  ACTOVIA_CLI_DOCS,
  ACTOVIA_HEALTH_DOCS,
  ACTOVIA_IPHONE_DOCS
} from '@actovia/shared/constants/external-urls'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  CommandLineIcon,
  HealthIcon,
  LinkSquare02Icon,
  SmartPhone01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { SettingsLabel } from '@/components/settings/settings-menu'
import { CommandLine } from '@/components/skills-market/command-line'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SETTINGS_TAB_SLUGS } from '@/hooks/use-settings-tab'

export const CLI_INSTALL_COMMAND = 'npm i -g @actovia-ai/cli'

/**
 * "Actovia everywhere" (ISSUE-237): the rest of the family — the iPhone app,
 * its Health workspace and the CLI — each with what it is for and where to
 * read more. Opened from the account menu.
 */
export function AppsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()

  const pairIphone = () => {
    onOpenChange(false)
    navigate(`/settings?tab=${SETTINGS_TAB_SLUGS[SettingsLabel.Devices]}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid={TEST_IDS.chatLayout.appsDialog}
      >
        <DialogHeader>
          <DialogTitle>{t('apps.title')}</DialogTitle>
          <DialogDescription>{t('apps.description')}</DialogDescription>
        </DialogHeader>
        <div className="divide-border/60 flex flex-col divide-y">
          <AppRow
            icon={SmartPhone01Icon}
            title={t('apps.iphone.title')}
            body={t('apps.iphone.body')}
            href={ACTOVIA_IPHONE_DOCS}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={pairIphone}
              data-testid={TEST_IDS.chatLayout.appsPairIphone}
            >
              {t('apps.iphone.pair')}
            </Button>
          </AppRow>
          <AppRow
            icon={HealthIcon}
            title={t('apps.health.title')}
            body={t('apps.health.body')}
            href={ACTOVIA_HEALTH_DOCS}
          />
          <AppRow
            icon={CommandLineIcon}
            title={t('apps.cli.title')}
            body={t('apps.cli.body')}
            href={ACTOVIA_CLI_DOCS}
          >
            <CommandLine command={CLI_INSTALL_COMMAND} className="w-full" />
          </AppRow>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AppRow({
  icon,
  title,
  body,
  href,
  children
}: {
  icon: IconSvgElement
  title: string
  body: string
  href: string
  children?: React.ReactNode
}) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex gap-3 py-4 first:pt-1 last:pb-1">
      <div className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <HugeiconsIcon icon={icon} className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{title}</span>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs underline-offset-4 transition-colors hover:underline"
          >
            {t('apps.learnMore')}
            <HugeiconsIcon icon={LinkSquare02Icon} size={12} />
          </a>
        </div>
        <p className="text-muted-foreground text-sm">{body}</p>
        {children && <div className="mt-2 flex">{children}</div>}
      </div>
    </div>
  )
}
