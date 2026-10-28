import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

import { Settings } from '../../db/schema'
import { getModelFromProvider } from '../utils/model-util'
import { expandQuery } from '../utils/query-expansion'
import { fetchWebSearch } from '../utils/web-search-util'

const webSearchSchema = Type.Object({
  query: Type.String({
    description:
      'Keyword-style query, not a full question. Keep it under ~40 words. Use "quoted phrases" for exact matches, -term to exclude, site:domain to scope. Suffix a year/date when recency matters. Start broad; only add specifics on a follow-up search if the first was too general.'
  }),
  precision: Type.Optional(
    // StringEnum, not a Union of Literals: that emits `anyOf`/`const`, which
    // Google's function-calling schema rejects (pi-ai README, "Defining Tools").
    StringEnum(['broad', 'strict'] as const, {
      description:
        'Relevance filter. "broad" (default) maximizes recall. Use "strict" on a follow-up search when the broad results were noisy or off-topic.'
    })
  ),
  media: Type.Optional(
    StringEnum(['images', 'videos', 'all', 'none'] as const, {
      description:
        'Optional visual media search. Use "images" or "all" when building visual artifacts, comparisons, product/place explainers, or any answer that benefits from photos. Use "videos" or "all" for tutorials, demonstrations, or video-rich topics. Default: "none".'
    })
  )
})

export const webSearch = (
  setting: Settings,
  // Shared rank registry — webFetch writes into the same map so citation
  // numbers ([N]) stay coherent across both tools.
  webSources: Map<string, WebSearchResult> = new Map(),
  // The number the chat's earlier runs got to: this run counts on from it.
  rankBase = 0
): AgentTool<typeof webSearchSchema> => {
  let searchQueue = Promise.resolve()

  return {
    name: TOOL_NAMES.webSearch,
    label: 'Web Search',
    // No time in here: the tools head every request's prefix, and a value that
    // changes per request re-writes the provider's whole cache each message.
    // The system prompt carries the date (day granularity).
    description: `Search the web for up-to-date information. Results are numbered [1],[2],… — you MUST cite every factual sentence in your reply using 【N-source】 markers. Numbers run through the whole conversation: sources from earlier searches keep theirs and are cited the same way. A search brings back about ten sources: search again with a sharper query when they are not enough, and call web_fetch to read one in full. Set media="images", "videos", or "all" when the user asks for a visual artifact, visual comparison, product/place explanation, tutorial, or any answer that would be better with media.`,
    parameters: webSearchSchema,
    execute: async (_toolCallId, { query, media, precision }, signal) => {
      const search = async () => {
        if (signal?.aborted) throw new Error('Aborted')
        if (!setting?.webSearch?.braveApiKey) {
          throw new Error(
            'Web Search requires a Brave Search API Key. Please add it in Settings → Web Search.'
          )
        }
        const ws = setting.webSearch
        // Off unless switched on: about ten sources is what a search is; deep
        // recall is three phrasings and a breadth pass for the questions that
        // need it.
        const deep = ws.deepRecall === true

        // Fan-out: expand the query into complementary phrasings so recall
        // isn't bounded by one wording. Best-effort — a resolution or LLM
        // failure just searches the original query alone.
        let expandedQueries: string[] = []
        if (deep) {
          try {
            const { model, apiKey } = getModelFromProvider(setting)
            expandedQueries = await expandQuery(query, model, apiKey, signal)
          } catch {
            expandedQueries = []
          }
        }

        const details = await fetchWebSearch({
          query,
          braveApiKey: ws.braveApiKey!,
          webSources,
          rankBase,
          expandedQueries,
          media:
            media === 'images' ? 'image' : media === 'videos' ? 'video' : media,
          country: ws.country,
          languages: ws.languages,
          maxResults: ws.maxResults,
          recencyFilter: ws.recencyFilter,
          domainFilter: ws.domainFilter
            ? ws.domainFilter
                .split(',')
                .map((d) => d.trim())
                .filter(Boolean)
            : null,
          deep,
          threshold: precision,
          signal
        })

        if (!details?.length) {
          return {
            content: [
              { type: 'text' as const, text: 'No search results found.' }
            ],
            details: []
          }
        }

        for (const result of details) {
          webSources.set(result.link, result)
        }

        // Format results as structured text so the LLM knows each source's citation index.
        // IMPORTANT: you MUST cite every factual sentence using 【N-source】 where N is the source number below.
        const formatted =
          `IMPORTANT: cite every factual sentence with 【N-source】 where N is the source number — exactly that, nothing else inside the brackets. Sources of earlier searches in this conversation keep their numbers and stay citable.\n\n` +
          details
            .map((r) => {
              const text = `[${r.rank}] ${r.title}\nURL: ${r.link}\n${r.content}`
              if (!r.media || r.media.length === 0) return text
              const mediaLines = r.media.map((m, i) => {
                const attrs = [
                  m.thumbnailUrl ? `thumbnail: ${m.thumbnailUrl}` : '',
                  m.source ? `source: ${m.source}` : '',
                  m.creator ? `creator: ${m.creator}` : '',
                  m.views ? `views: ${m.views}` : '',
                  m.duration ? `duration: ${m.duration}` : '',
                  m.width && m.height ? `size: ${m.width}x${m.height}` : ''
                ]
                  .filter(Boolean)
                  .join('\n  ')
                return `${i + 1}. ${m.kind.toUpperCase()}: ${m.title}\n  url: ${m.url}\n  sourceUrl: ${m.sourceUrl}${attrs ? `\n  ${attrs}` : ''}`
              })
              return `${text}\n\nMedia results for visual/artifact use:\n${mediaLines.join('\n')}`
            })
            .join('\n\n---\n\n')

        return {
          content: [{ type: 'text' as const, text: formatted }],
          details
        }
      }

      const result = searchQueue.then(search, search)
      searchQueue = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }
}
