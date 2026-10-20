// The map card's Places photos go through Actovia's own proxy: the URL an
// `<img>` loads names the photo, never the user's key (final review I5).
import { BASE_URL } from '@actovia/shared/constants/systems'
import { describe, expect, it } from 'vitest'

import { buildPlacePhotoUrl } from '@/components/calling-tools/map-itinerary/types'

describe('buildPlacePhotoUrl', () => {
  it('points at /api/v1/maps/photo with the name and width, and no key', () => {
    const url = buildPlacePhotoUrl('places/abc/photos/def-_1', 240)!
    expect(url.startsWith(`${BASE_URL}/api/v1/maps/photo?`)).toBe(true)
    const params = new URL(url).searchParams
    expect(params.get('name')).toBe('places/abc/photos/def-_1')
    expect(params.get('maxWidth')).toBe('240')
    expect(url).not.toMatch(/key=/u)
    expect(url).not.toContain('googleapis.com')
  })

  it('is null without a photo name', () => {
    expect(buildPlacePhotoUrl(undefined)).toBeNull()
  })
})
