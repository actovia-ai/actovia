import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import type { InstalledApp } from '@actovia/shared/types/computer-use'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useInstalledApps } from '@/hooks/use-installed-apps'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { ShownDefault } from '../shown-default'

function AppIcon({
  app,
  className
}: {
  app: InstalledApp
  className?: string
}) {
  if (!app.icon) return null
  return <img src={app.icon} alt="" className={className} />
}

export function ComputerUse({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('computerUse')
  const allowlist: string[] = form.watch('computerUse.targetAllowlist') ?? []
  const { apps, isLoading } = useInstalledApps(true)

  // The dropdown options are the installed apps, plus a stand-in for any
  // allowlisted name that isn't installed (renamed / removed since it was added).
  const byName = new Map(apps.map((a) => [a.name, a]))
  const options: InstalledApp[] = [
    ...apps,
    ...allowlist
      .filter((name) => !byName.has(name))
      .map((name) => ({ name, bundleId: '', path: '' }))
  ]
  const selected = allowlist.flatMap((name) => {
    const found = options.find((a) => a.name === name)
    return found ? [found] : []
  })
  const chipsAnchor = useComboboxAnchor()

  return (
    <>
      <SettingsIntro>{t('alert')}</SettingsIntro>

      <SettingsSection>
        <SettingsRow
          label={t('enable.label')}
          description={t('enable.description')}
        >
          <Controller
            control={form.control}
            name="computerUse.enabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                data-testid={TEST_IDS.computerUse.enableToggle}
              />
            )}
          />
        </SettingsRow>

        <SettingsRow
          label={t('allowlist.label')}
          description={t('allowlist.description')}
          layout="vertical"
        >
          <Combobox
            multiple
            value={selected}
            onValueChange={(items: InstalledApp[]) =>
              form.setValue(
                'computerUse.targetAllowlist',
                items.map((i) => i.name),
                { shouldDirty: true }
              )
            }
            items={options}
            itemToStringValue={(item: InstalledApp) => item.name}
          >
            <ComboboxChips ref={chipsAnchor}>
              {selected.map((app) => (
                <ComboboxChip key={app.bundleId || app.name} className="gap-1">
                  <AppIcon app={app} className="size-3.5 rounded-[3px]" />
                  {app.name}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={
                  selected.length === 0 ? t('allowlist.searchPlaceholder') : ''
                }
                data-testid={TEST_IDS.computerUse.allowlistInput}
              />
            </ComboboxChips>
            <ComboboxContent anchor={chipsAnchor}>
              <ComboboxEmpty>
                {isLoading ? t('allowlist.loading') : t('allowlist.noAppFound')}
              </ComboboxEmpty>
              <ComboboxList>
                {(app: InstalledApp) => (
                  <ComboboxItem key={app.bundleId || app.name} value={app}>
                    <AppIcon app={app} className="size-4 rounded-[4px]" />
                    <span className="truncate">{app.name}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </SettingsRow>

        <Controller
          control={form.control}
          name="computerUse.maxSteps"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('maxSteps.label')}
              description={t('maxSteps.description')}
              error={fieldState.error}
            >
              <ShownDefault
                value={field.value}
                fallback={SETTING_DEFAULTS.computerUse.maxSteps}
                onBlur={field.onBlur}
              >
                {(shown) => (
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    className="w-20"
                    {...field}
                    {...shown}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === '' ? null : Number(e.target.value)
                      )
                    }
                  />
                )}
              </ShownDefault>
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="computerUse.settleMs"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settleDelay.label')}
              description={t('settleDelay.description')}
              error={fieldState.error}
            >
              <ShownDefault
                value={field.value}
                fallback={SETTING_DEFAULTS.computerUse.settleMs}
                onBlur={field.onBlur}
              >
                {(shown) => (
                  <Input
                    type="number"
                    min={100}
                    max={5000}
                    className="w-24"
                    {...field}
                    {...shown}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === '' ? null : Number(e.target.value)
                      )
                    }
                  />
                )}
              </ShownDefault>
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
