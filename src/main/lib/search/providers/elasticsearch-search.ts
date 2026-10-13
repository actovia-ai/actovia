import { Client } from '@elastic/elasticsearch'

import { getChatsByTitle, getMessageHitsByIds } from '../../db/queries'
import type { Message } from '../../db/schema'
import { logger } from '../../logger'
import { buildChatSearchResults } from '../chat-search-results'
import { searchWords } from '../snippet'
import type { SearchProvider } from '../types'

export interface ElasticsearchProviderConfig {
  url: string
  username?: string | null
  password?: string | null
  indexName?: string | null
}

const DEFAULT_INDEX_NAME = 'exodus-messages'
// Enough newest hits to fill 30 chats, a few messages each.
const HIT_LIMIT = 300

export function createElasticsearchProvider(
  config: ElasticsearchProviderConfig
): SearchProvider {
  const client = new Client({
    node: config.url,
    auth:
      config.username && config.password
        ? { username: config.username, password: config.password }
        : undefined,
    // The transport defaults to no request timeout and 3 retries, so a
    // routable-but-unreachable host (firewalled, wrong port, VPN-only cluster)
    // hangs forever instead of rejecting — which means the PGlite fallback in
    // `GET /api/v1/chat/search` never fires and the fire-and-forget indexing calls
    // pile up as hung promises. Fail fast and let the fallback do its job.
    requestTimeout: 5000,
    maxRetries: 1
  })
  const indexName = config.indexName || DEFAULT_INDEX_NAME

  return {
    async indexMessage(message: Message) {
      if (!message.searchText) return
      await client.index({
        index: indexName,
        id: message.id,
        document: {
          chatId: message.chatId,
          searchText: message.searchText,
          createdAt: message.createdAt
        }
      })
    },

    async bulkIndexMessages(messages: Message[]) {
      const documents = messages.filter(
        (m): m is Message & { searchText: string } => !!m.searchText
      )
      if (documents.length === 0) return
      const stats = await client.helpers.bulk({
        datasource: documents,
        onDocument(doc) {
          return { index: { _index: indexName, _id: doc.id } }
        },
        // client.helpers.bulk() already continues past a dropped document on
        // its own (its internal retry loop calls this synchronously, so it
        // must never throw) — log-and-continue makes drops visible instead
        // of silent, without disrupting the helper's own bookkeeping.
        onDrop(dropped) {
          logger.error('search', 'Bulk index dropped a document', {
            id: dropped.document?.id,
            error: dropped.error
          })
        }
      })
      if (stats.failed > 0) {
        logger.error('search', 'Bulk index completed with failures', {
          failed: stats.failed,
          successful: stats.successful,
          total: stats.total
        })
      }
    },

    async deleteByChatId(chatId: string) {
      // `chatId.keyword`, not `chatId`: no explicit mapping is created for this
      // index, so dynamic mapping types `chatId` as analyzed `text` — whose
      // tokens are the UUID split on hyphens, which an (unanalyzed) `term`
      // query can never match. The `.keyword` multi-field that dynamic mapping
      // adds alongside every `text` field holds the whole value verbatim.
      await client.deleteByQuery({
        index: indexName,
        query: { term: { 'chatId.keyword': chatId } }
      })
    },

    async deleteAll() {
      await client.deleteByQuery({
        index: indexName,
        query: { match_all: {} }
      })
    },

    async search(query: string) {
      const words = searchWords(query)
      if (words.length === 0) return []
      // Every word, like PGlite's AND, and the newest hits: results are dated
      // and ordered by their newest match, not ranked by relevance.
      const result = await client.search({
        index: indexName,
        query: { match: { searchText: { query, operator: 'and' } } },
        sort: [{ createdAt: { order: 'desc' } }],
        size: HIT_LIMIT,
        _source: false
      })
      const ids = result.hits.hits
        // Bracket access sidesteps no-underscore-dangle — `_id` is
        // Elasticsearch's own response field name, not ours to rename.
        .map((hit) => hit['_id'])
        .filter((id): id is string => typeof id === 'string')
      // The index holds messages only; titles are matched in PGlite.
      const [hits, titled] = await Promise.all([
        getMessageHitsByIds(ids),
        getChatsByTitle(words)
      ])
      return buildChatSearchResults(
        [...hits.chats, ...titled],
        hits.messages,
        words
      )
    },

    async ping() {
      // `client.info()` is a pure cluster-info read — unlike `search()`, it
      // doesn't require `indexName` to exist yet, so it correctly reports a
      // freshly-configured cluster as reachable instead of failing with
      // `index_not_found_exception` before anything has been indexed.
      await client.info()
    }
  }
}
