/** How recent results must be. Brave has no past hour: it is the past day. */
export type Recency = 'hour' | 'day' | 'week' | 'month' | 'year'

export const BRAVE_FRESHNESS: Record<Recency, string> = {
  hour: 'pd',
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py'
}

export interface CommonSearchOptions {
  query: string
  /** A 2-letter country code. */
  country?: string | null
  /** Brave takes one search language: the first is used. */
  languages?: string[] | null
  /** A `Recency`; anything else is ignored. */
  recency?: string | null
}

/** Brave's `count` is at most 20 per request. */
export const MAX_COUNT = 20

export function commonParams(
  { query, country, languages, recency }: CommonSearchOptions,
  count?: number | null
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('q', query)
  if (country) params.set('country', country.toLowerCase())
  if (languages && languages.length > 0) params.set('search_lang', languages[0])
  const freshness = recency ? BRAVE_FRESHNESS[recency as Recency] : undefined
  if (freshness) params.set('freshness', freshness)
  if (count && count > 0)
    params.set('count', String(Math.min(count, MAX_COUNT)))
  return params
}
