import {
  createBraveClient,
  type DatedNewsArticle,
  newsArticles,
  type NewsArticle,
  newsSearch
} from '@actovia-ai/brave-search'

export { freshest, withoutSourceSuffix } from '@actovia-ai/brave-search'

export type BraveNewsArticle = NewsArticle

/** A pool article: what is shown, and when it was published (epoch ms, 0 when unknown). */
export type PooledNewsArticle = DatedNewsArticle

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
  const body = await newsSearch(createBraveClient({ apiKey }), {
    query,
    count: Math.min(Math.max(want * 5, 12), 30),
    country: opts.country,
    language: opts.language
  })
  return newsArticles(body)
}
