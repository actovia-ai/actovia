import { AiProviders } from '@actovia/shared/types/ai'
import { providers } from '@main/lib/ai/providers'
import type { Settings } from '@main/lib/db/schema'
import { describe, expect, it } from 'vitest'

const settings = (over: Partial<Settings> = {}): Settings =>
  ({ id: 's', ...over }) as unknown as Settings

describe('providers table', () => {
  it('each registry-backed provider resolves its pi-ai provider + default id + api', () => {
    const cases: [AiProviders, string, string, string][] = [
      [AiProviders.OpenAiGpt, 'openai', 'gpt-5.6', 'openai-responses'],
      [AiProviders.AzureOpenAi, 'azure', 'gpt-5.6', 'azure-openai-responses'],
      [
        AiProviders.AnthropicClaude,
        'anthropic',
        'claude-opus-5',
        'anthropic-messages'
      ],
      [
        AiProviders.GoogleGemini,
        'google',
        'gemini-3.1-pro-preview',
        'google-generative-ai'
      ],
      // pi 0.85's xai provider serves the Responses API only.
      [AiProviders.XaiGrok, 'xai', 'grok-4.6', 'openai-responses']
    ]
    for (const [key, provider, defaultId, api] of cases) {
      const model = providers[key](settings())
      expect(model.provider, key).toBe(provider)
      expect(model.id, key).toBe(defaultId)
      expect(model.api, key).toBe(api)
    }
  })

  it('honours an explicit model id, snapshot, and a custom base URL', () => {
    const model = providers[AiProviders.AnthropicClaude](
      settings({
        providers: { anthropicBaseUrl: 'https://proxy.example.com' },
        providerConfig: {
          model: 'my-model',
          modelSnapshot: {
            contextWindow: 12345,
            maxOutputTokens: 999,
            reasoningLevels: ['off', 'max'],
            cost: { input: 1, output: 2 }
          }
        }
      } as Partial<Settings>)
    )
    expect(model.id).toBe('my-model')
    expect(model.baseUrl).toBe('https://proxy.example.com')
    expect(model.contextWindow).toBe(12345)
    expect(model.cost.input).toBe(1)
  })

  it('falls back to each provider default base URL', () => {
    expect(providers[AiProviders.OpenAiGpt](settings()).baseUrl).toBe(
      'https://api.openai.com/v1'
    )
    expect(providers[AiProviders.XaiGrok](settings()).baseUrl).toBe(
      'https://api.x.ai/v1'
    )
  })

  it('ollama builds a hand-rolled model from the typed id', () => {
    const model = providers[AiProviders.Ollama](
      settings({
        providerConfig: { model: 'llama3.1:70b' }
      } as Partial<Settings>)
    )
    expect(model.id).toBe('llama3.1:70b')
    expect(model.contextWindow).toBe(128000)
    expect(model.cost.input).toBe(0)
  })
})
