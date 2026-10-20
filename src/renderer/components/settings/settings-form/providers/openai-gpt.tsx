import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function OpenAiGpt({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.openaiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.OpenAiGpt
            }),
            placeholder: 'sk-...',
            type: 'password'
          },
          {
            name: 'providers.openaiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.openai.com/v1'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.OpenAiGpt}
        form={form}
        apiKeyField="providers.openaiApiKey"
        baseUrlField="providers.openaiBaseUrl"
      />
    </>
  )
}
