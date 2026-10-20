import {
  artifactShortId,
  artifactSlug
} from '@actovia/shared/utils/artifact-slug'
import { describe, expect, it } from 'vitest'

describe('artifactSlug', () => {
  it('lowercases and joins words with dashes', () => {
    expect(artifactSlug('Corning Furukawa YTD')).toBe('corning-furukawa-ytd')
  })

  it('collapses punctuation and whitespace into single dashes', () => {
    expect(artifactSlug('Hello,   world!!  2026')).toBe('hello-world-2026')
  })

  it('trims leading and trailing dashes', () => {
    expect(artifactSlug('   -- foo -- ')).toBe('foo')
  })

  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(80)
    expect(artifactSlug(long)).toHaveLength(40)
  })

  it('preserves non-ASCII characters', () => {
    expect(artifactSlug('康宁 YTD')).toBe('康宁-ytd')
  })

  it('returns "untitled" for empty/whitespace input', () => {
    expect(artifactSlug('')).toBe('untitled')
    expect(artifactSlug('   ')).toBe('untitled')
  })

  it('returns "untitled" when nothing survives slugging', () => {
    expect(artifactSlug('!!!')).toBe('untitled')
  })
})

describe('artifactShortId', () => {
  it('returns the first 5 characters of the id', () => {
    expect(artifactShortId('7f3a1b2c-0000-0000-0000-000000000000')).toBe(
      '7f3a1'
    )
  })

  it('handles short inputs without padding', () => {
    expect(artifactShortId('ab')).toBe('ab')
  })
})
