import { AiProviders } from '@actovia/shared/types/ai'
import { isChatModelId } from '@actovia/shared/utils/chat-models'

import { listAnthropicModels } from './anthropic'
import { listGoogleModels } from './google'
import { listOllamaModels } from './ollama'
import { listOpenAiModels } from './openai'
import type { ListModelsFn } from './types'
import { listXaiModels } from './xai'

/** A provider's list without what cannot chat (`isChatModelId`). */
const chatOnly =
  (list: ListModelsFn): ListModelsFn =>
  async (args) =>
    (await list(args)).filter((m) => isChatModelId(m.id))

export const listModelsByProvider: Partial<Record<AiProviders, ListModelsFn>> =
  {
    [AiProviders.OpenAiGpt]: chatOnly(listOpenAiModels),
    [AiProviders.AnthropicClaude]: chatOnly(listAnthropicModels),
    [AiProviders.GoogleGemini]: chatOnly(listGoogleModels),
    [AiProviders.XaiGrok]: chatOnly(listXaiModels),
    [AiProviders.Ollama]: chatOnly(listOllamaModels)
  }

export type { ListModelsArgs, NormalizedModel } from './types'
