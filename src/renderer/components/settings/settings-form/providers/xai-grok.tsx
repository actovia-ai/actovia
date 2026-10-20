import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function XaiGrok({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.xAiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.XaiGrok
            }),
            placeholder: 'xai-...',
            type: 'password'
          },
          {
            name: 'providers.xAiBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.x.ai/v1'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.XaiGrok}
        form={form}
        apiKeyField="providers.xAiApiKey"
        baseUrlField="providers.xAiBaseUrl"
      />
    </>
  )
}
