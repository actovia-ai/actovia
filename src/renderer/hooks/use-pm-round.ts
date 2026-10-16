import { useQuery } from '@tanstack/react-query'

import { getPmRound } from '@/services/philharmonic-rounds'

export const pmRoundKeys = {
  round: (conversationId: string, roundId: string) =>
    ['pm-round', conversationId, roundId] as const
}

/** One PM round's decision trail, fetched only once `enabled` (the disclosure opened). */
export function usePmRound(
  conversationId: string,
  roundId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: pmRoundKeys.round(conversationId, roundId),
    queryFn: () => getPmRound(conversationId, roundId),
    enabled,
    // A finished round never changes.
    staleTime: Infinity
  })
}
