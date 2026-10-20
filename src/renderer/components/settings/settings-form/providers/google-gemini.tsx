import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function GoogleGemini({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.googleGeminiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.GoogleGemini
            }),
            placeholder: 'AIza...',
            type: 'password'
          },
          {
            name: 'providers.googleGeminiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://generativelanguage.googleapis.com'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.GoogleGemini}
        form={form}
        apiKeyField="providers.googleGeminiApiKey"
        baseUrlField="providers.googleGeminiBaseUrl"
      />
    </>
  )
}
