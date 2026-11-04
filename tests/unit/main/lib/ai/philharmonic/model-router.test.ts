import { describe, expect, it, vi } from 'vitest'

const options = [
  {
    value: 'remote',
    provider: 'OpenAI GPT',
    model: 'remote',
    snapshot: { contextWindow: 128000, reasoningLevels: ['off', 'high'] }
  },
  {
    value: 'local',
    provider: 'Ollama',
    model: 'local',
    snapshot: { contextWindow: 8000, reasoningLevels: ['off'] }
  }
]
vi.mock('@main/lib/ai/philharmonic/recruit', () => ({
  recruitmentModelOptions: () => options
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: (settings: {
    providerConfig: {
      provider: string
      model: string
      modelSnapshot: { contextWindow: number }
    }
  }) => ({
    model: {
      id: settings.providerConfig.model,
      contextWindow: settings.providerConfig.modelSnapshot.contextWindow
    },
    apiKey:
      settings.providerConfig.provider === 'Ollama' ? 'local-key' : 'remote-key'
  })
}))
vi.mock('@main/lib/ai/providers/resolve-model', () => ({
  trustedContextWindow: (model: { contextWindow: number }) =>
    model.contextWindow
}))
import { modelRouter } from '@main/lib/ai/philharmonic/model-router'
import type { Settings } from '@main/lib/db/schema'

const settings = {
  providerConfig: {
    provider: options[0].provider,
    model: options[0].model,
    modelSnapshot: options[0].snapshot
  }
} as unknown as Settings

describe('per-request model routing', () => {
  it('keeps the assigned model when automatic selection is disabled', () => {
    const router = modelRouter({
      ...settings,
      agents: { philharmonic: { autoModelRouting: false } }
    } as Settings)
    expect(router.tools).toEqual([])
    expect(router.current.model.id).toBe('remote')
  })
  it('uses the selected local model and its matching credentials on the next request', async () => {
    const router = modelRouter(settings)
    await router.tools[0].execute('pick', {
      model: 'local',
      reason: 'Routine file inspection'
    })
    expect(router.current.model.id).toBe('local')
    expect(router.current.apiKey).toBe('local-key')
  })
  it('refuses a model that cannot fit the observed context and keeps the current one', async () => {
    const router = modelRouter(settings)
    router.observe(10000)
    await expect(
      router.tools[0].execute('pick', {
        model: 'local',
        reason: 'Routine work'
      })
    ).rejects.toThrow('too small')
    expect(router.current.model.id).toBe('remote')
    await expect(
      router.tools[0].execute('pick', { model: 'unknown', reason: 'Invalid' })
    ).rejects.toThrow('configured')
  })
})
