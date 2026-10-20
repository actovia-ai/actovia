import type { DiscoverFeedDto } from '@actovia/shared/types/discover'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getDiscoverFeed, refreshDiscoverFeed } from '@/services/discover'

// While a refresh is running, poll so the freshly generated groups appear
// without a manual reload.
const REFRESHING_POLL_MS = 3000

export const discoverKeys = { feed: ['discover', 'feed'] as const }

// Module-level: this hook renders on the chat path, once per streamed frame.
const pollWhileRefreshing = (query: {
  state: { data: DiscoverFeedDto | undefined }
}) => (query.state.data?.status === 'refreshing' ? REFRESHING_POLL_MS : false)

/**
 * Shared read of the Home Discover feed. `messages.tsx` uses it to decide
 * whether the landing screen has feed content to show (which drives the
 * greeting layout), and `DiscoverFeed` uses it to render the feed itself —
 * one query key, so both consumers share a single request and cache entry.
 *
 * Pass `enabled: false` when the user hasn't opted into Discover or the route
 * isn't the true home: it makes no request (no mount read, no focus refetch,
 * no poll) but still returns whatever the cache already holds.
 */
export function useDiscoverFeed(enabled: boolean) {
  const { data } = useQuery({
    queryKey: discoverKeys.feed,
    queryFn: getDiscoverFeed,
    enabled,
    refetchInterval: pollWhileRefreshing,
    // A cron regenerates the feed behind the renderer's back; coming back to
    // the window is the moment to look. Off app-wide (settings autosave), but
    // this writes nothing to settings.
    refetchOnWindowFocus: true
  })

  return { feed: data ?? null }
}

/**
 * Starts a refresh and writes the feed the POST returns straight into the
 * cache — no GET behind it, so the answer isn't raced by a read of the state
 * before it. `silent`: the global handler still reports to the log but does
 * not toast, because the two callers differ (the first-opt-in kick stays
 * quiet, the refresh button shows its own message) and both catch the
 * rejection themselves.
 */
export function useRefreshDiscoverFeed() {
  const queryClient = useQueryClient()
  return useMutation({
    // Bare call: React Query would hand the service (variables, context).
    mutationFn: () => refreshDiscoverFeed(),
    onSuccess: async (feed) => {
      // A read already in flight (a focus refetch, a poll) would land after
      // the write with the pre-refresh feed and overwrite it.
      await queryClient.cancelQueries({ queryKey: discoverKeys.feed })
      queryClient.setQueryData(discoverKeys.feed, feed)
    },
    meta: { silent: true }
  })
}
