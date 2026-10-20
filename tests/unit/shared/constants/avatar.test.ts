import {
  AVATAR_STYLES,
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@actovia/shared/constants/avatar'
import { describe, expect, it } from 'vitest'

describe('avatar constants', () => {
  it('exposes the candidate styles and a default within them', () => {
    expect(AVATAR_STYLES).toContain(DEFAULT_AVATAR_STYLE)
    expect(AVATAR_STYLES.length).toBeGreaterThanOrEqual(3)
  })

  it('generates non-empty unique-ish seeds', () => {
    const a = randomAvatarSeed()
    const b = randomAvatarSeed()
    expect(a).toMatch(/^[a-z0-9]+$/i)
    expect(a).not.toBe(b)
  })
})
