import {
  ACTOVIA_CLI_DOCS,
  ACTOVIA_APP_STORE,
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

import appStoreBadge from '@/assets/images/app-store-badge.svg'
import { SettingsLabel } from '@/components/settings/settings-menu'
import { CommandLine } from '@/components/skills-market/command-line'
import { Button } from '@/components/ui/button'
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle
} from '@/components/ui/code-block'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SETTINGS_TAB_SLUGS } from '@/hooks/use-settings-tab'

import { OdyMark } from './ody-mark'

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
        className="max-h-[85dvh] overflow-y-auto sm:max-w-5xl"
        data-testid={TEST_IDS.chatLayout.appsDialog}
      >
        <DialogHeader>
          <DialogTitle>{t('apps.title')}</DialogTitle>
          <DialogDescription>{t('apps.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AppRow
            illustration="iphone"
            icon={SmartPhone01Icon}
            title={t('apps.iphone.title')}
            body={t('apps.iphone.body')}
            href={ACTOVIA_IPHONE_DOCS}
          >
            <a
              href={ACTOVIA_APP_STORE}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-visible:outline-ring inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              <img
                src={appStoreBadge}
                width={120}
                height={40}
                alt={t('apps.iphone.download')}
                className="h-10 w-auto"
              />
            </a>
            <Button
              size="sm"
              variant="outline"
              className="h-10 px-3"
              onClick={pairIphone}
              data-testid={TEST_IDS.chatLayout.appsPairIphone}
            >
              {t('apps.iphone.pair')}
            </Button>
          </AppRow>
          <AppRow
            illustration="health"
            icon={HealthIcon}
            title={t('apps.health.title')}
            body={t('apps.health.body')}
            href={ACTOVIA_HEALTH_DOCS}
          />
          <AppRow
            illustration="cli"
            icon={CommandLineIcon}
            title={t('apps.cli.title')}
            body={t('apps.cli.body')}
            href={ACTOVIA_CLI_DOCS}
          >
            <CommandLine
              command={CLI_INSTALL_COMMAND}
              wrap
              className="w-full"
            />
          </AppRow>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AppRow({
  icon,
  illustration,
  title,
  body,
  href,
  children
}: {
  illustration: 'iphone' | 'health' | 'cli'
  icon: IconSvgElement
  title: string
  body: string
  href: string
  children?: React.ReactNode
}) {
  const { t } = useTranslation('chat')
  return (
    <article
      className={`bg-muted/30 flex min-w-0 flex-col overflow-hidden rounded-2xl border ${illustration === 'cli' ? 'sm:col-span-2 lg:col-span-1' : ''}`}
    >
      <AppIllustration kind={illustration} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={icon} className="text-muted-foreground size-4" />
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
        {children && (
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
            {children}
          </div>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs underline-offset-4 hover:underline"
        >
          {t('apps.learnMore')}
          <HugeiconsIcon icon={LinkSquare02Icon} size={12} />
        </a>
      </div>
    </article>
  )
}

/** Original line illustrations: the phone, its Health rings, and the local terminal. */
function AppIllustration({ kind }: { kind: 'iphone' | 'health' | 'cli' }) {
  if (kind === 'cli')
    return (
      <div
        aria-hidden
        className="bg-muted flex h-40 items-end overflow-hidden px-4 pt-5"
      >
        <CodeBlock className="w-full rounded-b-none">
          <CodeBlockHeader>
            <CodeBlockTitle>actovia</CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent className="min-h-24 px-4 py-3 text-xs">
            {'$ actovia status\n$ actovia skills list\n$ actovia app check'}
          </CodeBlockContent>
        </CodeBlock>
      </div>
    )
  if (kind === 'iphone')
    return (
      <div
        aria-hidden
        className="bg-muted flex h-40 items-center justify-center"
      >
        <OdyMark className="size-24" />
      </div>
    )
  return (
    <div
      className="bg-muted flex h-40 items-end justify-center overflow-hidden pt-5"
      aria-hidden
    >
      <svg
        viewBox="0 0 240 160"
        className="text-foreground h-full w-full"
        fill="none"
      >
        {
          <>
            <rect
              x="30"
              y="20"
              width="180"
              height="119"
              rx="16"
              className="fill-background"
              stroke="currentColor"
              strokeOpacity=".12"
            />
            <circle
              cx="91"
              cy="78"
              r="34"
              stroke="#eb4969"
              strokeOpacity=".15"
              strokeWidth="8"
            />
            <circle
              cx="91"
              cy="78"
              r="34"
              stroke="#eb4969"
              strokeWidth="8"
              strokeDasharray="165 214"
              strokeLinecap="round"
              transform="rotate(-90 91 78)"
            />
            <circle
              cx="91"
              cy="78"
              r="23"
              stroke="#85ad30"
              strokeOpacity=".15"
              strokeWidth="8"
            />
            <circle
              cx="91"
              cy="78"
              r="23"
              stroke="#85ad30"
              strokeWidth="8"
              strokeDasharray="120 145"
              strokeLinecap="round"
              transform="rotate(-90 91 78)"
            />
            <circle
              cx="91"
              cy="78"
              r="12"
              stroke="#38a7c0"
              strokeWidth="8"
              strokeDasharray="60 76"
              strokeLinecap="round"
              transform="rotate(-90 91 78)"
            />
            <path
              d="M145 58h38m-38 11h26m-26 23h38m-38 11h22"
              stroke="currentColor"
              strokeOpacity=".35"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        }
      </svg>
    </div>
  )
}
