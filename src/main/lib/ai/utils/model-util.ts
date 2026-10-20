import { ConfigurationError, ErrorCode, NotFoundError } from '@actovia/shared'
import { AiProviders } from '@actovia/shared/types/ai'
import type { Model } from '@earendil-works/pi-ai'

import { Settings } from '../../db/schema'
import { fauxHandle } from '../kernel/faux'
import { providers } from '../providers'

export const PROVIDER_API_KEY_LABELS: Record<AiProviders, string> = {
  [AiProviders.OpenAiGpt]: 'OpenAI API Key',
  [AiProviders.AnthropicClaude]: 'Anthropic API Key',
  [AiProviders.GoogleGemini]: 'Google Gemini API Key',
  [AiProviders.XaiGrok]: 'xAI API Key',
  [AiProviders.AzureOpenAi]: 'Azure OpenAI API Key',
  [AiProviders.Ollama]: 'Ollama'
}

export function getApiKeyFromSetting(setting: Settings): string {
  const provider = setting.providerConfig?.provider as AiProviders | undefined
  if (!provider) return ''

  switch (provider) {
    case AiProviders.OpenAiGpt:
      return setting.providers?.openaiApiKey ?? ''
    case AiProviders.AnthropicClaude:
      return setting.providers?.anthropicApiKey ?? ''
    case AiProviders.GoogleGemini:
      return setting.providers?.googleGeminiApiKey ?? ''
    case AiProviders.XaiGrok:
      return setting.providers?.xAiApiKey ?? ''
    case AiProviders.AzureOpenAi:
      return setting.providers?.azureOpenaiApiKey ?? ''
    case AiProviders.Ollama:
      return 'ollama'
    default:
      return ''
  }
}

export function getModelFromProvider(setting: Settings): {
  model: Model<string>
  apiKey: string
} {
  // The Electron e2e's scripted provider (ACTOVIA_FAUX_PROVIDER=1).
  const faux = fauxHandle()
  if (faux) return { model: faux.getModel(), apiKey: 'faux' }

  if (!('id' in setting)) {
    throw new NotFoundError(
      ErrorCode.SETTING_NOT_FOUND,
      'Settings not initialized. Please restart the app.'
    )
  }

  if (!setting.providerConfig?.provider) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_PROVIDER)
  }

  const providerEnum = setting.providerConfig.provider as AiProviders
  const model = providers[providerEnum](setting)
  const apiKey = getApiKeyFromSetting(setting)

  if (!apiKey) {
    const label = PROVIDER_API_KEY_LABELS[providerEnum] ?? providerEnum
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_API_KEY, undefined, {
      label
    })
  }

  return { model, apiKey }
}
