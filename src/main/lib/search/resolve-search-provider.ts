import type { ChatSearchResult } from '@exodus/shared/types/chat-search'

import type { Settings } from '../db/schema'
import { logger } from '../logger'
import {
  createElasticsearchProvider,
  type ElasticsearchProviderConfig
} from './providers/elasticsearch-search'
import { pgliteSearchProvider } from './providers/pglite-search'
import type { SearchProvider } from './types'

export interface ResolvedSearchProvider {
  /** null when Elasticsearch isn't configured. */
  elasticsearch: SearchProvider | null
  /** Always available — the unconditional baseline. */
  pglite: SearchProvider
}

// resolveSearchProvider() runs on every chat turn (job enqueue, search,
// delete) — cache the ES provider (and its underlying Client/connection
// pool) keyed by config so we don't open a fresh client on every call.
// Invalidated automatically: a config change produces a different key, so
// the old entry is simply never reused (and gets garbage collected).
let cachedKey: string | null = null
let cachedProvider: SearchProvider | null = null

function configKey(config: ElasticsearchProviderConfig): string {
  return JSON.stringify([
    config.url,
    config.username ?? '',
    config.password ?? '',
    config.indexName ?? ''
  ])
}

/**
 * Never throws. The Elasticsearch `Client` constructor rejects malformed node
 * URLs synchronously (e.g. `localhost:9200` → "Invalid protocol"), and this
 * function is called from hot, unguarded paths — including the
 * `index-message` job handler (`../jobs/handlers.ts`) enqueued from
 * `POST /api/v1/chat`, where a throw would take down job processing entirely
 * rather than just search. A bad configuration is therefore treated exactly
 * like "not configured": log it and fall back to the always-available PGlite
 * provider.
 */
export function resolveSearchProvider(
  settings: Settings
): ResolvedSearchProvider {
  const config = settings.fullTextSearch?.elasticsearch
  let elasticsearch: SearchProvider | null = null

  if (config?.url && config.url !== '') {
    const key = configKey({ ...config, url: config.url })
    if (cachedProvider && cachedKey === key) {
      elasticsearch = cachedProvider
    } else {
      try {
        elasticsearch = createElasticsearchProvider({
          ...config,
          url: config.url
        })
        cachedKey = key
        cachedProvider = elasticsearch
      } catch (error) {
        logger.error(
          'search',
          'Invalid Elasticsearch configuration, falling back to PGlite',
          { error }
        )
        elasticsearch = null
      }
    }
  }

  return { elasticsearch, pglite: pgliteSearchProvider }
}

/**
 * Searches via Elasticsearch when configured, falling back to PGlite on any
 * query-time failure (unreachable cluster, auth error, timeout) so search
 * never goes fully dark because a self-hosted cluster isn't running. When
 * Elasticsearch isn't configured at all, queries PGlite directly.
 */
export async function searchWithFallback(
  settings: Settings,
  query: string
): Promise<ChatSearchResult[]> {
  const { elasticsearch, pglite } = resolveSearchProvider(settings)

  if (elasticsearch) {
    try {
      return await elasticsearch.search(query)
    } catch (error) {
      logger.error(
        'search',
        'Elasticsearch query failed, falling back to PGlite',
        { error }
      )
    }
  }

  return pglite.search(query)
}
