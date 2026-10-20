import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SecretInput } from '../secret-fields'
import { SettingsRow, SettingsSection } from '../settings-row'

export function GoogleMaps({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection plain>
      <Controller
        control={form.control}
        name="googleCloud.googleApiKey"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.googleMaps.apiKey.label')}
            description={t('tools.googleMaps.apiKey.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <SecretInput
              placeholder={t('tools.googleMaps.apiKey.placeholder')}
              id="google-search-api-key-input"
              {...field}
              value={field.value}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
