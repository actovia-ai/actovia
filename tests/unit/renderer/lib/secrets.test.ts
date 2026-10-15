import { maskSecret } from '@main/lib/secrets/mask'
import { SECRET_DESTINATIONS as MAIN_DESTINATIONS } from '@main/lib/secrets/registry'
import { normalizeBaseUrl as mainNormalize } from '@main/lib/secrets/url'
import { describe, expect, it } from 'vitest'

const {
  SECRET_DESTINATIONS,
  clearMovedSecrets,
  destinationSecretOf,
  holdsMask,
  looksLikeMask,
  normalizeBaseUrl,
  replaceMask
} = await import('@/lib/secrets')

describe('looksLikeMask / holdsMask', () => {
  it('reads both mask shapes the main process hands out', () => {
    expect(looksLikeMask(maskSecret('sk-live-1234567890abcd'))).toBe(true)
    expect(looksLikeMask(maskSecret('short'))).toBe(true)
    expect(looksLikeMask('sk-live-1234567890abcd')).toBe(false)
    expect(looksLikeMask('')).toBe(false)
    expect(looksLikeMask(null)).toBe(false)
  })

  it('holdsMask finds a mask inside a longer value', () => {
    expect(holdsMask('https://x.example/sse?api_key=•••• abcd')).toBe(true)
    expect(holdsMask('https://x.example/sse')).toBe(false)
    expect(holdsMask(undefined)).toBe(false)
  })
})

describe('replaceMask: typing over a masked key', () => {
  const mask = '•••• abcd'

  it('a character typed at the end replaces the mask with that character', () => {
    expect(replaceMask(mask, `${mask}x`)).toBe('x')
  })

  it('select-all then type (or paste) gives exactly the new text', () => {
    expect(replaceMask(mask, 'sk-new')).toBe('sk-new')
  })

  it('a paste in the middle keeps only the pasted text', () => {
    expect(replaceMask(mask, '•••• sk-newabcd')).toBe('sk-new')
  })

  it('any deletion clears the key', () => {
    expect(replaceMask(mask, '•••• abc')).toBe('')
    expect(replaceMask(mask, '')).toBe('')
    expect(replaceMask('••••', '•••')).toBe('')
  })
})

describe('the destination rule, as the form mirrors it', () => {
  it('has the same pairs as the main process (a new pair needs both sides)', () => {
    expect(SECRET_DESTINATIONS).toEqual(MAIN_DESTINATIONS)
  })

  it('compares base URLs with the very function the main process uses', () => {
    // One implementation (`@exodus/shared/utils/base-url`), its cases in
    // tests/unit/shared/utils/base-url.test.ts.
    expect(normalizeBaseUrl).toBe(mainNormalize)
  })

  it('finds the secret an address field carries', () => {
    expect(destinationSecretOf('providers.openaiBaseUrl')).toBe(
      'providers.openaiApiKey'
    )
    expect(destinationSecretOf('providers.azureOpenAiEndpoint')).toBe(
      'providers.azureOpenaiApiKey'
    )
    expect(destinationSecretOf('knowledgeBase.url')).toBe(
      'knowledgeBase.apiKey'
    )
    expect(destinationSecretOf('providers.openaiApiKey')).toBeNull()
  })

  const persisted = {
    providers: {
      openaiApiKey: '•••• abcd',
      openaiBaseUrl: null,
      anthropicApiKey: '•••• wxyz',
      anthropicBaseUrl: 'https://api.anthropic.com'
    },
    knowledgeBase: { url: 'http://localhost:9621', apiKey: '••••' }
  }

  it('clears a masked key whose address moved, and says which', () => {
    const candidate = structuredClone(persisted)
    candidate.providers.openaiBaseUrl = 'https://proxy.example/v1' as never
    expect(clearMovedSecrets(persisted, candidate)).toEqual([
      'providers.openaiApiKey'
    ])
    expect(candidate.providers.openaiApiKey).toBeNull()
    expect(candidate.providers.anthropicApiKey).toBe('•••• wxyz')
  })

  it('keeps the key when only the form of the address changed, or it is the default', () => {
    const candidate = structuredClone(persisted)
    candidate.providers.openaiBaseUrl = 'https://api.openai.com/v1/' as never
    candidate.providers.anthropicBaseUrl = 'HTTPS://api.anthropic.com/'
    expect(clearMovedSecrets(persisted, candidate)).toEqual([])
    expect(candidate.providers.openaiApiKey).toBe('•••• abcd')
  })

  it('keeps a key typed together with the new address', () => {
    const candidate = structuredClone(persisted)
    candidate.knowledgeBase.url = 'http://kb.example:9621'
    candidate.knowledgeBase.apiKey = 'new-key'
    expect(clearMovedSecrets(persisted, candidate)).toEqual([])
    expect(candidate.knowledgeBase.apiKey).toBe('new-key')
  })
})
