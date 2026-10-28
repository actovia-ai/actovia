export type WebSearchMediaKind = 'image' | 'video'

export interface WebSearchMediaResult {
  kind: WebSearchMediaKind
  title: string
  url: string
  sourceUrl: string
  thumbnailUrl?: string
  source?: string
  width?: number
  height?: number
  duration?: string
  age?: string
  /** Video only — channel / uploader name. */
  creator?: string
  /** Video only — view count. */
  views?: number
  /** Video only — hosting platform, e.g. "YouTube". */
  publisher?: string
}

export interface WebSearchResult {
  rank: number
  link: string
  title: string
  content: string
  snippet: string
  media?: WebSearchMediaResult[]
  /** Brave source metadata (enable_source_metadata). All optional. */
  siteName?: string
  hostname?: string
  /** Brave-provided favicon URL (primary; Google API is the fallback). */
  favicon?: string
  /** Source thumbnail URL for the hover card / panel. */
  thumbnail?: string
  /** Human freshness label, e.g. "5 days ago". */
  age?: string
  /** Set on the source that is Brave's structured data (`web/rich`), whose
   *  `content` is that data as JSON. */
  rich?: { vertical: string; provider?: string }
}
