import type { ModelSnapshot } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'

import { useChatHistory } from '@/hooks/use-chat-history'
import { useSettings } from '@/hooks/use-settings'
import { configuredProvider, modelCatalog } from '@/lib/provider-labels'

const PROVIDERS = new Set<string>(Object.values(AiProviders))

export interface ChatModel {
  provider: AiProviders | null
  model: string | null
  /** The cached catalog's entry for it, else the default's when it is the same. */
  snapshot: ModelSnapshot | null
}

/**
 * The model a chat answers with (owner, 2026-10-21: the model belongs to the
 * chat): its own `provider` / `model` from the history list, else — a chat
 * older than those columns, or none yet (the landing page) — the default in
 * Settings, which is also what a new chat starts with. Mirrors main's
 * `settingsForChat()`.
 */
export function useChatModel(chatId: string | undefined): ChatModel {
  const { data: settings } = useSettings()
  const { data: history } = useChatHistory()
  const chat = chatId ? history?.find((c) => c.id === chatId) : undefined
  const fallback = settings?.providerConfig

  if (chat?.provider && chat.model && PROVIDERS.has(chat.provider)) {
    const provider = chat.provider as AiProviders
    const sameAsDefault =
      fallback?.provider === provider && fallback?.model === chat.model
    return {
      provider,
      model: chat.model,
      snapshot:
        modelCatalog(settings, provider).find((m) => m.id === chat.model)
          ?.snapshot ??
        (sameAsDefault ? (fallback?.modelSnapshot ?? null) : null)
    }
  }
  return {
    provider: configuredProvider(settings),
    model: fallback?.model ?? null,
    snapshot: fallback?.modelSnapshot ?? null
  }
}
