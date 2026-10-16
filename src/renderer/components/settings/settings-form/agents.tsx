import { UseFormReturnType } from '@exodus/shared/schemas/settings-schema'
import { CLI_NAMES, type CliStatus } from '@exodus/shared/types/agents'
import { useEffect, useState } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cliStatusView } from '@/lib/cli-status'
import { cn } from '@/lib/utils'
import { checkCli, getClis } from '@/services/agents'
import { pickFolder } from '@/services/projects'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'

const DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive'
} as const

function CliRow({
  status,
  onCheck,
  checking
}: {
  status: CliStatus
  onCheck: () => void
  checking: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const view = cliStatusView(status)
  const facts =
    [status.path, status.version, status.authMethod]
      .filter(Boolean)
      .join(' · ') || t('agents.cli.notFound')
  const description = [
    facts,
    view.hintKey ? t(view.hintKey) : null,
    status.detail
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <SettingsRow label={CLI_NAMES[status.id]} description={description}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm">
          <span className={cn('size-2 rounded-full', DOT[view.tone])} />
          {t(view.labelKey)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onCheck}
          disabled={checking}
        >
          {t('agents.cli.check')}
        </Button>
      </div>
    </SettingsRow>
  )
}

/** Settings › Agents: the CLIs on this Mac, and how coding agents run. */
export function Agents({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('philharmonic')
  const [clis, setClis] = useState<CliStatus[]>([])
  const [checking, setChecking] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getClis()
      .then((list) => !cancelled && setClis(list))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const recheck = async (id: CliStatus['id']) => {
    setChecking(id)
    try {
      const next = await checkCli(id)
      setClis((list) => list.map((c) => (c.id === id ? next : c)))
    } catch {
      // The row keeps its last status; pressing Check again retries.
    } finally {
      setChecking(null)
    }
  }

  return (
    <>
      <SettingsIntro>{t('agents.settings.intro')}</SettingsIntro>

      <SettingsSection title={t('agents.settings.clisTitle')}>
        {clis.map((s) => (
          <CliRow
            key={s.id}
            status={s}
            checking={checking === s.id}
            onCheck={() => recheck(s.id)}
          />
        ))}
      </SettingsSection>

      <SettingsSection title={t('agents.settings.runTitle')}>
        <SettingsRow
          label={t('agents.settings.projectsDir.label')}
          description={t('agents.settings.projectsDir.description')}
        >
          <Controller
            control={form.control}
            name="agents.projectsDir"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Input
                  value={field.value ?? ''}
                  placeholder="~/Exodus Projects"
                  onChange={field.onChange}
                  className="w-64"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const { path } = await pickFolder()
                    if (path) field.onChange(path)
                  }}
                >
                  {t('agents.settings.projectsDir.choose')}
                </Button>
              </div>
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.maxRunning.label')}
          description={t('agents.settings.maxRunning.description')}
        >
          <Controller
            control={form.control}
            name="agents.maxRunning"
            render={({ field }) => (
              <Input
                type="number"
                min={1}
                max={8}
                placeholder="2"
                value={field.value ?? ''}
                onChange={field.onChange}
                className="w-20"
              />
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.keepAlive.label')}
          description={t('agents.settings.keepAlive.description')}
        >
          <Controller
            control={form.control}
            name="agents.keepAliveMinutes"
            render={({ field }) => (
              <Input
                type="number"
                min={0}
                max={120}
                placeholder="10"
                value={field.value ?? ''}
                onChange={field.onChange}
                className="w-20"
              />
            )}
          />
        </SettingsRow>
        <SettingsRow
          label={t('agents.settings.worktrees.label')}
          description={t('agents.settings.worktrees.description')}
        >
          <Controller
            control={form.control}
            name="agents.worktrees"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>
      </SettingsSection>

      <p className="text-muted-foreground px-1 text-xs">
        {t('agents.settings.safety')}
      </p>
    </>
  )
}
