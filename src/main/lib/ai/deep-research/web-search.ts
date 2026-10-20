import { WebSearchResult } from '@actovia/shared/types/web-search'

import { fetchWebSearch, type SearchLimits } from '../utils/web-search-util'

/**
 * Deep Research reads widely on purpose — a report is built from what its
 * searches bring back — so it keeps the volume the chat's search gave up:
 * twenty sources a query, the larger token budget, and no limit on how many
 * come from one site.
 */
export const DEEP_RESEARCH_LIMITS: SearchLimits = {
  sources: 20,
  perSite: Number.POSITIVE_INFINITY,
  contextTokens: 16_384,
  tokensPerSource: 8192,
  breadth: 15
}

export async function webSearch(
  {
    query,
    webSources
  }: {
    query: string
    webSources: Map<string, WebSearchResult>
  },
  {
    braveApiKey
  }: {
    braveApiKey: string
  }
) {
  return fetchWebSearch({
    query,
    braveApiKey,
    webSources,
    limits: DEEP_RESEARCH_LIMITS
  })
}
