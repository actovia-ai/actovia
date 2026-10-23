import { AiProviders } from '@actovia/shared/types/ai'
import { listModelsByProvider } from '@main/lib/ai/providers/list-models'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listModelsByProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists only what a chat can be sent to: every picker of this list picks a chat model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: ['gpt-5.5', 'gpt-image-2', 'gpt-realtime', 'whisper-1'].map(
              (id, i) => ({ id, created: 10 - i })
            )
          }),
          { status: 200 }
        )
      )
    )
    const models = await listModelsByProvider[AiProviders.OpenAiGpt]!({
      apiKey: 'sk-test'
    })
    expect(models.map((m) => m.id)).toEqual(['gpt-5.5'])
  })
})
