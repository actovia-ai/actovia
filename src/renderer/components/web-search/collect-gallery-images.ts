import type { WebSearchResult } from '@actovia/shared/types/web-search'

export interface GalleryImage {
  /** The site's own file: the image's identity and nothing else — never
   *  loaded (it may refuse a hotlink, be gone, or not answer). */
  url: string
  /** The copy Brave fetched: all the grid and the lightbox ever show. */
  thumbnailUrl: string
  title: string
  sourceUrl: string
  source?: string
}

/**
 * Collect image media across a turn's results: images with a Brave
 * thumbnail only, deduped by url. The site's own file is never shown
 * (owner, 2026-09-30), so an image without a thumbnail has nothing to show.
 */
export function collectGalleryImages(
  results: WebSearchResult[]
): GalleryImage[] {
  const out: GalleryImage[] = []
  const seen = new Set<string>()
  for (const r of results) {
    for (const m of r.media ?? []) {
      if (m.kind !== 'image') continue
      const url = m.url
      if (!url || !m.thumbnailUrl || seen.has(url)) continue
      seen.add(url)
      out.push({
        url,
        thumbnailUrl: m.thumbnailUrl,
        title: m.title,
        sourceUrl: m.sourceUrl,
        source: m.source
      })
    }
  }
  return out
}
