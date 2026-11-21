import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Switch } from '@/components/ui/switch'

import { LimitInput } from '../limit-input'
import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { BrowserUseSettings } from './browser-use'

export function ComputerUse({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('computerUse')

  return (
    <>
      <SettingsIntro>{t('alert')}</SettingsIntro>

      <SettingsSection title={t('desktopTitle')}>
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

        <Controller
          control={form.control}
          name="computerUse.maxSteps"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('maxSteps.label')}
              description={t('maxSteps.description')}
              error={fieldState.error}
            >
              <LimitInput
                value={field.value}
                fallback={SETTING_DEFAULTS.computerUse.maxSteps}
                max={100}
                onChange={field.onChange}
                onBlur={field.onBlur}
                label={t('maxSteps.label')}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
      <BrowserUseSettings form={form} />
    </>
  )
}
