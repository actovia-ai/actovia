import {
  COLOR_TONES,
  ColorToneSchema,
  EffortLevelSchema,
  ModelSnapshotSchema,
  ProviderConfigSchema
} from '@actovia/shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

describe('EffortLevelSchema', () => {
  it('accepts every defined level', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(EffortLevelSchema.safeParse(level).success).toBe(true)
    }
  })

  it('rejects an unknown level', () => {
    expect(EffortLevelSchema.safeParse('extreme').success).toBe(false)
  })
})

describe('ModelSnapshotSchema', () => {
  it('accepts a full snapshot', () => {
    const result = ModelSnapshotSchema.safeParse({
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      reasoningLevels: ['off', 'high'],
      cost: { input: 2, output: 10 }
    })
    expect(result.success).toBe(true)
  })

  it('accepts null cost and empty reasoningLevels (Ollama shape)', () => {
    const result = ModelSnapshotSchema.safeParse({
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: [],
      cost: null
    })
    expect(result.success).toBe(true)
  })
})

describe('ProviderConfigSchema', () => {
  it('no longer has chatModel/reasoningModel fields', () => {
    const parsed = ProviderConfigSchema.parse({
      provider: 'OpenAI GPT',
      model: 'gpt-5.6'
    })
    expect(parsed).not.toHaveProperty('chatModel')
    expect(parsed).not.toHaveProperty('reasoningModel')
  })

  it('accepts a full modelSnapshot alongside model', () => {
    const parsed = ProviderConfigSchema.parse({
      provider: 'OpenAI GPT',
      model: 'gpt-5.6',
      modelSnapshot: {
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        reasoningLevels: ['off', 'high'],
        cost: { input: 4, output: 20 }
      }
    })
    expect(parsed.modelSnapshot?.contextWindow).toBe(1_050_000)
  })
})

describe('ColorToneSchema', () => {
  it('accepts every tone the General page offers', () => {
    expect(COLOR_TONES).toEqual([
      'neutral',
      'emerald',
      'blue',
      'violet',
      'rose',
      'orange',
      'yellow'
    ])
    for (const tone of COLOR_TONES) {
      expect(ColorToneSchema.safeParse(tone).success).toBe(true)
    }
  })

  it('rejects an unknown tone', () => {
    expect(ColorToneSchema.safeParse('magenta').success).toBe(false)
  })
})
