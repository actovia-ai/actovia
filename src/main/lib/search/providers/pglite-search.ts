import { searchChats } from '../../db/queries'
import type { SearchProvider } from '../types'

/**
 * PGlite's own indexing happens at write time via the `searchText` column
 * populated in `saveMessages()` — this provider only serves queries; the
 * `indexMessage`/`deleteByChatId`/`deleteAll` methods exist to satisfy
 * `SearchProvider` but do no independent work (a chat's rows, and their GIN
 * index entries, are already removed by `deleteChatById`'s SQL DELETE, and by
 * `resetAllData()`'s TRUNCATE).
 */
export const pgliteSearchProvider: SearchProvider = {
  indexMessage: async () => {},
  bulkIndexMessages: async () => {},
  deleteByChatId: async () => {},
  deleteAll: async () => {},
  async search(query) {
    return searchChats(query)
  },
  // Always reachable — it's the local, unconditional baseline.
  ping: async () => {}
}
