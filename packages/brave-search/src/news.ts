import type { BraveNewsResult, BraveNewsSearchResponse } from './types'

export interface NewsArticle {
  title: string
  url: string
  description: string
  source: string
  favicon?: string
  thumbnail?: string
  /** Brave's freshness label, e.g. "10 hours ago". */
  age?: string
  /** ISO timestamp from `page_age`, when Brave has one — the honest one. */
  publishedAt?: string
}

/** An article and when it was published (epoch ms, 0 when unknown). */
export interface DatedNewsArticle extends NewsArticle {
  publishedMs: number
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * A title without the outlet a site appends to it ("… - The Japan Times"):
 * only when the tail is that source, so a title that merely contains a dash
 * keeps it.
 */
export function withoutSourceSuffix(title: string, source: string): string {
  const name = source.trim().toLowerCase()
  if (!name) return title
  const match = /^(.*\S)\s+[-–—|]\s+([^-–—|]+)$/u.exec(title.trim())
  if (!match) return title
  return match[2].trim().toLowerCase() === name ? match[1] : title
}

/** Brave's `page_age` is UTC but usually ships without the trailing `Z`. */
function normalizeIso(s: string | undefined): string | undefined {
  if (!s) return undefined
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s
  return `${s.replace(' ', 'T')}Z`
}

const RELATIVE_AGE_RE = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000
}

/** `page_age` when there is one, else the relative `age`; 0 for neither
 *  (usually an evergreen page — a club profile, a "how to watch" hub). */
function publishedAtMs(r: BraveNewsResult, now: number): number {
  const iso = normalizeIso(r.page_age)
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return t
  }
  const age = r.age?.trim()
  if (age) {
    if (/^just now$/i.test(age)) return now
    const m = RELATIVE_AGE_RE.exec(age)
    if (m) return now - Number(m[1]) * UNIT_MS[m[2].toLowerCase()]
  }
  return 0
}

/** News results as articles, in Brave's relevance order; one without a title
 *  or url is left out. The source is the outlet's readable name when known. */
export function newsArticles(
  resp: BraveNewsSearchResponse | null | undefined,
  now = Date.now()
): DatedNewsArticle[] {
  return (resp?.results ?? []).flatMap((r) => {
    if (!r.title || !r.url) return []
    const source =
      r.profile?.name ??
      r.profile?.long_name ??
      r.source ??
      r.meta_url?.hostname ??
      safeHostname(r.url)
    return [
      {
        title: withoutSourceSuffix(r.title, source),
        url: r.url,
        description: r.description ?? '',
        source,
        favicon: r.meta_url?.favicon,
        thumbnail: r.thumbnail?.src,
        age: r.age,
        publishedAt: normalizeIso(r.page_age),
        publishedMs: publishedAtMs(r, now)
      }
    ]
  })
}

/** The `count` most recent articles, newest first; undated ones sort last. */
export function freshest(
  articles: DatedNewsArticle[],
  count: number
): NewsArticle[] {
  return articles
    .toSorted((a, b) => b.publishedMs - a.publishedMs)
    .slice(0, Math.max(count, 1))
    .map(({ publishedMs: _publishedMs, ...article }) => article)
}
