import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

import { buildSettingsSave } from '@/lib/settings-autosave'

const persisted = (over: Partial<Settings> = {}): Settings =>
  ({
    id: 's1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    personality: { nickname: 'old', occupation: null, aboutYou: null },
    voice: null,
    ...over
  }) as Settings

describe('buildSettingsSave', () => {
  it('noop when there are no changes', () => {
    expect(buildSettingsSave(persisted(), new Map())).toEqual({
      status: 'noop'
    })
  })

  it('noop when a change equals the persisted value', () => {
    const r = buildSettingsSave(
      persisted(),
      new Map([['personality.nickname', 'old']])
    )
    expect(r).toEqual({ status: 'noop' })
  })

  it('saves a valid text change and keeps the persisted id', () => {
    const r = buildSettingsSave(
      persisted(),
      new Map([['personality.nickname', 'Yancey']])
    )
    expect(r.status).toBe('save')
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.personality?.nickname).toBe('Yancey')
    expect(r.payload.personality?.occupation).toBeNull()
    expect(r.payload.id).toBe('s1')
  })

  it('coerces a numeric string field (matches the old handleSubmit output)', () => {
    const r = buildSettingsSave(
      persisted(),
      new Map([['voice.textToSpeechSpeed', '2']])
    )
    expect(r.status).toBe('save')
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.voice?.textToSpeechSpeed).toBe(2)
    expect(typeof r.payload.voice?.textToSpeechSpeed).toBe('number')
  })

  it('reports the field error when the changed value is invalid', () => {
    const r = buildSettingsSave(
      persisted(),
      new Map([['voice.textToSpeechSpeed', '9']]) // schema caps at 4.0
    )
    expect(r.status).toBe('invalid')
    if (r.status !== 'invalid') throw new Error('expected invalid')
    expect(r.errors[0]).toMatch(/textToSpeechSpeed/)
  })

  it('batches multiple pending field changes into one payload', () => {
    const r = buildSettingsSave(
      persisted(),
      new Map([
        ['personality.nickname', 'A'],
        ['personality.occupation', 'B']
      ])
    )
    expect(r.status).toBe('save')
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.personality?.nickname).toBe('A')
    expect(r.payload.personality?.occupation).toBe('B')
  })

  it('creates a nested branch that was null on the persisted settings', () => {
    const r = buildSettingsSave(
      persisted({ voice: null }),
      new Map([['voice.textToSpeechSpeed', '1.5']])
    )
    expect(r.status).toBe('save')
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.voice?.textToSpeechSpeed).toBe(1.5)
  })

  it('a pre-existing bad field on the persisted object cannot happen — only touched fields are merged in', () => {
    // Persisted is always server-validated; a bad value can only enter via
    // `changes`. Confirm an unrelated valid change still saves cleanly.
    const r = buildSettingsSave(
      persisted({ personality: { nickname: 'keep', occupation: null } }),
      new Map([['voice.textToSpeechSpeed', '3']])
    )
    expect(r.status).toBe('save')
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.personality?.nickname).toBe('keep')
    expect(r.payload.voice?.textToSpeechSpeed).toBe(3)
  })
})

describe('buildSettingsSave — colorTone', () => {
  it('saves a tone and rejects an unknown one', () => {
    const ok = buildSettingsSave(
      persisted({ colorTone: null }),
      new Map([['colorTone', 'emerald']])
    )
    expect(ok.status).toBe('save')
    if (ok.status !== 'save') throw new Error('expected save')
    expect(ok.payload.colorTone).toBe('emerald')

    const bad = buildSettingsSave(
      persisted({ colorTone: null }),
      new Map([['colorTone', 'magenta']])
    )
    expect(bad.status).toBe('invalid')
  })
})

describe('buildSettingsSave: a saved key whose address moves', () => {
  const withKey = () =>
    persisted({
      providers: {
        openaiApiKey: '•••• abcd',
        openaiBaseUrl: null
      }
    } as Partial<Settings>)

  it('posts the key cleared, and names it, when the base URL changes under a masked key', () => {
    const r = buildSettingsSave(
      withKey(),
      new Map([['providers.openaiBaseUrl', 'https://proxy.example/v1']])
    )
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.providers?.openaiApiKey).toBeNull()
    expect(r.payload.providers?.openaiBaseUrl).toBe('https://proxy.example/v1')
    expect(r.clearedSecrets).toEqual(['providers.openaiApiKey'])
  })

  it('keeps a key typed in the same save as the new address', () => {
    const r = buildSettingsSave(
      withKey(),
      new Map([
        ['providers.openaiBaseUrl', 'https://proxy.example/v1'],
        ['providers.openaiApiKey', 'sk-typed-for-the-proxy']
      ])
    )
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.providers?.openaiApiKey).toBe('sk-typed-for-the-proxy')
    expect(r.clearedSecrets).toEqual([])
  })

  it('an unrelated change posts the mask back untouched (the server keeps the key)', () => {
    const r = buildSettingsSave(
      withKey(),
      new Map([['personality.nickname', 'Yancey']])
    )
    if (r.status !== 'save') throw new Error('expected save')
    expect(r.payload.providers?.openaiApiKey).toBe('•••• abcd')
    expect(r.clearedSecrets).toEqual([])
  })
})
