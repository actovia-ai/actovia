import { normalizeBaseUrl } from '@actovia/shared/utils/base-url'
import { describe, expect, it } from 'vitest'

// One implementation, shared by the main process (the destination rule that
// clears a key, the list-models guard) and the renderer (the form's mirror of
// that rule): these cases decide whether a key survives an address edit.
describe('normalizeBaseUrl', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['https://API.OpenAI.com/v1/', 'https://api.openai.com/v1'],
    ['  https://api.openai.com/v1  ', 'https://api.openai.com/v1'],
    ['HTTPS://api.anthropic.com', 'https://api.anthropic.com'],
    ['https://api.anthropic.com/', 'https://api.anthropic.com'],
    ['http://localhost:9200//', 'http://localhost:9200'],
    ['http://localhost:9200/Path/', 'http://localhost:9200/Path'],
    ['https://h.example:443/v1', 'https://h.example/v1'],
    ['http://h.example:8080/v1', 'http://h.example:8080/v1'],
    ['http://[::1]:9621/', 'http://[::1]:9621'],
    ['http://[FE80::1]/x', 'http://[fe80::1]/x'],
    [
      'https://h.example/v1?api-version=1',
      'https://h.example/v1?api-version=1'
    ],
    ['https://u:p@h.example/v1', 'https://h.example/v1'],
    ['not a url/', 'not a url'],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null]
  ])('%j → %j', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected)
  })

  it('tells a userinfo trick apart from the host it imitates', () => {
    expect(normalizeBaseUrl('https://api.openai.com@evil.example/v1')).toBe(
      'https://evil.example/v1'
    )
  })
})
