import { BASE_URL } from '@actovia/shared/constants/systems'
import type { GeneratedImage } from '@actovia/shared/types/chat'

/**
 * Where a generated image loads from: the local media route, by the chat and
 * the file it was saved under. A Philharmonic Group's image has no chat and
 * nothing to show here.
 */
export function imageSrcOf(image: Partial<GeneratedImage>): string | undefined {
  if (!image.mediaId || !image.chatId) return undefined
  return `${BASE_URL}/api/v1/media/${encodeURIComponent(image.chatId)}/${encodeURIComponent(image.mediaId)}`
}
