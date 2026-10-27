import { listAnthropicModels } from '@main/lib/ai/providers/list-models/anthropic'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listAnthropicModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes capabilities.effort into reasoningLevels, in level order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'claude-opus-5',
              display_name: 'Claude Opus 5',
              max_input_tokens: 1_000_000,
              max_tokens: 128_000,
              capabilities: {
                effort: {
                  supported: true,
                  low: { supported: true },
                  medium: { supported: true },
                  high: { supported: true },
                  xhigh: { supported: true },
                  max: { supported: true }
                }
              }
            }
          ]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' })

    expect(models).toEqual([
      {
        id: 'claude-opus-5',
        displayName: 'Claude Opus 5',
        snapshot: {
          contextWindow: 1_000_000,
          maxOutputTokens: 128_000,
          reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max']
        }
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01'
        })
      })
    )
  })

  it('reports reasoningLevels: [] for a model with no effort support', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'claude-haiku-4-5',
                display_name: 'Claude Haiku 4.5',
                max_input_tokens: 200_000,
                max_tokens: 64_000,
                capabilities: { effort: { supported: false } }
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' })
    expect(models[0].snapshot.reasoningLevels).toEqual([])
  })

  it('reads which thinking types the model accepts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'claude-opus-5-5',
                display_name: 'Claude Opus 5.5',
                max_input_tokens: 1_000_000,
                max_tokens: 128_000,
                capabilities: {
                  effort: { supported: true, high: { supported: true } },
                  thinking: {
                    supported: true,
                    types: {
                      adaptive: { supported: true },
                      enabled: { supported: false }
                    }
                  }
                }
              },
              {
                id: 'claude-legacy',
                display_name: 'Legacy',
                max_input_tokens: 200_000,
                max_tokens: 64_000,
                capabilities: { effort: { supported: false } }
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' })
    expect(models[0].snapshot).toMatchObject({
      adaptiveThinking: true,
      budgetThinking: false
    })
    // Not reported → left unset, so resolveModel falls back to its id rule.
    expect(models[1].snapshot.adaptiveThinking).toBeUndefined()
    expect(models[1].snapshot.budgetThinking).toBeUndefined()
  })

  it('throws with the raw error body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'invalid x-api-key' } }),
          {
            status: 401
          }
        )
      )
    )
    await expect(listAnthropicModels({ apiKey: 'bad' })).rejects.toThrow(
      /invalid x-api-key/
    )
  })

  it('respects a custom baseUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)
    await listAnthropicModels({
      apiKey: 'k',
      baseUrl: 'https://proxy.example.com'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.anything()
    )
  })
})
