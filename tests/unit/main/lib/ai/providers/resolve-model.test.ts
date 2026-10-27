import {
  ModelSnapshotSchema,
  type ModelSnapshot
} from '@actovia/shared/schemas/settings-schema'
import {
  resolveModel,
  trustedContextWindow,
  ZERO_MODEL_COST
} from '@main/lib/ai/providers/resolve-model'
import { thinkingLevelFor } from '@main/lib/ai/providers/thinking-level'
import { describe, expect, it } from 'vitest'

describe('resolveModel', () => {
  it('uses the curated override for models missing from the pi-ai registry', () => {
    // An id the installed catalog does not carry, with no MODEL_METADATA_FALLBACK
    // entry (Anthropic needs none — it's expected to always carry a live-fetched snapshot).
    // Without a snapshot, this falls back to PROVIDER_DEFAULTS for Anthropic.
    const model = resolveModel(
      'anthropic',
      'claude-opus-99-unreleased',
      'https://api.anthropic.com',
      'anthropic-messages'
    )
    expect(model.id).toBe('claude-opus-99-unreleased')
    expect(model.provider).toBe('anthropic')
    expect(model.api).toBe('anthropic-messages')
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.contextWindow).toBe(1_000_000) // PROVIDER_DEFAULTS['anthropic']
    expect(model.maxTokens).toBe(128_000)
    expect(model.reasoning).toBe(false)
  })

  it('honors a custom baseUrl in the override path', () => {
    const model = resolveModel(
      'anthropic',
      'claude-opus-99-unreleased',
      'https://proxy.example.com',
      'anthropic-messages'
    )
    expect(model.baseUrl).toBe('https://proxy.example.com')
  })

  it('returns registry metadata for a known model', () => {
    const model = resolveModel(
      'anthropic',
      'claude-opus-4-7',
      'https://api.anthropic.com',
      'anthropic-messages'
    )
    expect(model.id).toBe('claude-opus-4-7')
    // pi's catalog prices are not carried over (ISSUE-235: no money anywhere).
    expect(model.cost).toEqual(ZERO_MODEL_COST)
  })

  it('falls back to zero cost + the provider default context for an unknown model', () => {
    const model = resolveModel(
      'openai',
      'totally-made-up-model-xyz',
      'https://api.openai.com/v1',
      'openai-completions'
    )
    expect(model.cost.input).toBe(0)
    // No override → PROVIDER_DEFAULTS['openai'] context window.
    expect(model.contextWindow).toBe(1_050_000)
  })

  it('uses the smaller ollama default context for an unknown local model', () => {
    const model = resolveModel(
      'ollama',
      'some-local-model',
      'http://localhost:11434',
      'openai-completions'
    )
    expect(model.cost.input).toBe(0)
    expect(model.contextWindow).toBe(128_000)
    expect(model.maxTokens).toBe(8192)
  })

  it('prefers a passed snapshot over the registry and MODEL_METADATA_FALLBACK', () => {
    const model = resolveModel(
      'openai',
      'gpt-5.6',
      'https://api.openai.com/v1',
      'openai-responses',
      {
        contextWindow: 999,
        maxOutputTokens: 111,
        reasoningLevels: ['off', 'max']
      }
    )
    expect(model.contextWindow).toBe(999)
    expect(model.maxTokens).toBe(111)
    expect(model.cost).toEqual(ZERO_MODEL_COST)
    expect(model.reasoning).toBe(true) // reasoningLevels has more than just 'off'
  })

  it('falls back to MODEL_METADATA_FALLBACK when no snapshot is passed (Ollama free-typed ids)', () => {
    const model = resolveModel(
      'openai',
      'gpt-5.6',
      'https://api.openai.com/v1',
      'openai-responses'
    )
    // gpt-5.6 has a MODEL_METADATA_FALLBACK entry (OpenAI's own list API gives us nothing else)
    expect(model.contextWindow).toBe(1_050_000)
    expect(model.cost).toEqual(ZERO_MODEL_COST)
  })

  it('falls back to PROVIDER_DEFAULTS for a snapshot with null fields (Ollama live-fetch shape)', () => {
    const model = resolveModel(
      'ollama',
      'llama3.1:70b',
      'http://localhost:11434',
      'openai-completions',
      {
        contextWindow: null,
        maxOutputTokens: null,
        reasoningLevels: []
      }
    )
    expect(model.contextWindow).toBe(128_000)
    expect(model.maxTokens).toBe(8192)
    expect(model.cost.input).toBe(0)
    expect(model.reasoning).toBe(false)
  })

  it("maps the composer's xhigh and max tiers to themselves for an unregistered model", () => {
    // pi-ai reads thinkingLevelMap[level] for the effort it sends, so 'max'
    // must map to 'max' (not fall through to pi's default of "high").
    const model = resolveModel(
      'anthropic',
      'claude-opus-99-unreleased',
      'https://api.anthropic.com',
      'anthropic-messages',
      {
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max']
      }
    )
    expect(model.thinkingLevelMap).toEqual({ xhigh: 'xhigh', max: 'max' })
  })

  it('maps thinkingLevelMap.xhigh to "xhigh" when reasoningLevels includes xhigh but not max', () => {
    const model = resolveModel(
      'anthropic',
      'claude-opus-99-unreleased',
      'https://api.anthropic.com',
      'anthropic-messages',
      {
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoningLevels: ['off', 'high', 'xhigh']
      }
    )
    expect(model.thinkingLevelMap).toEqual({ xhigh: 'xhigh' })
  })

  it('leaves thinkingLevelMap undefined when reasoningLevels is empty', () => {
    const model = resolveModel(
      'anthropic',
      'claude-haiku-4-5',
      'https://api.anthropic.com',
      'anthropic-messages',
      {
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
        reasoningLevels: []
      }
    )
    expect(model.thinkingLevelMap).toBeUndefined()
  })

  describe('thinking mode for Claude', () => {
    const live = (extra: Partial<ModelSnapshot> = {}): ModelSnapshot => ({
      contextWindow: 900_000,
      maxOutputTokens: 100_000,
      reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      ...extra
    })

    it("merges the registry's compat and level map into a live snapshot (claude-opus-5)", () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        live()
      )
      expect(model.compat).toMatchObject({
        forceAdaptiveThinking: true,
        supportsMidConvoEffort: true
      })
      expect(model.thinkingLevelMap).toEqual({
        off: null,
        xhigh: 'xhigh',
        max: 'max'
      })
      // The live numbers still win.
      expect(model.contextWindow).toBe(900_000)
      expect(model.maxTokens).toBe(100_000)
      expect(model.cost).toEqual(ZERO_MODEL_COST)
    })

    it("derives adaptive-only thinking for an unregistered id from the snapshot's capability", () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-5-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        live({ adaptiveThinking: true, budgetThinking: false })
      )
      expect(model.compat).toMatchObject({ forceAdaptiveThinking: true })
      expect(model.thinkingLevelMap).toMatchObject({ off: null, max: 'max' })
    })

    it('keeps budget thinking for a model the API reports as enabled-only', () => {
      const model = resolveModel(
        'anthropic',
        'claude-haiku-4-5-20991231',
        'https://api.anthropic.com',
        'anthropic-messages',
        live({
          reasoningLevels: ['off', 'low', 'high'],
          adaptiveThinking: false,
          budgetThinking: true
        })
      )
      expect(model.compat?.forceAdaptiveThinking).toBeUndefined()
      expect(model.thinkingLevelMap?.off).toBeUndefined()
    })

    it("keeps budget thinking for the registry's claude-haiku-4-5", () => {
      const model = resolveModel(
        'anthropic',
        'claude-haiku-4-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        live({ reasoningLevels: ['off', 'low', 'high'] })
      )
      expect(model.compat?.forceAdaptiveThinking).toBeUndefined()
      expect(model.thinkingLevelMap?.off).toBeUndefined()
    })

    it("carries no price for a live model pi's registry prices", () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-5-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        live()
      )
      expect(model.cost).toEqual(ZERO_MODEL_COST)
    })

    it('falls back to the id rule for a stored snapshot saved before the capability fields', () => {
      const stored = ModelSnapshotSchema.parse({
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoningLevels: ['off', 'low', 'high', 'max']
      })
      const opus = resolveModel(
        'anthropic',
        'claude-sonnet-5-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        stored
      )
      expect(opus.compat).toMatchObject({ forceAdaptiveThinking: true })
      expect(opus.thinkingLevelMap?.off).toBeNull()

      // Adaptive, but these can still turn thinking off.
      const sonnet46 = resolveModel(
        'anthropic',
        'claude-sonnet-4-6-20990101',
        'https://api.anthropic.com',
        'anthropic-messages',
        stored
      )
      expect(sonnet46.compat).toMatchObject({ forceAdaptiveThinking: true })
      expect(sonnet46.thinkingLevelMap?.off).toBeUndefined()

      const older = resolveModel(
        'anthropic',
        'claude-sonnet-4-5-20990101',
        'https://api.anthropic.com',
        'anthropic-messages',
        stored
      )
      expect(older.compat?.forceAdaptiveThinking).toBeUndefined()
    })
  })

  describe('thinkingLevelFor', () => {
    const snap: ModelSnapshot = {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningLevels: ['off', 'low', 'high']
    }

    it('turns "off" into the lowest effort when the model cannot disable thinking', () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-5',
        'https://api.anthropic.com',
        'anthropic-messages',
        snap
      )
      expect(thinkingLevelFor(model)).toBe('low')
      expect(thinkingLevelFor(model, 'high')).toBe('high')
    })

    it('keeps Opus 5 thinking on from the registry alone, with no snapshot', () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-5',
        'https://api.anthropic.com',
        'anthropic-messages'
      )
      expect(model.thinkingLevelMap?.off).toBeNull()
      expect(thinkingLevelFor(model)).toBe('low')
    })

    it('leaves "off" off where thinking can be disabled', () => {
      const model = resolveModel(
        'anthropic',
        'claude-opus-4-7',
        'https://api.anthropic.com',
        'anthropic-messages',
        snap
      )
      expect(thinkingLevelFor(model)).toBeUndefined()
    })
  })
})

