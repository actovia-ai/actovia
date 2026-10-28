import {
  type BraveLlmContextSourceMeta,
  BraveSearchError,
  createBraveClient,
  type FlatWebSource,
  imageResultsToMedia,
  imageSearch,
  llmContext,
  pageKey,
  pickAgeLabel,
  richHint,
  richSearch,
  richToSource,
  runLimited,
  siteOf,
  videoResultsToMedia,
  videoSearch,
  webResultsToSources,
  webSearch
} from '@actovia-ai/brave-search'
import {
  readDirect,
  type ReadDocument,
  readWithJina
} from '@actovia-ai/web-reader'
import type {
  WebSearchMediaKind,
  WebSearchMediaResult,
  WebSearchResult
} from '@actovia/shared/types/web-search'
import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf'

import { logger } from '../../logger'
import {
  assertNotActoviaApi,
  LocalApiTargetError
} from '../../net/local-api-guard'
import { fetchPinned } from '../../net/pinned-fetch'

/* ================= URL-to-Markdown (for webFetch) ================= */
// The reading is `@actovia-ai/web-reader` (packages/web-reader, ISSUE-270);
// what is Actovia's — the guard on its own API, the PDF parser — is here.

type LoadedDocument = ReadDocument

async function parsePdf(blob: Blob) {
  const loader = new WebPDFLoader(blob, { parsedItemSeparator: '' })
  const docs = await loader.load()
  return docs.map((d) => d.pageContent).join('\n')
}

/**
 * Built-in loader: the page fetched from this process (unlike the Jina
 * loader, which asks Jina's servers to fetch on our behalf), so it is the
 * one loader that must not be allowed to reach Actovia's own API —
 * `assertNotActoviaApi` checks the initial URL and every redirect hop before
 * its request, and the pinned connection checks the addresses it connects
 * to. Either refusal is thrown as `LocalApiTargetError`.
 */
export function loadDocumentBuiltin(
  link: string,
  signal?: AbortSignal
): Promise<LoadedDocument | null> {
  return readDirect(link, {
    signal,
    fetchHop: (url, s) => fetchPinned(url, { signal: s }),
    guard: assertNotActoviaApi,
    isRefusal: (error) => error instanceof LocalApiTargetError,
    parsePdf
  })
}

/**
 * Load a URL as markdown, used by the webFetch tool. Jina Reader is the
 * primary path (handles JS-rendered SPAs and most paywalled previews); if it
 * returns null we fall back to the built-in loader so a single blocked or
 * rate-limited Jina response doesn't break the agent's fetch.
 */
export async function loadDocument(
  link: string,
  signal?: AbortSignal
): Promise<LoadedDocument | null> {
  return (
    (await loadDocumentWithJina(link, signal)) ??
    (await loadDocumentBuiltin(link, signal))
  )
}

/** Jina Reader loader */
export function loadDocumentWithJina(link: string, signal?: AbortSignal) {
  return readWithJina(link, { signal })
}

/* ================= Brave Search ================= */
// The requests and the mapping of Brave's answers are `@actovia-ai/brave-search`
// (packages/brave-search); what is Actovia's — the limits, the merge into
// numbered sources, what the model is told — is here.

/** Why a search came back with nothing: Brave said no, or never answered. */
export type WebSearchFailure =
  | 'rate_limited'
  | 'unauthorized'
  | 'quota'
  | 'http'
  | 'network'

const FAILURE_MESSAGES: Record<WebSearchFailure, string> = {
  rate_limited:
    'Web search failed: the Brave Search rate limit was reached. Wait a moment and search again.',
  unauthorized:
    'Web search failed: Brave Search rejected the API key. Ask the user to check it in Settings → Built-in Tools.',
  quota: "Web search failed: the Brave Search plan's quota is used up for now.",
  http: 'Web search failed: Brave Search answered with an error.',
  network: 'Web search failed: Brave Search could not be reached.'
}

/**
 * A search that brought back nothing because its requests failed — never to
 * be told to the model as "no results". The message is written for the
 * model; it carries no query and no key.
 */
export class WebSearchError extends Error {
  constructor(
    readonly failure: WebSearchFailure,
    readonly status?: number
  ) {
    super(
      status && failure === 'http'
        ? `${FAILURE_MESSAGES.http} (HTTP ${status})`
        : FAILURE_MESSAGES[failure]
    )
    this.name = 'WebSearchError'
  }
}

