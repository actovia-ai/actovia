import { listOpenAiModels } from '@main/lib/ai/providers/list-models/openai'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listOpenAiModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fills every field from MODEL_METADATA_FALLBACK for a known id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: 'gpt-5.6', created: 1, owned_by: 'openai' }]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(models).toEqual([
      {
        id: 'gpt-5.6',
        displayName: 'gpt-5.6', // OpenAI's API has no display name — use the id
        snapshot: {
          contextWindow: 1_050_000,
          maxOutputTokens: 128_000,
          reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh']
        }
      }
    ])
  })

  it('sorts by created descending, with any shutdown_date model sunk to the bottom', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'old-active', created: 100, owned_by: 'openai' },
              {
                id: 'newer-but-retiring',
                created: 300,
                owned_by: 'openai',
                shutdown_date: '2026-12-01'
              },
              { id: 'newest-active', created: 500, owned_by: 'openai' },
              { id: 'mid-active', created: 200, owned_by: 'openai' }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(models.map((m) => m.id)).toEqual([
      'newest-active',
      'mid-active',
      'old-active',
      'newer-but-retiring'
    ])
  })

  it('never throws for an id with no fallback entry — everything nulls/empties', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'some-brand-new-model', created: 1, owned_by: 'openai' }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(models[0].snapshot).toEqual({
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: []
    })
  })

  it('carries shutdown_date as the day the model retires, and nothing for an unreadable one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'current', created: 5, shutdown_date: null },
              { id: 'dated', created: 4, shutdown_date: '2027-01-20' },
              { id: 'stamped', created: 3, shutdown_date: 1_800_000_000 },
              { id: 'garbled', created: 2, shutdown_date: 'soon' }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(Object.fromEntries(models.map((m) => [m.id, m.retiresAt]))).toEqual({
      current: undefined,
      dated: '2027-01-20',
      stamped: '2027-01-15',
      garbled: undefined
    })
    expect('retiresAt' in models.find((m) => m.id === 'current')!).toBe(false)
  })
})