// ISSUE-235 review: LCM compacts against the model's window, so a window that
// is only the provider's guess must not count — gpt-4o behind an unknown id
// read as 1.05M and never compacted.
describe('trustedContextWindow', () => {
  const openai = (id: string, snapshot?: ModelSnapshot) =>
    resolveModel(
      'openai',
      id,
      'https://api.openai.com/v1',
      'openai-responses',
      snapshot
    )
  const snap = (contextWindow: number | null) =>
    ModelSnapshotSchema.parse({
      contextWindow,
      maxOutputTokens: null,
      reasoningLevels: []
    })

  it('is 0 for a window guessed from the provider default', () => {
    expect(openai('gpt-nobody-knows').contextWindow).toBe(1_050_000)
    expect(trustedContextWindow(openai('gpt-nobody-knows'))).toBe(0)
    expect(trustedContextWindow(openai('gpt-nobody-knows', snap(null)))).toBe(0)
  })

  it('survives the JSON a job payload carries', () => {
    const queued = JSON.parse(JSON.stringify(openai('gpt-nobody-knows')))
    expect(trustedContextWindow(queued)).toBe(0)
  })

  it('is the window when it came from a fallback row or a snapshot', () => {
    expect(trustedContextWindow(openai('gpt-5.6'))).toBe(1_050_000)
    expect(trustedContextWindow(openai('gpt-nobody-knows', snap(64_000)))).toBe(
      64_000
    )
  })
})
