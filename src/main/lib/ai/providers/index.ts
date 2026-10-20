import { AiProviders } from '@actovia/shared/types/ai'
import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai'

import type { Settings } from '../../db/schema'
import { getOllama } from './ollama'
import { resolveModel } from './resolve-model'

export type ProviderFn = (setting: Settings) => Model<string>

interface ProviderSpec {
  provider: KnownProvider
  api: Api
  baseUrl: (setting: Settings) => string
  defaultModel: string
}

const SPECS: Record<Exclude<AiProviders, AiProviders.Ollama>, ProviderSpec> = {
  [AiProviders.OpenAiGpt]: {
    provider: 'openai',
    // Every OpenAI model in pi-ai's own registry resolves through the
    // Responses API, not Chat Completions — the legacy endpoint outright
    // rejects function tools + reasoning_effort together on current models.
    // xAI/Ollama stay on 'openai-completions': their APIs mimic the legacy
    // Chat Completions shape and have no Responses-API equivalent.
    api: 'openai-responses',
    baseUrl: (s) => s.providers?.openaiBaseUrl ?? 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6'
  },
  [AiProviders.AzureOpenAi]: {
    // pi-ai 1.0 names the provider `azure`; the API keeps its Responses name.
    provider: 'azure',
    api: 'azure-openai-responses',
    baseUrl: (s) => s.providers?.azureOpenAiEndpoint ?? '',
    defaultModel: 'gpt-5.6'
  },
  [AiProviders.AnthropicClaude]: {
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: (s) =>
      s.providers?.anthropicBaseUrl ?? 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5'
  },
  [AiProviders.GoogleGemini]: {
    provider: 'google',
    api: 'google-generative-ai',
    baseUrl: (s) =>
      s.providers?.googleGeminiBaseUrl ??
      'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.1-pro-preview'
  },
  [AiProviders.XaiGrok]: {
    provider: 'xai',
    // pi 0.85's xai provider serves the Responses API only (its catalog lists
    // every Grok model as openai-responses at https://api.x.ai/v1).
    api: 'openai-responses',
    baseUrl: (s) => s.providers?.xAiBaseUrl ?? 'https://api.x.ai/v1',
    defaultModel: 'grok-4.6'
  }
}

type SpecProvider = Exclude<AiProviders, AiProviders.Ollama>

/** The app's provider for a pi-ai `model.provider` string, if it has one. */
export function aiProviderOf(piProvider: string): SpecProvider | null {
  const hit = (Object.keys(SPECS) as SpecProvider[]).find(
    (p) => SPECS[p].provider === piProvider
  )
  return hit ?? null
}

/** Where a provider's requests go under these settings (base URL or default). */
export function providerBaseUrl(p: SpecProvider, setting: Settings): string {
  return SPECS[p].baseUrl(setting)
}

function fromSpec(spec: ProviderSpec): ProviderFn {
  return (setting) => {
    const baseUrl = spec.baseUrl(setting)
    const id = setting.providerConfig?.model ?? spec.defaultModel
    const snapshot = setting.providerConfig?.modelSnapshot ?? undefined
    return resolveModel(spec.provider, id, baseUrl, spec.api, snapshot)
  }
}

export const providers: Record<AiProviders, ProviderFn> = {
  [AiProviders.Ollama]: getOllama,
  [AiProviders.OpenAiGpt]: fromSpec(SPECS[AiProviders.OpenAiGpt]),
  [AiProviders.AzureOpenAi]: fromSpec(SPECS[AiProviders.AzureOpenAi]),
  [AiProviders.AnthropicClaude]: fromSpec(SPECS[AiProviders.AnthropicClaude]),
  [AiProviders.GoogleGemini]: fromSpec(SPECS[AiProviders.GoogleGemini]),
  [AiProviders.XaiGrok]: fromSpec(SPECS[AiProviders.XaiGrok])
}
