const BRAVE_NEWS_URL = 'https://api.search.brave.com/res/v1/news/search'

export interface BraveNewsArticle {
  title: string
  url: string
  description: string
  source: string
  favicon?: string
  thumbnail?: string
  /** Human freshness label from Brave, e.g. "10 hours ago". */
  age?: string
  /** ISO timestamp from Brave (`page_age`), when available — the honest one. */
  publishedAt?: string
}

interface BraveNewsRawResult {
  title?: string
  url?: string
  description?: string
  source?: string
  age?: string
  page_age?: string
  thumbnail?: { src?: string }
  meta_url?: { hostname?: string; favicon?: string }
  /** Publisher identity — the readable outlet name ("ESPN", "The Guardian"). */
  profile?: { name?: string; long_name?: string }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * A title without the outlet a site appends to it ("… - The Japan Times"): the
 * card already names the source right under it. Only when the tail is that
 * source, so a title that merely contains a dash keeps it.
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

/**
 * Epoch-ms estimate of when an article was published (higher = more recent).
 * `page_age` (ISO) is authoritative; otherwise parse Brave's relative `age`
 * string; a result with neither sorts to the bottom (usually an evergreen
 * page — a club profile, a "how to watch" hub — not real news).
 */
function publishedAtMs(r: BraveNewsRawResult): number {
  const iso = normalizeIso(r.page_age)
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return t
  }
  if (r.age) {
    if (/^just now$/i.test(r.age.trim())) return Date.now()
    const m = RELATIVE_AGE_RE.exec(r.age.trim())
    if (m) return Date.now() - Number(m[1]) * UNIT_MS[m[2].toLowerCase()]
  }
  return 0
}

/** A pool article: what is shown, and when it was published (epoch ms, 0 when unknown). */
export interface PooledNewsArticle extends BraveNewsArticle {
  publishedMs: number
}

/**
 * A wide pool for `count` articles, in Brave's relevance order, from the past
 * week. Which of them are shown is the caller's: Brave News ranks by
 * relevance with no sort param, and re-sorting the raw pool by recency put a
 * fresh but unrelated story (a court case under "Beijing travel") ahead of
 * the ones about the topic. The manager has them judged first, then takes
 * the freshest of what is left (`freshest`). A week, not a day: a niche topic
 * has too few stories in a day, and Brave fills the pool with loose matches.
 */
export async function searchBraveNews(
  apiKey: string,
  query: string,
  opts: { count: number; country?: string | null; language?: string | null }
): Promise<PooledNewsArticle[]> {
  const want = Math.max(opts.count, 1)
  const poolSize = Math.min(Math.max(want * 5, 12), 30)

  const params = new URLSearchParams()
  params.set('q', query)
  params.set('count', String(poolSize))
  params.set('freshness', 'pw')
  if (opts.country) params.set('country', opts.country.toLowerCase())
  if (opts.language) params.set('search_lang', opts.language)

  const res = await fetch(`${BRAVE_NEWS_URL}?${params.toString()}`, {
    headers: { accept: 'application/json', 'x-subscription-token': apiKey }
  })
  if (!res.ok) {
    throw new Error(`Brave News search failed: ${res.status}`)
  }
  const body = (await res.json()) as { results?: BraveNewsRawResult[] }

  return (body.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => {
      const source =
        r.profile?.name ??
        r.profile?.long_name ??
        r.source ??
        r.meta_url?.hostname ??
        safeHostname(r.url!)
      return {
        title: withoutSourceSuffix(r.title!, source),
        url: r.url!,
        description: r.description ?? '',
        source,
        favicon: r.meta_url?.favicon,
        thumbnail: r.thumbnail?.src,
        age: r.age,
        publishedAt: normalizeIso(r.page_age),
        publishedMs: publishedAtMs(r)
      }
    })
}

/**
 * The `count` most recent of `articles`, as shown: a Google-News-style
 * "latest" among the ones kept. One with no timestamp (usually an evergreen
 * page, a club profile or a "how to watch" hub) sorts last.
 */
export function freshest(
  articles: PooledNewsArticle[],
  count: number
): BraveNewsArticle[] {
  return articles
    .toSorted((a, b) => b.publishedMs - a.publishedMs)
    .slice(0, Math.max(count, 1))
    .map(({ publishedMs: _publishedMs, ...article }) => article)
}
