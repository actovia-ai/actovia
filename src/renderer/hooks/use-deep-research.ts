import { useQuery } from '@tanstack/react-query'

import { fetchDeepResearchResult } from '@/services/deep-research'
import type { DeepResearch } from '@/types/db'

export const deepResearchKeys = {
  result: (id: string) => ['deep-research', 'result', id] as const
}

/**
 * One deep-research job's row. The Deep Research card and the process panel
 * both read it, on one key, so they share a single request.
 *
 * `refetch` is the observer's own function: stable across renders, which
 * `DeepResearchProcess`'s SSE effect relies on (it lists it as a dependency,
 * and a new function per render would reopen the stream on every render).
 * Return it as-is — never wrap it in an inline function or spread the query.
 */
export function useDeepResearchResult(id: string | undefined) {
  const { data, refetch, isPending, error } = useQuery({
    queryKey: deepResearchKeys.result(id ?? ''),
    // `refetch()` bypasses `enabled`, and a stream that outlived its id can
    // still call it: with no id there is nothing to read, so resolve `null`
    // (no request, and no error for the global handler to report).
    queryFn: async (): Promise<DeepResearch | null> =>
      id ? fetchDeepResearchResult(id) : null,
    enabled: !!id
  })
  return { data: data ?? undefined, refetch, isPending, error }
}
