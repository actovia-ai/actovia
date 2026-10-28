import { plainTitle } from './plain-title'
import type {
  BraveImageSearchResponse,
  BraveVideoSearchResponse,
  BraveWebSearchResponse
} from './types'

/** A `web/search` result flattened to what a citation needs. */
export type FlatWebSource = {
  url: string
  title: string
  content: string
  age?: string
  siteName?: string
  hostname?: string
  favicon?: string
  thumbnail?: string
}

export type MediaKind = 'image' | 'video'

export interface MediaResult {
  kind: MediaKind
  title: string
  url: string
  /** The page the picture or video is on. */
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

/** A site, for counting its results: the host without `www.`. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return url
  }
}

/** A page, for telling whether two links are one: host and path, without a
 *  trailing slash, query or fragment. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`.replace(/\/+$/u, '').toLowerCase()
  } catch {
    return url
  }
}

/** One picture whatever its rendition: a CMS serves `photo-1140x815.jpg`
 *  and `photo-120x86.jpg` of the same shot, and a search returns both. */
export function pictureKey(sourceUrl: string, imageUrl: string): string {
  try {
    const u = new URL(imageUrl)
    const path = u.pathname.replace(/-\d+x\d+(?=\.\w+$)/u, '')
    return `${pageKey(sourceUrl)}|${u.host}${path}`
  } catch {
    return imageUrl
  }
}

function normalizeUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).toString()
  } catch {
    return ''
  }
}

/**
 * A human freshness label from Brave's `age` array, e.g.
 * `["Thursday, June 18, 2026", "2026-06-18", "5 days ago"]` → "5 days ago":
 * a relative phrase, else the ISO date, else the last entry.
 */
export function pickAgeLabel(age?: string[]): string | undefined {
  if (!age || age.length === 0) return undefined
  const relative = age.find((a) => /\bago\b|^today$|^yesterday$/i.test(a))
  if (relative) return relative
  const iso = age.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  return iso ?? age[age.length - 1] ?? age[0]
}

/** Web, news and discussion results as one list, each url once. */
export function webResultsToSources(
  resp: BraveWebSearchResponse | null | undefined
): FlatWebSource[] {
  if (!resp) return []
  const out: FlatWebSource[] = []
  const seen = new Set<string>()

  const pushPage = (
    r: NonNullable<
      NonNullable<BraveWebSearchResponse['web']>['results']
    >[number]
  ) => {
    if (!r.url || !r.title || seen.has(r.url)) return
    const content = [r.description, ...(r.extra_snippets ?? [])]
      .filter(Boolean)
      .join('\n\n')
    if (!content) return
    seen.add(r.url)
    out.push({
      url: r.url,
      title: plainTitle(r.title),
      content,
      age: r.age,
      siteName: r.profile?.name ?? r.profile?.long_name,
      hostname: r.meta_url?.hostname,
      favicon: r.meta_url?.favicon,
      thumbnail: r.thumbnail?.src ?? r.thumbnail?.original
    })
  }

  for (const r of resp.web?.results ?? []) pushPage(r)
  for (const r of resp.news?.results ?? []) pushPage(r)
  for (const r of resp.discussions?.results ?? []) {
    if (!r.url || !r.title || seen.has(r.url)) continue
    const d = r.data
    const head = d?.forum_name
      ? `[Forum: ${d.forum_name}${d.num_answers ? `, ${d.num_answers} answers` : ''}]`
      : '[Discussion]'
    const content = [head, d?.question, d?.top_comment, r.description]
      .filter(Boolean)
      .join('\n\n')
    seen.add(r.url)
    out.push({ url: r.url, title: plainTitle(r.title), content, age: r.age })
  }

  return out
}

const keepAll = () => true

/** Image results, each picture once — the first rendition is the largest. */
export function imageResultsToMedia(
  resp: BraveImageSearchResponse | null | undefined,
  keep: (pageUrl: string) => boolean = keepAll
): MediaResult[] {
  const media: MediaResult[] = []
  const seen = new Set<string>()
  for (const r of resp?.results ?? []) {
    const imageUrl = normalizeUrl(r.properties?.url || r.thumbnail?.src)
    const sourceUrl = normalizeUrl(r.url)
    if (!imageUrl || !sourceUrl || !keep(sourceUrl)) continue
    const key = pictureKey(sourceUrl, imageUrl)
    if (seen.has(key)) continue
    seen.add(key)
    media.push({
      kind: 'image',
      title: r.title || r.source || sourceUrl,
      url: imageUrl,
      sourceUrl,
      thumbnailUrl:
        normalizeUrl(r.thumbnail?.src) ||
        normalizeUrl(r.properties?.placeholder) ||
        undefined,
      source: r.source,
      width: r.properties?.width,
      height: r.properties?.height
    })
  }
  return media
}

/** Video results, each url once. */
export function videoResultsToMedia(
  resp: BraveVideoSearchResponse | null | undefined,
  keep: (pageUrl: string) => boolean = keepAll
): MediaResult[] {
  const media: MediaResult[] = []
  const seen = new Set<string>()
  for (const r of resp?.results ?? []) {
    const videoUrl = normalizeUrl(r.url)
    if (!videoUrl || !keep(videoUrl) || seen.has(videoUrl)) continue
    seen.add(videoUrl)
    media.push({
      kind: 'video',
      title: r.title || r.meta_url?.hostname || videoUrl,
      url: videoUrl,
      sourceUrl: videoUrl,
      thumbnailUrl: normalizeUrl(r.thumbnail?.src) || undefined,
      source: r.source || r.meta_url?.hostname,
      duration: r.video?.duration || r.duration,
      age: r.age,
      creator: r.video?.creator,
      views: r.video?.views,
      publisher: r.video?.publisher
    })
  }
  return media
}
