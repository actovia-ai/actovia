import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useTranslation } from 'react-i18next'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function AnthropicClaude({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.anthropicApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.AnthropicClaude
            }),
            placeholder: 'sk-ant-...',
            type: 'password'
          },
          {
            name: 'providers.anthropicBaseUrl',
            label: t('providers.fields.baseUrl.label'),
            description: t('providers.fields.baseUrl.description'),
            placeholder: 'https://api.anthropic.com'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.AnthropicClaude}
        form={form}
        apiKeyField="providers.anthropicApiKey"
        baseUrlField="providers.anthropicBaseUrl"
      />
    </>
  )
}
