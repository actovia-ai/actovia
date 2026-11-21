import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Switch } from '@/components/ui/switch'

import { LimitInput } from '../limit-input'
import { SettingsRow, SettingsSection } from '../settings-row'

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
            <LimitInput
              value={field.value}
              fallback={SETTING_DEFAULTS.browserUse.maxSteps}
              max={500}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={t('browser.maxSteps.label')}
              testId={TEST_IDS.computerUse.browserMaxSteps}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
