import { describe, expect, it } from 'vitest'

import { hasTransparency, renamedFor } from '@/lib/prepare-image'

describe('hasTransparency', () => {
  it('is false when every alpha byte is 255', () => {
    expect(
      hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))
    ).toBe(false)
  })

  it('is true when one pixel is not fully opaque', () => {
    expect(
      hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 254]))
    ).toBe(true)
  })
})

describe('renamedFor', () => {
  it('takes the extension of the type it was encoded as', () => {
    expect(renamedFor('IMG_0001.HEIC', 'image/jpeg')).toBe('IMG_0001.jpg')
    expect(renamedFor('shot.webp', 'image/png')).toBe('shot.png')
  })

  it('names a file without a name or extension', () => {
    expect(renamedFor('', 'image/jpeg')).toBe('image.jpg')
    expect(renamedFor('photo', 'image/png')).toBe('photo.png')
  })
})
