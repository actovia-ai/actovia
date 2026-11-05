import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { ShownDefault } from '../shown-default'
import { Agents } from './agents'

const limits = [
  {
    key: 'maxRunning',
    max: 8,
    testId: TEST_IDS.philharmonicSettings.maxRunning
  },
  {
    key: 'pmMaxToolCalls',
    max: 500,
    testId: TEST_IDS.philharmonicSettings.pmMaxToolCalls
  },
  {
    key: 'staffMaxToolCalls',
    max: 500,
    testId: TEST_IDS.philharmonicSettings.staffMaxToolCalls
  },
  {
    key: 'failureLimit',
    max: 10,
    testId: TEST_IDS.philharmonicSettings.failureLimit
  }
] as const

export function PhilharmonicSettings({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('philharmonic')
  return (
    <>
      <SettingsIntro>{t('runtimeSettings.intro')}</SettingsIntro>
      <SettingsSection title={t('runtimeSettings.limits')}>
        {limits.map(({ key, max, testId }) => (
          <Controller
            key={key}
            control={form.control}
            name={`agents.philharmonic.${key}`}
            render={({ field, fieldState }) => (
              <SettingsRow
                label={t(`runtimeSettings.${key}.label`)}
                description={t(`runtimeSettings.${key}.description`)}
                error={fieldState.error}
              >
                <ShownDefault
                  value={field.value}
                  fallback={SETTING_DEFAULTS.philharmonic[key]}
                  onBlur={field.onBlur}
                >
                  {(shown) => (
                    <Input
                      type="number"
                      min={1}
                      max={max}
                      step={1}
                      className="w-20"
                      {...field}
                      {...shown}
                      aria-label={t(`runtimeSettings.${key}.label`)}
                      data-testid={testId}
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
        ))}
      </SettingsSection>
      <SettingsSection title={t('runtimeSettings.models')}>
        <Controller
          control={form.control}
          name="agents.philharmonic.autoModelRouting"
          render={({ field }) => (
            <SettingsRow
              label={t('runtimeSettings.autoModelRouting.label')}
              description={t('runtimeSettings.autoModelRouting.description')}
            >
              <Switch
                checked={
                  field.value ?? SETTING_DEFAULTS.philharmonic.autoModelRouting
                }
                onCheckedChange={field.onChange}
                aria-label={t('runtimeSettings.autoModelRouting.label')}
                data-testid={TEST_IDS.philharmonicSettings.autoModelRouting}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
      {!IS_WEB_CLIENT && <Agents form={form} embedded />}
    </>
  )
}
