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
        className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"
        data-testid={TEST_IDS.chatLayout.appsDialog}
      >
        <DialogHeader>
          <DialogTitle>{t('apps.title')}</DialogTitle>
          <DialogDescription>{t('apps.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <AppRow
            illustration="iphone"
            icon={SmartPhone01Icon}
            title={t('apps.iphone.title')}
            body={t('apps.iphone.body')}
            href={ACTOVIA_IPHONE_DOCS}
          >
            <Button
              render={
                <a
                  href={ACTOVIA_APP_STORE}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              size="sm"
            >
              {t('apps.iphone.download')}
            </Button>
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
            <CommandLine command={CLI_INSTALL_COMMAND} className="w-full" />
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
    <article className="bg-muted/30 flex min-w-0 flex-col overflow-hidden rounded-2xl border">
      <AppIllustration kind={illustration} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={icon} className="text-muted-foreground size-4" />
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
        {children && (
          <div className="mt-auto flex flex-wrap gap-2 pt-2">{children}</div>
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
        {kind === 'iphone' ? (
          <>
            <rect
              x="72"
              y="3"
              width="96"
              height="180"
              rx="20"
              className="fill-background"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect
              x="102"
              y="12"
              width="36"
              height="8"
              rx="4"
              fill="currentColor"
            />
            <path
              d="M123 44h26a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-26z"
              className="fill-primary/15"
            />
            <path
              d="M85 82h49m-49 9h57m-57 9h39"
              stroke="currentColor"
              strokeOpacity=".45"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="98" cy="122" r="11" className="fill-primary/15" />
            <path
              d="M94 122h8m-4-4v8"
              stroke="currentColor"
              strokeLinecap="round"
            />
            <path
              d="M86 148h68"
              stroke="currentColor"
              strokeOpacity=".2"
              strokeWidth="14"
              strokeLinecap="round"
            />
          </>
        ) : kind === 'health' ? (
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
        ) : (
          <>
            <rect
              x="19"
              y="22"
              width="202"
              height="119"
              rx="12"
              className="fill-background"
              stroke="currentColor"
              strokeOpacity=".2"
            />
            <path d="M19 48h202" stroke="currentColor" strokeOpacity=".12" />
            {[32, 43, 54].map((x) => (
              <circle
                key={x}
                cx={x}
                cy="35"
                r="3"
                fill="currentColor"
                opacity=".3"
              />
            ))}
            <path
              d="m36 68 8 7-8 7m16 0h8"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M36 103h122m-122 12h87"
              stroke="currentColor"
              strokeOpacity=".3"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </div>
  )
}
