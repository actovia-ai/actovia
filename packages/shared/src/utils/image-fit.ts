/**
 * How a picture is prepared before a model sees it — the rule exodus-ios's
 * `ComposerPicture` applies on the phone, shared by the desktop composer and
 * the server's guard. Providers scale a large picture down themselves
 * (Anthropic to about 1568 px on the long side, OpenAI to fit 2048 px) and
 * Anthropic refuses one over 5 MB, so pixels past 2048 only cost upload,
 * storage and every later request of the chat, which sends the history again.
 */
export const IMAGE_MAX_PIXEL_SIZE = 2048
export const IMAGE_JPEG_QUALITY = 0.85
/** Past this many bytes a picture is re-encoded even when its size fits. */
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024

/** Raster types a picture is decoded from and re-encoded; anything else (GIF, SVG) is sent as it is. */
export const RESIZABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif'
])

/** The size a `width` × `height` picture is drawn at: its longest side at most `max`, never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  max: number = IMAGE_MAX_PIXEL_SIZE
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/** Whether a picture already within limits can be kept byte for byte. */
export function needsFitting(
  width: number,
  height: number,
  bytes: number
): boolean {
  return (
    Math.max(width, height) > IMAGE_MAX_PIXEL_SIZE || bytes > IMAGE_MAX_BYTES
  )
}
