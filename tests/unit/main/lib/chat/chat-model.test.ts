import { settingsForChat } from '@main/lib/chat/chat-model'
import type { Settings } from '@main/lib/db/schema'
import { describe, expect, it } from 'vitest'

const snap = (levels: string[]) => ({
  contextWindow: 1,
  maxOutputTokens: 1,
  reasoningLevels: levels,
  cost: null
})

const settings = {
  providerConfig: {
    provider: 'AnthropicClaude',
    model: 'claude-sonnet-5-5',
    modelSnapshot: snap(['low'])
  },
  modelCatalog: {
    OpenAiGpt: [
      { id: 'gpt-5.6', displayName: 'GPT-5.6', snapshot: snap(['high']) }
    ]
  }
} as unknown as Settings

describe('settingsForChat', () => {
  it('leaves the settings as they are for a chat with no model of its own', () => {
    expect(settingsForChat(settings, undefined)).toBe(settings)
    expect(settingsForChat(settings, { provider: null, model: null })).toBe(
      settings
    )
    expect(
      settingsForChat(settings, { provider: 'OpenAiGpt', model: null })
    ).toBe(settings)
  })

  it("puts the chat's model in providerConfig, with its catalog snapshot", () => {
    const out = settingsForChat(settings, {
      provider: 'OpenAiGpt',
      model: 'gpt-5.6'
    })
    expect(out.providerConfig).toEqual({
      provider: 'OpenAiGpt',
      model: 'gpt-5.6',
      modelSnapshot: snap(['high'])
    })
    // The rest is the app's.
    expect(out.modelCatalog).toBe(settings.modelCatalog)
  })

  it("keeps the default's snapshot for the same model, and none for one it knows nothing of", () => {
    expect(
      settingsForChat(settings, {
        provider: 'AnthropicClaude',
        model: 'claude-sonnet-5-5'
      }).providerConfig?.modelSnapshot
    ).toEqual(snap(['low']))
    expect(
      settingsForChat(settings, {
        provider: 'AnthropicClaude',
        model: 'claude-opus-5-5'
      }).providerConfig?.modelSnapshot
    ).toBeNull()
  })
})
