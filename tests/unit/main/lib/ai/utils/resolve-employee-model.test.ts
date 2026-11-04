import { describe, expect, it, vi } from 'vitest'

const getModelFromProvider = vi.fn(
  (s: { providerConfig: { provider: string; model: string } }) => {
    if (s.providerConfig.provider === 'nokey')
      throw new Error('CONFIG_MISSING_API_KEY')
    return {
      model: {
        id: s.providerConfig.model,
        provider: s.providerConfig.provider
      },
      apiKey: 'k'
    }
  }
)
vi.mock('@main/lib/ai/utils/model-util', () => ({ getModelFromProvider }))
const { resolveEmployeeModel } =
  await import('@main/lib/ai/utils/employee-model')

const setting = {
  id: 'global',
  providerConfig: {
    provider: 'anthropic',
    model: 'global-model',
    modelSnapshot: { x: 1 }
  }
} as never

describe('resolveEmployeeModel', () => {
  it('uses the global model when the employee has none', () => {
    const r = resolveEmployeeModel({ provider: null, model: null }, setting)
    expect(r.model).toMatchObject({ id: 'global-model' })
  })

  it("uses the employee's provider and model", () => {
    const r = resolveEmployeeModel(
      { provider: 'openai', model: 'gpt-x' },
      setting
    )
    expect(r.model).toMatchObject({ id: 'gpt-x', provider: 'openai' })
    const passed = getModelFromProvider.mock.calls.at(-1)![0] as {
      providerConfig: Record<string, unknown>
    }
    expect(passed.providerConfig).toEqual({
      provider: 'openai',
      model: 'gpt-x'
    })
  })

  it("uses the selected model's catalog snapshot when available", () => {
    const snapshot = {
      contextWindow: 256_000,
      maxOutputTokens: 32_000,
      reasoningLevels: ['high'],
      adaptiveThinking: null,
      budgetThinking: null
    }
    resolveEmployeeModel({ provider: 'openai', model: 'gpt-x' }, {
      ...setting,
      modelCatalog: {
        openai: [{ id: 'gpt-x', displayName: 'GPT X', snapshot }]
      }
    } as never)
    expect(getModelFromProvider.mock.calls.at(-1)![0]).toMatchObject({
      providerConfig: {
        provider: 'openai',
        model: 'gpt-x',
        modelSnapshot: snapshot
      }
    })
  })

  it("fails with the employee's provider named, never falling back", () => {
    expect(() =>
      resolveEmployeeModel({ provider: 'nokey', model: 'm' }, setting)
    ).toThrow(/nokey/)
  })
})
