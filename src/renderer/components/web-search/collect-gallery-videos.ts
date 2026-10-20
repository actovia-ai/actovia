import type { WebSearchResult } from '@actovia/shared/types/web-search'

export interface GalleryVideo {
  /** Watch URL (opened in the browser). */
  url: string
  /** Card thumbnail (falls back to `url`). */
  thumbnailUrl: string
  title: string
  /** Channel / site name. */
  source?: string
  /** e.g. "12:34". */
  duration?: string
  /** Channel / uploader name (preferred over `source` on the card). */
  creator?: string
  /** View count. */
  views?: number
}

/** Collect video media across a turn's results: videos only, deduped by url. */
export function collectGalleryVideos(
  results: WebSearchResult[]
): GalleryVideo[] {
  const out: GalleryVideo[] = []
  const seen = new Set<string>()
  for (const r of results) {
    for (const m of r.media ?? []) {
      if (m.kind !== 'video') continue
      const url = m.url
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push({
        url,
        thumbnailUrl: m.thumbnailUrl || url,
        title: m.title,
        source: m.source,
        duration: m.duration,
        creator: m.creator,
        views: m.views
      })
    }
  }
  return out
}
