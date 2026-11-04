import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { SettingsRow, SettingsSection } from '../settings-row'
import { ShownDefault } from '../shown-default'

export function BrowserUseSettings({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('computerUse')
  return (
    <SettingsSection title={t('browser.title')}>
      {(['enabled', 'headed'] as const).map((key) => (
        <Controller
          key={key}
          control={form.control}
          name={`computerUse.browser.${key}`}
          render={({ field }) => (
            <SettingsRow
              label={t(`browser.${key}.label`)}
              description={t(`browser.${key}.description`)}
            >
              <Switch
                checked={field.value ?? SETTING_DEFAULTS.browserUse[key]}
                onCheckedChange={field.onChange}
                aria-label={t(`browser.${key}.label`)}
                data-testid={
                  key === 'enabled'
                    ? TEST_IDS.computerUse.browserEnabled
                    : TEST_IDS.computerUse.browserHeaded
                }
              />
            </SettingsRow>
          )}
        />
      ))}
      <Controller
        control={form.control}
        name="computerUse.browser.maxSteps"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('browser.maxSteps.label')}
            description={t('browser.maxSteps.description')}
            error={fieldState.error}
          >
            <ShownDefault
              value={field.value}
              fallback={SETTING_DEFAULTS.browserUse.maxSteps}
              onBlur={field.onBlur}
            >
              {(shown) => (
                <Input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  className="w-20"
                  {...field}
                  {...shown}
                  aria-label={t('browser.maxSteps.label')}
                  data-testid={TEST_IDS.computerUse.browserMaxSteps}
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
  )
}
