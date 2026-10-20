import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { useOllamaStatus } from '@/hooks/use-ollama-status'
import { useSettings } from '@/hooks/use-settings'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { ModelPicker } from './model-picker'

export function Ollama({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
  const { isRunning } = useOllamaStatus(settings?.providers?.ollamaBaseUrl)

  return (
    <>
      <SettingsSection>
        <Controller
          control={form.control}
          name="providers.ollamaBaseUrl"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('providers.ollama.baseUrl.label')}
              description={t('providers.ollama.baseUrl.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="text"
                placeholder="http://localhost:11434"
                autoFocus
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <SettingsRow
          label={t('providers.ollama.status.label')}
          description={t('providers.ollama.status.description')}
        >
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${isRunning ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <p className="text-sm">
              {isRunning
                ? t('providers.ollama.status.running')
                : t('providers.ollama.status.notRunning')}
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>
      <ModelPicker
        provider={AiProviders.Ollama}
        form={form}
        apiKeyField="providers.ollamaBaseUrl" // unused by listOllamaModels, but ModelPicker's disabled-until-truthy check needs *some* field; ollamaBaseUrl serves the same "is this configured yet" role an API key does elsewhere
        baseUrlField="providers.ollamaBaseUrl"
      />
    </>
  )
}
