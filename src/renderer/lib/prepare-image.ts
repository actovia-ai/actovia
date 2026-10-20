import {
  fitWithin,
  IMAGE_JPEG_QUALITY,
  RESIZABLE_IMAGE_TYPES
} from '@actovia/shared/utils/image-fit'

/** Whether any pixel is not fully opaque (every fourth byte is alpha). */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

/** The file name with the extension of the type it was re-encoded as. */
export function renamedFor(name: string, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg'
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name || 'image'}.${ext}`
}

/**
 * A picture ready for the model, as exodus-ios prepares one on the phone:
 * upright (the EXIF orientation applied), its longest side at most
 * `IMAGE_MAX_PIXEL_SIZE`, re-encoded as JPEG — PNG when it has transparency
 * — which also leaves its metadata, location among it, behind. A file that
 * is not a raster picture, or that this browser cannot decode (HEIC), is
 * returned as it is; the server's guard fits what gets through.
 */
export async function prepareImageFile(file: File): Promise<File> {
  if (!RESIZABLE_IMAGE_TYPES.has(file.type)) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    const mayBeTransparent =
      file.type === 'image/png' || file.type === 'image/webp'
    const keepsAlpha =
      mayBeTransparent &&
      hasTransparency(context.getImageData(0, 0, width, height).data)
    const type = keepsAlpha ? 'image/png' : 'image/jpeg'
    const blob = await canvas.convertToBlob(
      keepsAlpha ? { type } : { type, quality: IMAGE_JPEG_QUALITY }
    )
    return new File([blob], renamedFor(file.name, type), {
      type,
      lastModified: file.lastModified
    })
  } catch {
    return file
  } finally {
    bitmap.close()
  }
}
