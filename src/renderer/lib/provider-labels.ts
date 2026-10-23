import type {
  CachedModelEntry,
  Settings
} from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { isChatModelId } from '@actovia/shared/utils/chat-models'

/** The provider's short name, as the Settings tabs spell it. */
export const PROVIDER_SHORT_LABELS: Record<AiProviders, string> = {
  [AiProviders.OpenAiGpt]: 'OpenAI',
  [AiProviders.AzureOpenAi]: 'Azure',
  [AiProviders.AnthropicClaude]: 'Claude',
  [AiProviders.GoogleGemini]: 'Gemini',
  [AiProviders.XaiGrok]: 'Grok',
  [AiProviders.Ollama]: 'Ollama'
}

type ProviderKeyField = keyof NonNullable<Settings['providers']>

/** The settings field holding each provider's key; none for Ollama. */
const PROVIDER_KEY_FIELDS: Partial<Record<AiProviders, ProviderKeyField>> = {
  [AiProviders.OpenAiGpt]: 'openaiApiKey',
  [AiProviders.AzureOpenAi]: 'azureOpenaiApiKey',
  [AiProviders.AnthropicClaude]: 'anthropicApiKey',
  [AiProviders.GoogleGemini]: 'googleGeminiApiKey',
  [AiProviders.XaiGrok]: 'xAiApiKey'
}

const PROVIDERS = new Set<string>(Object.values(AiProviders))

/** The provider configured, as the enum; null for none or an unknown name. */
export function configuredProvider(
  settings: Settings | undefined
): AiProviders | null {
  const value = settings?.providerConfig?.provider
  return value && PROVIDERS.has(value) ? (value as AiProviders) : null
}

/**
 * Whether the provider can answer: a key is saved (the renderer sees it as a
 * mask, a non-empty string), or it needs none (Ollama).
 */
export function providerHasKey(
  settings: Settings | undefined,
  provider: AiProviders | null
): boolean {
  if (!provider) return false
  const field = PROVIDER_KEY_FIELDS[provider]
  if (!field) return true
  return !!settings?.providers?.[field]
}

/** Whether the configured provider can answer. */
export function hasProviderKey(settings: Settings | undefined): boolean {
  return providerHasKey(settings, configuredProvider(settings))
}

/** Every provider that can answer and whose catalog was fetched. */
export function configuredProviders(
  settings: Settings | undefined
): AiProviders[] {
  return (Object.values(AiProviders) as AiProviders[]).filter(
    (p) => providerHasKey(settings, p) && modelCatalog(settings, p).length > 0
  )
}

/**
 * The catalog the Settings picker lists for the provider; empty until a
 * Refresh fetched it. A catalog saved before the list was cut to chat
 * models still holds the others, so they are left out here too.
 */
export function modelCatalog(
  settings: Settings | undefined,
  provider: AiProviders
): CachedModelEntry[] {
  return (settings?.modelCatalog?.[provider] ?? []).filter((m) =>
    isChatModelId(m.id)
  )
}

/** "Claude · Claude Sonnet 5.5": the provider's short name and the model's display name, else its id. */
export function modelLabel(
  provider: AiProviders,
  model: string,
  catalog: CachedModelEntry[]
): string {
  const entry = catalog.find((m) => m.id === model)
  return `${PROVIDER_SHORT_LABELS[provider]} · ${entry?.displayName ?? model}`
}

/** The model's display name from the provider's fetched catalog, else its id. */
export function modelDisplayName(
  settings: Settings | undefined,
  provider: string,
  model: string
): string {
  return (
    settings?.modelCatalog?.[provider]?.find((m) => m.id === model)
      ?.displayName ?? model
  )
}

/**
 * Whether a model the provider is shutting down is still to go (`retiring`) or
 * already gone (`retired`), against today in the reader's own time zone; none
 * when its list gives no day.
 */
export function modelRetirement(
  retiresAt: string | null | undefined,
  now: Date = new Date()
): 'retiring' | 'retired' | null {
  if (!retiresAt) return null
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  return retiresAt <= today ? 'retired' : 'retiring'
}
