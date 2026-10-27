import { listXaiModels } from '@main/lib/ai/providers/list-models/xai'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listXaiModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes context_length and carries no price, even one the API sends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'grok-4.6',
                context_length: 500_000,
                prompt_text_token_price: 0.000002,
                completion_text_token_price: 0.000006
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listXaiModels({ apiKey: 'xai-key' })
    expect(models).toEqual([
      {
        id: 'grok-4.6',
        displayName: 'grok-4.6',
        snapshot: {
          contextWindow: 500_000,
          maxOutputTokens: null,
          reasoningLevels: [] // from MODEL_METADATA_FALLBACK
        }
      }
    ])
  })

  it('sorts by created descending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'grok-old', context_length: 100_000, created: 100 },
              { id: 'grok-newest', context_length: 100_000, created: 300 },
              { id: 'grok-mid', context_length: 100_000, created: 200 }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listXaiModels({ apiKey: 'xai-key' })
    expect(models.map((m) => m.id)).toEqual([
      'grok-newest',
      'grok-mid',
      'grok-old'
    ])
  })

  it('sorts entries missing created after the ones that have it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'no-created', context_length: 100_000 },
              { id: 'has-created', context_length: 100_000, created: 100 }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listXaiModels({ apiKey: 'xai-key' })
    expect(models.map((m) => m.id)).toEqual(['has-created', 'no-created'])
  })
})
