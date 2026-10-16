import { useQuery } from '@tanstack/react-query'

import { getQuotas } from '@/services/agents'

export const agentQuotaKeys = { all: ['agent-quota'] as const }

/** What each CLI last said of the owner's quota; a run updates it, so it is re-read every minute. */
export function useAgentQuotas() {
  return useQuery({
    queryKey: agentQuotaKeys.all,
    queryFn: getQuotas,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  })
}
