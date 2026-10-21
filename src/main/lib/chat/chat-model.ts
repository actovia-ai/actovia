import type { Chat, Settings } from '../db/schema'

/**
 * The settings a chat's request runs with: the app's, with the chat's own
 * model in `providerConfig` when it has one (owner, 2026-10-21: the model
 * belongs to the chat). Its snapshot is the cached catalog's entry for it
 * (Settings › AI Providers' Refresh), else the default's when it is the same
 * model, else none — `resolveModel()` then falls back to pi-ai's registry.
 * A chat older than the columns (no model) follows the default.
 */
export function settingsForChat(
  setting: Settings,
  chat: Pick<Chat, 'provider' | 'model'> | undefined
): Settings {
  if (!chat?.provider || !chat.model) return setting
  const current = setting.providerConfig
  const sameAsDefault =
    current?.provider === chat.provider && current?.model === chat.model
  const snapshot =
    setting.modelCatalog?.[chat.provider]?.find((m) => m.id === chat.model)
      ?.snapshot ?? (sameAsDefault ? current?.modelSnapshot : null)
  return {
    ...setting,
    providerConfig: {
      ...current,
      provider: chat.provider,
      model: chat.model,
      modelSnapshot: snapshot ?? null
    }
  }
}
