import type { BraveClient } from './client'
import { commonParams, type CommonSearchOptions, MAX_COUNT } from './params'
import type {
  BraveImageSearchResponse,
  BraveLlmContextResponse,
  BraveNewsSearchResponse,
  BraveRichResponse,
  BraveVideoSearchResponse,
  BraveWebSearchResponse
} from './types'

type WithSignal = { signal?: AbortSignal }

/**
 * `llm/context`: the sources Brave grounds a query on, with their extracted
 * text. Spellcheck is off — model-written queries are spelled as meant, and
 * Brave's spellchecker turns identifiers into words ("reqwest" → "request").
 */
export function llmContext(
  client: BraveClient,
  {
    sources,
    maxTokens,
    maxTokensPerSource,
    threshold,
    signal,
    ...common
  }: CommonSearchOptions &
    WithSignal & {
      sources: number
      /** The request's token budget, and one source's: keep the second a
       *  fraction of the first, or the first source eats the whole budget. */
      maxTokens: number
      maxTokensPerSource: number
      /** `strict` for a precision follow-up; Brave's default is lenient. */
      threshold?: 'broad' | 'strict'
    }
): Promise<BraveLlmContextResponse> {
  const params = commonParams(common)
  params.set('count', String(sources))
  params.set('maximum_number_of_urls', String(sources))
  params.set('maximum_number_of_tokens', String(maxTokens))
  params.set('maximum_number_of_tokens_per_url', String(maxTokensPerSource))
  params.set('enable_source_metadata', 'true')
  params.set('spellcheck', 'false')
  if (threshold === 'strict') params.set('context_threshold_mode', 'strict')
  return client.get('/llm/context', params, signal)
}

/**
 * `web/search`: a wider, differently ranked list — with forum threads and news
 * clusters — at snippet depth. With `richCallback`, a query Brave has
 * structured data for (weather, a stock, a score…) also answers a `rich` hint
 * for `richSearch`.
 */
export function webSearch(
  client: BraveClient,
  {
    count = MAX_COUNT,
    richCallback = false,
    signal,
    ...common
  }: CommonSearchOptions &
    WithSignal & { count?: number; richCallback?: boolean }
): Promise<BraveWebSearchResponse> {
  const params = commonParams(common, count)
  params.set('result_filter', 'web,news,discussions')
  params.set('extra_snippets', 'true')
  params.set('spellcheck', 'false')
  if (richCallback) params.set('enable_rich_callback', 'true')
  return client.get('/web/search', params, signal)
}

/** `web/rich`: the structured data a `rich` hint's callback key names. */
export function richSearch(
  client: BraveClient,
  callbackKey: string,
  signal?: AbortSignal
): Promise<BraveRichResponse> {
  const params = new URLSearchParams()
  params.set('callback_key', callbackKey)
  return client.get('/web/rich', params, signal)
}

/** `images/search`, strict safe search, at most 8. */
export function imageSearch(
  client: BraveClient,
  {
    count,
    signal,
    ...common
  }: CommonSearchOptions & WithSignal & { count?: number }
): Promise<BraveImageSearchResponse> {
  const params = commonParams(
    { ...common, recency: null },
    Math.min(count ?? 6, 8)
  )
  params.set('safesearch', 'strict')
  return client.get('/images/search', params, signal)
}

/** `videos/search`, moderate safe search, at most 6. */
export function videoSearch(
  client: BraveClient,
  {
    count,
    signal,
    ...common
  }: CommonSearchOptions & WithSignal & { count?: number }
): Promise<BraveVideoSearchResponse> {
  const params = commonParams(common, Math.min(count ?? 4, 6))
  params.set('safesearch', 'moderate')
  return client.get('/videos/search', params, signal)
}

/** `news/search`, the past week unless told otherwise. */
export function newsSearch(
  client: BraveClient,
  {
    query,
    count,
    country,
    language,
    freshness = 'pw',
    signal
  }: WithSignal & {
    query: string
    count: number
    country?: string | null
    language?: string | null
    /** Brave's own code: `pd`, `pw`, `pm`, `py` or a date range. */
    freshness?: string
  }
): Promise<BraveNewsSearchResponse> {
  const params = new URLSearchParams()
  params.set('q', query)
  if (country) params.set('country', country.toLowerCase())
  if (language) params.set('search_lang', language)
  params.set('count', String(count))
  params.set('freshness', freshness)
  return client.get('/news/search', params, signal)
}
