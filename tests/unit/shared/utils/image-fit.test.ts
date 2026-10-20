import {
  fitWithin,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXEL_SIZE,
  needsFitting
} from '@actovia/shared/utils/image-fit'
import { describe, expect, it } from 'vitest'

describe('fitWithin', () => {
  it('keeps a picture that already fits', () => {
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(fitWithin(2048, 2048)).toEqual({ width: 2048, height: 2048 })
  })

  it('scales the longest side to the limit, landscape and portrait', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 })
  })

  it('never rounds a thin side to zero', () => {
    expect(fitWithin(100_000, 10)).toEqual({ width: 2048, height: 1 })
  })
})

describe('needsFitting', () => {
  it('is false within both limits', () => {
    expect(needsFitting(IMAGE_MAX_PIXEL_SIZE, 100, IMAGE_MAX_BYTES)).toBe(false)
  })

  it('is true past the pixel limit or the byte limit', () => {
    expect(needsFitting(IMAGE_MAX_PIXEL_SIZE + 1, 100, 10)).toBe(true)
    expect(needsFitting(800, 600, IMAGE_MAX_BYTES + 1)).toBe(true)
  })
})
