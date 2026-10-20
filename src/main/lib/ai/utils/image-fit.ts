import {
  fitWithin,
  IMAGE_JPEG_QUALITY,
  needsFitting,
  RESIZABLE_IMAGE_TYPES
} from '@actovia/shared/utils/image-fit'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { nativeImage } from 'electron'

import { logger } from '../../logger'
import { bareImageData } from './image-data'

type Part = TextContent | ImageContent

/** Whether a BGRA/RGBA bitmap has a pixel that is not fully opaque. */
function hasTransparency(bitmap: Buffer): boolean {
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] < 255) return true
  }
  return false
}

/**
 * One image part within the shared limits (`@actovia/shared/utils/image-fit`).
 * The clients prepare a picture before sending it (the desktop composer,
 * exodus-ios); this is the guard for one that did not — an older client, or
 * a type the renderer could not decode. A part within limits, a remote URL,
 * a type that is not a raster picture or one that will not decode is
 * returned as it is, so a stored row only ever changes once, here.
 */
export function fitImagePart(part: Part): Part {
  if (part.type !== 'image' || !part.data.startsWith('data:')) return part
  const { data, mimeType } = bareImageData(part.data, part.mimeType)
  if (!RESIZABLE_IMAGE_TYPES.has(mimeType)) return part
  const bytes = Buffer.from(data, 'base64')
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return part
  const size = image.getSize()
  if (!needsFitting(size.width, size.height, bytes.length)) return part
  const target = fitWithin(size.width, size.height)
  const resized =
    target.width === size.width && target.height === size.height
      ? image
      : image.resize({ ...target, quality: 'best' })
  const keepsAlpha =
    mimeType === 'image/png' && hasTransparency(resized.toBitmap())
  const type = keepsAlpha ? 'image/png' : 'image/jpeg'
  const out = keepsAlpha
    ? resized.toPNG()
    : resized.toJPEG(Math.round(IMAGE_JPEG_QUALITY * 100))
  logger.info('chat', 'image fitted before saving', {
    from: `${size.width}x${size.height}`,
    to: `${target.width}x${target.height}`,
    fromBytes: bytes.length,
    toBytes: out.length
  })
  return {
    ...part,
    data: `data:${type};base64,${out.toString('base64')}`,
    mimeType: type
  }
}

/** The message with every image part fitted; the same object if none needed it. */
export function withFittedImages<M extends { content: string | Part[] }>(
  message: M
): M {
  if (typeof message.content === 'string') return message
  let changed = false
  const content = message.content.map((part) => {
    const next = fitImagePart(part)
    if (next !== part) changed = true
    return next
  })
  return changed ? { ...message, content } : message
}
