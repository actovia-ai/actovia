import { AiProviders } from '@actovia/shared/types/ai'
// src/main/lib/ai/philharmonic/recruit.test.ts
import { describe, expect, it, vi } from 'vitest'

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ id: 's' }))
}))
const completeMock = vi.hoisted(() =>
  vi.fn(async () => ({
    content: [
      {
        type: 'text',
        text: '{"name":"","description":"Crunches numbers","systemPrompt":"You analyze data."}'
      }
    ]
  }))
)
vi.mock('@main/lib/ai/utils/complete', () => ({
  completeSimple: completeMock
}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: settingsMock.getSettings
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ chatModel: {}, apiKey: 'k' })
}))
const createAgent = vi.fn(async (d) => ({ id: 'a1', ...d }))
const getAllAgents = vi.fn(async () => [{ name: 'Avery' }])
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  createAgent,
  getAllAgents
}))

vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  listInstalledSkills: async () => [{ slug: 'python' }, { slug: 'sql' }]
}))

const { autoCreateEmployee } = await import('@main/lib/ai/philharmonic/recruit')

describe('autoCreateEmployee', () => {
  it('fills a name from the pool when LLM returns none, and sets avatar seed', async () => {
    await autoCreateEmployee({
      role: 'Data analyst',
      skills: ['python']
    })
    expect(createAgent).toHaveBeenCalled()
    const arg = createAgent.mock.calls[0][0]
    expect(arg.name).toBeTruthy()
    expect(arg.name).not.toBe('Avery') // avoided the taken name
    expect(arg.avatarSeed).toMatch(/^[a-z0-9]+$/i)
    expect(arg.avatarStyle).toBeTruthy()
    expect(arg.isActive).toBe(true)
  })

  it('honors an explicit name', async () => {
    await autoCreateEmployee({ role: 'Writer', name: 'Pat' })
    const arg = createAgent.mock.calls.at(-1)![0]
    expect(arg.name).toBe('Pat')
  })

  it('keeps only installed skill slugs, so an invented one does not empty the picks', async () => {
    await autoCreateEmployee({ role: 'Analyst', skills: ['python', 'excel'] })
    expect(createAgent.mock.calls.at(-1)![0].skillSlugs).toEqual(['python'])
    await autoCreateEmployee({ role: 'Analyst', skills: ['excel'] })
    expect(createAgent.mock.calls.at(-1)![0].skillSlugs).toEqual([])
  })

  it('persists the selected configured provider and model', async () => {
    settingsMock.getSettings.mockResolvedValueOnce({
      id: 's',
      providerConfig: {
        provider: AiProviders.OpenAiGpt,
        model: 'gpt-test'
      },
      providers: { openaiApiKey: 'key' },
      modelCatalog: {
        [AiProviders.OpenAiGpt]: [
          {
            id: 'gpt-test',
            displayName: 'GPT Test',
            snapshot: {
              contextWindow: 128_000,
              maxOutputTokens: 16_000,
              reasoningLevels: ['high'],
              adaptiveThinking: null,
              budgetThinking: null
            }
          }
        ]
      }
    } as never)

    await autoCreateEmployee({
      role: 'Research analyst',
      provider: AiProviders.OpenAiGpt,
      model: 'gpt-test'
    })

    expect(createAgent.mock.calls.at(-1)![0]).toMatchObject({
      provider: AiProviders.OpenAiGpt,
      model: 'gpt-test'
    })
  })

  it('refuses a model that is not in the configured provider catalog', async () => {
    createAgent.mockClear()
    await expect(
      autoCreateEmployee({
        role: 'Writer',
        provider: AiProviders.OpenAiGpt,
        model: 'unknown'
      })
    ).rejects.toThrow('The selected employee model is not configured.')
    expect(createAgent).not.toHaveBeenCalled()
  })
})
