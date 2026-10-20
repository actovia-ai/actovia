import {
  githubRepoUrl,
  skillsShSkill
} from '@actovia/shared/constants/external-urls'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { InstalledSkill, SkillDetail } from '@actovia/shared/types/skills'
import {
  ArrowLeft02Icon,
  ArrowDown01Icon,
  DownloadIcon,
  LinkSquare02Icon,
  Loading03Icon,
  UnplugIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Markdown from '@/components/markdown/markdown'
import { SettingsEmpty, SwapLabel } from '@/components/settings/settings-kit'
import { SettingsSection } from '@/components/settings/settings-row'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  useInstallSkill,
  useInstalledSkills,
  useToggleSkill,
  useUninstallSkill
} from '@/hooks/use-installed-skills'
import { useSkillAudit, useSkillDetail } from '@/hooks/use-skills-registry'
import { cliInstallCommand } from '@/services/skills'

import { AuditPanel } from './audit-panel'
import { CommandLine } from './command-line'
import { Installs } from './skill-row'
import { slugOf, type SkillRef } from './types'
import { UninstallDialog } from './uninstall-dialog'

/** SKILL.md minus its frontmatter — the README the registry page shows. */
function readmeOf(detail: SkillDetail | undefined): string {
  const skillMd = detail?.files.find((f) => f.path === 'SKILL.md')
  return skillMd
    ? skillMd.contents.replace(/^---[\s\S]*?---\n?/, '').trim()
    : ''
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 transition-colors hover:underline"
    >
      {children}
      <HugeiconsIcon
        icon={LinkSquare02Icon}

        className="size-3"
      />
    </a>
  )
}

export function SkillDetailPage({
  item,
  onBack
}: {
  item: SkillRef
  onBack: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const slug = slugOf(item.id)

  const { data: detail, error, isLoading, refetch } = useSkillDetail(item.id)
  const { data: audit, isLoading: auditLoading } = useSkillAudit(item.id)
  const { data: installedList } = useInstalledSkills()
  const installed = installedList?.find((s) => s.slug === slug) ?? null
  const install = useInstallSkill()
  const uninstall = useUninstallSkill()
  const toggle = useToggleSkill()

  const [pending, setPending] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)

  const readme = useMemo(() => readmeOf(detail), [detail])
  const bundled = useMemo(
    () => detail?.files.filter((f) => f.path !== 'SKILL.md') ?? [],
    [detail]
  )
  const installs = detail?.installs ?? item.installs
  const command = cliInstallCommand(item.id)

  const handleInstall = async () => {
    setPending(true)
    try {
      await install.mutateAsync(item.id)
    } catch {
      // Reported and toasted by the global mutation handler.
    } finally {
      setPending(false)
    }
  }

  const handleUninstall = async (skill: InstalledSkill) => {
    setConfirmUninstall(false)
    setPending(true)
    try {
      await uninstall.mutateAsync({
        slug: skill.slug,
        displayName: skill.displayName
      })
    } catch {
      // Reported and toasted by the global mutation handler.
    } finally {
      setPending(false)
    }
  }

  const handleToggle = (isActive: boolean) => {
    if (!installed) return
    toggle.mutate({ slug: installed.slug, isActive })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.skillsMarket.backButton}
          onClick={onBack}
          className="text-muted-foreground -ml-2"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} />
          {t('skillsMarket.detail.back')}
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-xl font-semibold">{item.name}</h2>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="truncate">{item.source}</span>
            {installs !== undefined && <Installs count={installs} />}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <ExternalLink href={item.url ?? skillsShSkill(item.id)}>
              {t('skillsMarket.detail.openOnSkillsSh')}
            </ExternalLink>
            <ExternalLink href={item.installUrl ?? githubRepoUrl(item.source)}>
              {t('skillsMarket.detail.openSource')}
            </ExternalLink>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {installed ? (
            <>
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                {t('skillsMarket.detail.active')}
                <Switch
                  data-testid={TEST_IDS.skillsMarket.activeSwitch}
                  checked={installed.isActive}
                  onCheckedChange={handleToggle}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                data-testid={TEST_IDS.skillsMarket.uninstallButton}
                disabled={pending}
                onClick={() => setConfirmUninstall(true)}
              >
                {pending && (
                  <HugeiconsIcon
                    icon={Loading03Icon}

                    className="animate-spin"
                  />
                )}
                {t('skillsMarket.detail.uninstall')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              data-testid={TEST_IDS.skillsMarket.installButton}
              disabled={pending || !detail}
              onClick={handleInstall}
            >
              <SwapLabel
                active={pending ? 'busy' : 'idle'}
                labels={{
                  idle: (
                    <>
                      <HugeiconsIcon icon={DownloadIcon} />
                      {t('skillsMarket.detail.install')}
                    </>
                  ),
                  busy: (
                    <>
                      <HugeiconsIcon
                        icon={Loading03Icon}

                        className="animate-spin"
                      />
                      {t('skillsMarket.detail.installing')}
                    </>
                  )
                }}
              />
            </Button>
          )}
        </div>
      </header>

      <AuditPanel audit={audit} loading={auditLoading} />

      <SettingsSection title={t('skillsMarket.detail.cli.title')} plain>
        <div className="flex flex-col gap-2">
          <CommandLine
            command={command}
            commandTestId={TEST_IDS.skillsMarket.cliCommand}
            copyTestId={TEST_IDS.skillsMarket.copyCommandButton}
          />
          <p className="text-muted-foreground px-1 text-xs">
            {t('skillsMarket.detail.cli.description')}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title={t('skillsMarket.detail.readme')}>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : error ? (
          <SettingsEmpty
            icon={UnplugIcon}
            title={t('skillsMarket.detail.loadFailed')}
            description={t('skillsMarket.browse.loadFailedHint')}
          >
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('common:action.retry')}
            </Button>
          </SettingsEmpty>
        ) : (
          <div className="text-sm">
            <Markdown src={readme} />
          </div>
        )}
      </SettingsSection>

      {bundled.length > 0 && (
        <Collapsible className="flex flex-col gap-2">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground group self-start"
              />
            }
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}

              className="transition-transform duration-200 group-data-panel-open:rotate-180"
            />
            {t('skillsMarket.detail.files', { count: bundled.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="divide-border gap-0 divide-y py-0">
              {bundled.map((f) => (
                <div key={f.path} className="truncate px-4 py-2 text-xs">
                  {f.path}
                </div>
              ))}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      <UninstallDialog
        skill={confirmUninstall ? installed : null}
        onOpenChange={(open) => {
          if (!open) setConfirmUninstall(false)
        }}
        onConfirm={handleUninstall}
      />
    </div>
  )
}