/**
 * How much one search brings back. A search result stays in the context for
 * the rest of the chat, and sixty sources of one story mostly repeat each
 * other: a person reads a page or two of results (owner's call, 2026-09-29).
 * The industry's defaults are in the same place — Tavily 5 results, Exa 10,
 * Brave's own `llm/context` 20 URLs and 8192 tokens. The model searches again
 * with a sharper query when it needs more.
 */
export interface SearchLimits {
  /** Sources with content handed to the model. */
  sources: number
  /** Results of one site among them, and among the breadth extras. */
  perSite: number
  /** `llm/context`: the token budget of a request, and of one source in it. */
  contextTokens: number
  tokensPerSource: number
  /** Snippet-only sources the breadth pass may add (deep recall). */
  breadth: number
}

export const SEARCH_LIMITS: SearchLimits = {
  sources: 10,
  perSite: 2,
  contextTokens: 8192,
  tokensPerSource: 2048,
  breadth: 5
}

/** The most sources a search may be set to (Settings → Web Search). */
export const MAX_SEARCH_SOURCES = 20

/**
 * Hangs each picture or video on the page it came from, so the model cites
 * that page for it. They used to all hang on the first source, and the model
 * cited it for every one — a 2025 whitehouse.gov photo as a Reuters page
 * (2026-09-30). A picture from a page the search did not read becomes a
 * source of its own, numbered after the rest (or keeping the number that page
 * already has in this conversation), and says it was not read.
 */
function attachMedia(
  results: WebSearchResult[],
  media: WebSearchMediaResult[],
  baseRank: number,
  webSources?: Map<string, WebSearchResult>
): void {
  const byPage = new Map(results.map((r) => [pageKey(r.link), r]))
  const earlier = new Map(
    [...(webSources?.values() ?? [])].map((r) => [pageKey(r.link), r])
  )
  for (const m of media) {
    const key = pageKey(m.sourceUrl)
    let owner = byPage.get(key)
    if (!owner) {
      let host: string | undefined
      try {
        host = new URL(m.sourceUrl).hostname
      } catch {
        host = undefined
      }
      owner = {
        rank: earlier.get(key)?.rank ?? baseRank + results.length + 1,
        link: m.sourceUrl,
        title: m.title,
        snippet: '',
        content: `${m.kind === 'video' ? 'Video' : 'Image'}: ${m.title}\n(Found by a media search; the page itself was not read.)`,
        siteName: m.source,
        hostname: host
      }
      results.push(owner)
      byPage.set(key, owner)
    }
    owner.media = [...(owner.media ?? []), m]
  }
}

/**
 * The structured data Brave answered for `query` (ISSUE-240), as a source:
 * exact figures — a forecast, a quote and its series, a score — that the model
 * reasons from and draws artifacts with. It has no page of its own, so its
 * link is the query on Brave Search, which is one per query.
 */
