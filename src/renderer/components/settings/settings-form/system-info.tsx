import { APP_DISPLAY_NAME } from '@actovia/shared/constants/brand'
import {
  ACTOVIA_REPO,
  ACTOVIA_TWITTER,
  ACTOVIA_WEBSITE
} from '@actovia/shared/constants/external-urls'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import logoDark from '@/assets/images/logo-dark.png'
import logoLight from '@/assets/images/logo-light.png'
import { Switch } from '@/components/ui/switch'
import { useUpdater } from '@/hooks/use-updater'
import { updaterSetAutoDownload } from '@/lib/ipc'

import { version } from '../../../../../package.json'
import { SettingsRow, SettingsSection } from '../settings-row'
import { UpdatePanel } from './update-panel'

function ExternalLink({
  href,
  children
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 transition-colors hover:underline"
    >
      {children}
      <HugeiconsIcon icon={LinkSquare02Icon} size={12} />
    </a>
  )
}

/**
 * Who this is, the way a Mac app's About window opens: the icon (the Liquid
 * Glass export, light or dark with the app's theme), the name, the version.
 * Rendered by `bun run icons`.
 */
function AboutHeader() {
  return (
    <div className="flex items-center gap-4">
      <img
        src={logoLight}
        alt=""
        className="size-16 drop-shadow-sm dark:hidden"
        draggable={false}
      />
      <img
        src={logoDark}
        alt=""
        className="hidden size-16 drop-shadow-sm dark:block"
        draggable={false}
      />
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xl font-semibold tracking-tight">
          {APP_DISPLAY_NAME}
        </h2>
        <Value>v{version}</Value>
      </div>
    </div>
  )
}

/** A read-only fact on the right of a row. */
function Value({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground text-sm tabular-nums">
      {children}
    </span>
  )
}

export function SystemInfo({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const { versions } = window.electron.process
  const { os } = window.api
  const { payload } = useUpdater()
  const autoUpdate = form.watch('autoUpdate') ?? true

  useEffect(() => {
    updaterSetAutoDownload(autoUpdate)
  }, [autoUpdate])

  return (
    <>
      <AboutHeader />

      {/* What people come here for first: which version, and is there a newer one. */}
      <SettingsSection>
        <SettingsRow label={t('about.version')}>
          <Value>v{version}</Value>
        </SettingsRow>
        <SettingsRow
          label={t('about.autoUpdate.label')}
          description={t('about.autoUpdate.description')}
        >
          <Switch
            checked={autoUpdate}
            onCheckedChange={(checked) => form.setValue('autoUpdate', checked)}
          />
        </SettingsRow>
        <UpdatePanel payload={payload} autoUpdate={autoUpdate} />
      </SettingsSection>

      <SettingsSection title={t('about.sections.runtime')}>
        <SettingsRow label={t('about.electron')}>
          <Value>v{versions.electron}</Value>
        </SettingsRow>
        <SettingsRow label={t('about.chromium')}>
          <Value>v{versions.chrome}</Value>
        </SettingsRow>
        <SettingsRow label={t('about.node')}>
          <Value>v{versions.node}</Value>
        </SettingsRow>
        <SettingsRow label={t('about.v8')}>
          <Value>v{versions.v8}</Value>
        </SettingsRow>
        <SettingsRow label={t('about.os')}>
          <Value>{os}</Value>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('about.sections.links')}>
        <SettingsRow label={t('about.github')}>
          <ExternalLink href={ACTOVIA_REPO}>actovia-ai/actovia</ExternalLink>
        </SettingsRow>
        <SettingsRow label={t('about.twitter')}>
          <ExternalLink href={ACTOVIA_TWITTER}>@YanceyOfficial</ExternalLink>
        </SettingsRow>
        <SettingsRow label={t('about.website')}>
          <ExternalLink href={ACTOVIA_WEBSITE}>actovia.yancey.app</ExternalLink>
        </SettingsRow>
        <SettingsRow label={t('about.license')}>
          <Value>MIT</Value>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
