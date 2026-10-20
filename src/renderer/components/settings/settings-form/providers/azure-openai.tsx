import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { ProviderFields } from './provider-fields'

export function AzureOpenAi({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.azureOpenaiApiKey',
            label: t('providers.fields.apiKey.label'),
            description: t('providers.fields.apiKey.description', {
              provider: AiProviders.AzureOpenAi
            }),
            type: 'password'
          },
          {
            name: 'providers.azureOpenAiEndpoint',
            label: t('providers.azure.endpoint.label'),
            description: t('providers.azure.endpoint.description'),
            placeholder:
              'https://{resource}.openai.azure.com/openai/deployments/{model}'
          },
          {
            name: 'providers.azureOpenAiApiVersion',
            label: t('providers.azure.apiVersion.label'),
            description: t('providers.azure.apiVersion.description'),
            placeholder: '2024-12-01-preview'
          }
        ]}
      />
      {/* Azure has no live model-list fetch (see list-models/ — unverified
          against a real Azure resource), so this stays a plain text input
          instead of ModelPicker's dropdown. Pulled out of the ProviderFields
          array above (unlike its siblings) because it needs its own
          onChange side effect below. */}
      <SettingsSection>
        <Controller
          control={form.control}
          name="providerConfig.model"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('providers.azure.model.label')}
              description={t('providers.azure.model.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="text"
                placeholder="gpt-5.6"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => {
                  field.onChange(e)
                  // Same rule as ModelPicker's handleSelect for the other,
                  // live-fetch providers: setting a model here always makes
                  // Azure the active provider, so this free-text field can't
                  // silently corrupt providerConfig.model while a different
                  // provider tab is active. modelSnapshot is cleared too —
                  // Azure has no live-snapshot concept, and leaving a stale
                  // snapshot from a previously-active provider around would
                  // confuse resolveModel().
                  form.setValue(
                    'providerConfig.provider',
                    AiProviders.AzureOpenAi,
                    { shouldDirty: true }
                  )
                  form.setValue('providerConfig.modelSnapshot', null, {
                    shouldDirty: true
                  })
                }}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
