import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { InstalledSkill } from '@actovia/shared/types/skills'
import { Delete02Icon, PackageOpenIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsEmpty, SettingsItem } from '@/components/settings/settings-kit'
import { SettingsSection } from '@/components/settings/settings-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useInstalledSkills,
  useToggleSkill,
  useUninstallSkill
} from '@/hooks/use-installed-skills'
import { useFormat } from '@/lib/format'

import { Skeletons } from './leaderboard'
import { refFromInstalled, type SkillRef } from './types'
import { UninstallDialog } from './uninstall-dialog'

export function InstalledSkillsList({
  onOpen
}: {
  onOpen: (ref: SkillRef) => void
}) {
  const { t } = useTranslation('settings')
  const { dateTime } = useFormat()
  const { data, isLoading } = useInstalledSkills()
  const toggle = useToggleSkill()
  const uninstall = useUninstallSkill()
  const [pendingUninstall, setPendingUninstall] =
    useState<InstalledSkill | null>(null)

  const handleUninstall = (skill: InstalledSkill) => {
    setPendingUninstall(null)
    uninstall.mutate({ slug: skill.slug, displayName: skill.displayName })
  }

  if (isLoading || !data) return <Skeletons count={2} />

  if (data.length === 0) {
    return (
      <SettingsSection>
        <SettingsEmpty
          icon={PackageOpenIcon}
          title={t('skillsMarket.installedTab.empty')}
          description={t('skillsMarket.installedTab.emptyHint')}
        />
      </SettingsSection>
    )
  }

  return (
    <>
      <SettingsSection>
        {data.map((skill) => {
          const ref = refFromInstalled(skill)
          const name = ref ? (
            <button
              type="button"
              onClick={() => onOpen(ref)}
              className="truncate hover:underline"
            >
              {skill.displayName}
            </button>
          ) : (
            <span className="truncate">{skill.displayName}</span>
          )
          return (
            <SettingsItem
              key={skill.slug}
              title={
                <>
                  {name}
                  <Badge variant="outline" className="tabular-nums">
                    {skill.version}
                  </Badge>
                  {!skill.source && (
                    <Badge variant="secondary">
                      {t('skillsMarket.installedTab.legacy')}
                    </Badge>
                  )}
                  <span className="text-muted-foreground truncate text-xs font-normal">
                    {skill.registryId ?? skill.slug}
                    {' · '}
                    {t('skillsMarket.installedTab.installedAt', {
                      date: dateTime(new Date(skill.installedAt), {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })
                    })}
                  </span>
                </>
              }
              actions={
                <>
                  <Switch
                    data-testid={TEST_IDS.skillsMarket.activeSwitch}
                    checked={skill.isActive}
                    onCheckedChange={(checked) =>
                      toggle.mutate({ slug: skill.slug, isActive: checked })
                    }
                    aria-label={t('skillsMarket.detail.active')}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-testid={TEST_IDS.skillsMarket.uninstallButton}
                    aria-label={t('skillsMarket.detail.uninstall')}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingUninstall(skill)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                  </Button>
                </>
              }
            />
          )
        })}
      </SettingsSection>
      <UninstallDialog
        skill={pendingUninstall}
        onOpenChange={(open) => {
          if (!open) setPendingUninstall(null)
        }}
        onConfirm={handleUninstall}
      />
    </>
  )
}