function richResult(
  query: string,
  data: NonNullable<ReturnType<typeof richToSource>>,
  rank: number
): WebSearchResult {
  const provider = data.provider ?? 'Brave Search'
  const content =
    `Structured data (${data.vertical}) from ${provider}, via Brave Search. Exact figures: prefer them to the pages' text for numbers, and use them as they are for charts and artifacts.\n` +
    data.json +
    (data.truncated
      ? '\n(cut to fit; search again for one item to see it whole)'
      : '')
  let hostname: string | undefined
  try {
    hostname = data.providerUrl ? new URL(data.providerUrl).hostname : undefined
  } catch {
    hostname = undefined
  }
  return {
    rank,
    link: `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    title: `${provider} · ${data.vertical}`,
    snippet: content.slice(0, 300),
    content,
    siteName: provider,
    hostname,
    rich: { vertical: data.vertical, provider: data.provider }
  }
}

/**
 * Search the web via the Brave Search API and return structured results.
 *
 * `llm/context` is the primary layer — the source list and the extracted
 * content the model grounds on. With `deep`, a parallel `web/search` breadth
 * pass is merged in behind it (forums, news clusters, URLs the grounding
 * threshold dropped) as snippet-only secondary sources. The primary query's
 * `web/search` always asks for Brave's rich callback: when Brave has
 * structured data for the query (weather, a stock, a score…) it answers a
 * callback key, `web/rich` is asked for it, and the data leads the list.
 */
export async function fetchWebSearch({
  query,
  braveApiKey,
  webSources,
  media = 'none',
  country,
  languages,
  maxResults,
  recencyFilter,
  domainFilter,
  deep = false,
  threshold,
  expandedQueries,
  limits = SEARCH_LIMITS,
  rankBase = 0,
  signal
}: {
  query: string
  braveApiKey: string
  webSources?: Map<string, WebSearchResult>
  media?: 'none' | WebSearchMediaKind | 'all'
  country?: string | null
  languages?: string[] | null
  /** Settings → Web Search → Max results: sources per search, 1–20. */
  maxResults?: number | null
  recencyFilter?: string | null
  domainFilter?: string[] | null
  deep?: boolean
  threshold?: 'broad' | 'strict'
  /** Fan-out reformulations searched alongside `query` and merged. */
  expandedQueries?: string[] | null
  /** How much to bring back; the chat's by default (see `SEARCH_LIMITS`). */
  limits?: SearchLimits
  /**
   * The number the chat's earlier runs got to (`highestSourceRank`): this
   * search's sources are numbered after it.
   */
  rankBase?: number
  signal?: AbortSignal
}): Promise<WebSearchResult[] | null> {
  const client = createBraveClient({ apiKey: braveApiKey })
  // A Brave request that failed leaves its part empty, so the rest of the
  // search still answers; it is logged, and if nothing came back at all the
  // search throws the failure rather than passing it off as "no results".
  const failures: unknown[] = []
  const soft = <T>(endpoint: string, request: Promise<T>) =>
    request.catch((error: unknown) => {
      if (signal?.aborted) return null
      failures.push(error)
      logger.warn('web-search', 'Brave request failed', {
        endpoint,
        status: error instanceof BraveSearchError ? error.status : undefined,
        error
      })
      return null
    })
  const common = { country, languages, recency: recencyFilter, signal }

  try {
    const includeImages = media === 'image' || media === 'all'
    const includeVideos = media === 'video' || media === 'all'
    const queries = [query, ...(expandedQueries ?? [])].slice(0, 3)
    const sources = Math.min(
      Math.max(Math.trunc(maxResults ?? limits.sources), 1),
      MAX_SEARCH_SOURCES
    )

    // Text search fans out across the query variants; media and structured
    // data only ever run on the primary query. Cap 3 concurrent Brave calls
    // (free tier is 1 req/s; the client retries the 429s).
    const [perQuery, imageResp, videoResp] = await Promise.all([
      runLimited(queries, 3, async (q) => {
        const primary = q === query
        const [ctx, web] = await Promise.all([
          soft(
            'llm/context',
            llmContext(client, {
              query: q,
              ...common,
              sources,
              maxTokens: limits.contextTokens,
              maxTokensPerSource: limits.tokensPerSource,
              threshold
            })
          ),
          deep || primary
            ? soft(
                'web/search',
                webSearch(client, {
                  query: q,
                  ...common,
                  richCallback: primary
                })
              )
            : Promise.resolve(null)
        ])
        // Its breadth list is deep recall's; without it, only its hint is read.
        return { ctx, web, breadth: deep ? web : null }
      }),
      includeImages
        ? soft(
            'images/search',
            imageSearch(client, { query, ...common, recency: null })
          )
        : Promise.resolve(null),
      includeVideos
        ? soft('videos/search', videoSearch(client, { query, ...common }))
        : Promise.resolve(null)
    ])

    const hint = richHint(perQuery[0]?.web)
    const richResp = hint
      ? await soft('web/rich', richSearch(client, hint.callbackKey, signal))
      : null
    const richData = richToSource(richResp)

    // Brave doesn't accept a domain include/exclude filter at the API level
    // (Goggles aside), so we apply the user's comma-separated list here.
    // Entries prefixed with `-` exclude; bare entries include (or substring-
    // match for paths like `.edu`).
    const includes: string[] = []
    const excludes: string[] = []
    if (domainFilter && domainFilter.length > 0) {
      for (const raw of domainFilter) {
        const t = raw.trim()
        if (!t) continue
        if (t.startsWith('-')) excludes.push(t.slice(1).toLowerCase())
        else includes.push(t.toLowerCase())
      }
    }
    const passesDomainFilter = (url: string): boolean => {
      let host = ''
      try {
        host = new URL(url).hostname.toLowerCase()
      } catch {
        return false
      }
      if (excludes.some((d) => host.endsWith(d) || host.includes(d))) {
        return false
      }
      if (includes.length > 0) {
        return includes.some((d) => host.endsWith(d) || host.includes(d))
      }
      return true
    }

    const mediaResults = [
      ...imageResultsToMedia(imageResp, passesDomainFilter),
      ...videoResultsToMedia(videoResp, passesDomainFilter)
    ]

    const baseRank = rankBase + (webSources ? webSources.size : 0)
    const alreadyHave = (url: string) =>
      (webSources && webSources.has(url)) || !passesDomainFilter(url)

    // Merge grounded sources across every query variant. A URL surfaced by
    // more than one variant ranks higher; ties keep first-seen order.
    type Grounded = {
      title?: string
      snippets: string[]
      meta?: BraveLlmContextSourceMeta
      hits: number
      order: number
    }
    const grounded = new Map<string, Grounded>()
    let order = 0
    for (const { ctx } of perQuery) {
      for (const g of ctx?.grounding?.generic ?? []) {
        if (!g.url || alreadyHave(g.url)) continue
        const fresh = (g.snippets ?? []).filter(Boolean)
        const cur = grounded.get(g.url)
        if (cur) {
          cur.hits++
          for (const s of fresh)
            if (!cur.snippets.includes(s)) cur.snippets.push(s)
        } else {
          grounded.set(g.url, {
            title: g.title,
            snippets: [...fresh],
            meta: ctx?.sources?.[g.url],
            hits: 1,
            order: order++
          })
        }
      }
    }

    const results: WebSearchResult[] = []
    // The structured data leads, and is not one of the `sources`.
    if (richData) results.push(richResult(query, richData, baseRank + 1))
    const lead = results.length
    // Results of one site say much the same: a site gets `perSite` places,
    // among the grounded sources and the breadth extras together.
    const perSite = new Map<string, number>()
    const takesPlace = (url: string): boolean => {
      const site = siteOf(url)
      const taken = perSite.get(site) ?? 0
      if (taken >= limits.perSite) return false
      perSite.set(site, taken + 1)
      return true
    }
    const ranked = [...grounded.entries()].toSorted(
      (a, b) => b[1].hits - a[1].hits || a[1].order - b[1].order
    )
    for (const [url, g] of ranked) {
      if (results.length - lead >= sources) break
      const content = g.snippets.join('\n\n')
      if (!content) continue
      if (!takesPlace(url)) continue
      results.push({
        rank: baseRank + results.length + 1,
        link: url,
        title: g.title || g.meta?.title || g.meta?.hostname || url,
        snippet: content.slice(0, 300),
        content,
        siteName: g.meta?.site_name,
        hostname: g.meta?.hostname,
        favicon: g.meta?.favicon,
        thumbnail: g.meta?.thumbnail?.src ?? g.meta?.thumbnail?.original,
        age: pickAgeLabel(g.meta?.age)
      })
    }

    // Breadth pass: web/search URLs (across all variants) the grounding layer
    // didn't cover, appended as snippet-only sources.
    const seen = new Set<string>([
      ...results.map((r) => r.link),
      ...(webSources ? [...webSources.keys()] : [])
    ])
    const extras: FlatWebSource[] = []
    for (const { breadth } of perQuery) {
      for (const s of webResultsToSources(breadth)) {
        if (extras.length >= limits.breadth) break
        if (seen.has(s.url) || !passesDomainFilter(s.url)) continue
        seen.add(s.url)
        if (!takesPlace(s.url)) continue
        extras.push(s)
      }
      if (extras.length >= limits.breadth) break
    }
    for (const s of extras) {
      results.push({
        rank: baseRank + results.length + 1,
        link: s.url,
        title: s.title,
        snippet: s.content.slice(0, 300),
        content: s.content,
        siteName: s.siteName,
        hostname: s.hostname,
        favicon: s.favicon,
        thumbnail: s.thumbnail,
        age: s.age
      })
    }

    attachMedia(results, mediaResults, baseRank, webSources)

    if (results.length > 0) return results
    if (failures.length > 0) throw searchFailure(failures)
    return null
  } catch (error) {
    if (signal?.aborted) return null
    if (error instanceof WebSearchError) throw error
    logger.warn('web-search', 'Search results could not be read', { error })
    return null
  }
}

/** The failure to report for a search none of whose requests answered: a
 *  reason the user can act on (key, quota, rate) before a generic one. */
function searchFailure(failures: unknown[]): WebSearchError {
  const known = failures.filter(
    (f): f is BraveSearchError => f instanceof BraveSearchError
  )
  const order: WebSearchFailure[] = [
    'unauthorized',
    'quota',
    'rate_limited',
    'http'
  ]
  for (const failure of order) {
    const hit = known.find((f) => f.failure === failure)
    if (hit) return new WebSearchError(failure, hit.status)
  }
  return new WebSearchError('network')
}
