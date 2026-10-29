import type { WebSearchResult } from '@actovia/shared/types/web-search'

import {
  collectGalleryImages,
  type GalleryImage
} from './collect-gallery-images'
import {
  collectGalleryVideos,
  type GalleryVideo
} from './collect-gallery-videos'

/** The urls of what a search's results would show: pictures, then videos. */
export function searchMediaUrls(results: WebSearchResult[]): string[] {
  return [
    ...collectGalleryImages(results).map((image) => image.url),
    ...collectGalleryVideos(results).map((video) => video.url)
  ]
}

/**
 * A search's pictures and videos, less those an earlier search of the run
 * already showed (`shown`: their urls, one per line).
 */
export function searchMedia(
  results: WebSearchResult[],
  shown: string
): { images: GalleryImage[]; videos: GalleryVideo[] } {
  const seen = new Set(shown ? shown.split('\n') : [])
  return {
    images: collectGalleryImages(results).filter((i) => !seen.has(i.url)),
    videos: collectGalleryVideos(results).filter((v) => !seen.has(v.url))
  }
}
