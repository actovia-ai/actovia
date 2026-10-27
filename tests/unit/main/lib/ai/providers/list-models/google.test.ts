import { listGoogleModels } from '@main/lib/ai/providers/list-models/google'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listGoogleModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('strips the "models/" id prefix and maps thinking:true to the 2-level convention', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              displayName: 'Gemini 3.8 Flash',
              inputTokenLimit: 1_000_000,
              outputTokenLimit: 65_536,
              thinking: true
            }
          ]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listGoogleModels({ apiKey: 'goog-key' })

    expect(models).toEqual([
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        snapshot: {
          contextWindow: 1_000_000,
          maxOutputTokens: 65_536,
          reasoningLevels: ['off', 'high']
        }
      }
    ])
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('key=goog-key')
  })

  it('maps thinking:false to an empty reasoningLevels array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                inputTokenLimit: 1_000_000,
                outputTokenLimit: 8_192,
                thinking: false
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listGoogleModels({ apiKey: 'goog-key' })
    expect(models[0].snapshot.reasoningLevels).toEqual([])
  })

  it('sorts alphabetically by id — Google reports no chronological signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-3.8-flash',
                displayName: 'Gemini 3.8 Flash',
                inputTokenLimit: 1,
                outputTokenLimit: 1
              },
              {
                name: 'models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                inputTokenLimit: 1,
                outputTokenLimit: 1
              },
              {
                name: 'models/gemini-3.1-pro-preview',
                displayName: 'Gemini 3.1 Pro Preview',
                inputTokenLimit: 1,
                outputTokenLimit: 1
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listGoogleModels({ apiKey: 'goog-key' })
    expect(models.map((m) => m.id)).toEqual([
      'gemini-2.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.8-flash'
    ])
  })
})
