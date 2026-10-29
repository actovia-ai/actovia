import { describe, it, expect } from 'vitest'

import { HUE_NAMES, hueStyle, pickHue } from '@/components/philharmonic/lib/hue'

describe('pickHue', () => {
  it('is stable for the same seed', () => {
    expect(pickHue('alice-123')).toBe(pickHue('alice-123'))
  })

  it('covers all 8 hues across many seeds', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(pickHue(`seed-${i}`))
    expect(seen.size).toBe(8)
  })

  it('always returns a name from HUE_NAMES', () => {
    expect(HUE_NAMES).toContain(pickHue('whatever'))
  })

  it('handles empty and nullish seeds', () => {
    expect(HUE_NAMES).toContain(pickHue(''))
    expect(HUE_NAMES).toContain(pickHue(null))
    expect(HUE_NAMES).toContain(pickHue(undefined))
  })
})

describe('hueStyle', () => {
  it('is the hue fill under a neutral hairline, not a ring of the hue', () => {
    const style = hueStyle('lilac')
    expect(style.background).toBe('var(--ph-hue-lilac-fill)')
    expect(style.boxShadow).not.toContain('--ph-hue-lilac-ring')
    expect(style.boxShadow).toContain('var(--foreground)')
  })
})
