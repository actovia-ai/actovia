import { AiProviders } from '@actovia/shared/types/ai'

import { listAnthropicModels } from './anthropic'
import { listGoogleModels } from './google'
import { listOllamaModels } from './ollama'
import { listOpenAiModels } from './openai'
import type { ListModelsFn } from './types'
import { listXaiModels } from './xai'

export const listModelsByProvider: Partial<Record<AiProviders, ListModelsFn>> =
  {
    [AiProviders.OpenAiGpt]: listOpenAiModels,
    [AiProviders.AnthropicClaude]: listAnthropicModels,
    [AiProviders.GoogleGemini]: listGoogleModels,
    [AiProviders.XaiGrok]: listXaiModels,
    [AiProviders.Ollama]: listOllamaModels
  }

export type { ListModelsArgs, NormalizedModel } from './types'
