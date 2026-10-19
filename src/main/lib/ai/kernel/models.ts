import type { StreamFn } from '@earendil-works/pi-agent-core'
import {
  createModels,
  createProvider,
  type MutableModels,
  type Provider
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { azureProvider } from '@earendil-works/pi-ai/providers/azure'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'

import { withThinkingLevel } from '../providers/thinking-level'
import { loggingThrows } from './log-throws'

/**
 * The process's one `Models` collection. pi 0.85 routes every request by
 * `model.provider` to a registered provider, which resolves auth and owns the
 * stream; there is no global registry any more. Actovia passes the API key
 * from Settings explicitly on each request (`options.apiKey` wins over
 * anything a provider would resolve from the environment), so nothing here
 * reads env vars in practice.
 */

export const OLLAMA_PROVIDER_ID = 'ollama'

/**
 * Ollama is a dynamic provider with an empty catalog: `getOllama()` in
 * `providers/ollama.ts` hand-builds a `Model` per request with
 * `provider: 'ollama'` and the base URL from Settings, and the collection
 * routes it here. Keyless: auth resolves as configured with no key.
 */
function ollamaProvider(): Provider<'openai-completions'> {
  return createProvider<'openai-completions'>({
    id: OLLAMA_PROVIDER_ID,
    name: 'Ollama',
    auth: { apiKey: { name: 'Ollama', resolve: async () => ({ auth: {} }) } },
    models: [],
    api: openAICompletionsApi()
  })
}

let models: MutableModels | undefined

export function getKernelModels(): MutableModels {
  if (models) return models
  models = createModels()
  models.setProvider(anthropicProvider())
  models.setProvider(openaiProvider())
  models.setProvider(googleProvider())
  models.setProvider(xaiProvider())
  models.setProvider(azureProvider())
  models.setProvider(ollamaProvider())
  return models
}

/**
 * What every `Agent` / `agentLoop` in the app streams through. A throw from
 * here is logged as the Error it is before pi reduces it to its message
 * (`log-throws.ts`); a failure inside a provider never throws — pi resolves it
 * to an `error` event on the stream.
 */
export const streamFn: StreamFn = loggingThrows<
  Parameters<StreamFn>,
  ReturnType<StreamFn>
>(
  'streamFn',
  (model, context, options) =>
    getKernelModels().streamSimple(
      model,
      context,
      withThinkingLevel(model, options)
    ),
  (model) => ({ provider: model.provider, model: model.id })
)
