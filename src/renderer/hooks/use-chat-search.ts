import type { ChatSearchResult } from '@actovia/shared/types/chat-search'
import { fetcher } from '@actovia/shared/utils/http'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useDebouncedValue } from '@/hooks/use-debounce'

export const chatSearchKeys = {
  all: ['chat-search'] as const,
  term: (term: string) => [...chatSearchKeys.all, term] as const
}

/**
 * `GET /api/v1/chat/search` for what is typed, debounced: one row per chat
 * (`ChatSearchResult`). `term` is the query the rows answer, for marking its
 * words; `isSearching` holds while a newer one is on its way, so "no results"
 * is not said before it is known.
 */
export function useChatSearch(query: string) {
  const typed = query.trim()
  const term = useDebouncedValue(typed)
  const { data, isFetching } = useQuery({
    queryKey: chatSearchKeys.term(term),
    queryFn: () =>
      fetcher<ChatSearchResult[]>(
        `/api/v1/chat/search?query=${encodeURIComponent(term)}`
      ),
    // `term` lags `query` by the debounce: it is '' on the first keystroke, and
    // still the old term right after the input is cleared.
    enabled: !!typed && !!term,
    // The rows of the last term stay up while the next one is fetched.
    placeholderData: keepPreviousData
  })
  // A disabled key still returns its cached data, so a cleared input reads
  // empty here rather than showing the previous results until `term` settles.
  return {
    data: typed ? (data ?? []) : [],
    term: typed ? term : '',
    isSearching: !!typed && (term !== typed || isFetching)
  }
}
