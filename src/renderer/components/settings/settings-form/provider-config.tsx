import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

/**
 * One name per provider, the same in the Provider select and on the key
 * tabs below it — they used to ask the same question in two vocabularies.
 */
export const PROVIDER_LABELS: Record<AiProviders, string> = {
  [AiProviders.OpenAiGpt]: 'OpenAI',
  [AiProviders.AzureOpenAi]: 'Azure',
  [AiProviders.AnthropicClaude]: 'Claude',
  [AiProviders.GoogleGemini]: 'Gemini',
  [AiProviders.XaiGrok]: 'Grok',
  [AiProviders.Ollama]: 'Ollama'
}

const providerOptions = Object.values(AiProviders).map((val) => ({
  value: val,
  label: PROVIDER_LABELS[val]
}))

export function ProviderConfig({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection>
      <Controller
        control={form.control}
        name="providerConfig.provider"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('providers.config.label')}
            description={t('providers.config.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? ''}
              onValueChange={(value) => {
                field.onChange(value)
                form.setValue('providerConfig.model', '')
                form.setValue('providerConfig.modelSnapshot', null)
              }}
              options={providerOptions}
              placeholder={t('providers.config.placeholder')}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
