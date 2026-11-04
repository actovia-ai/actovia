import { useQuery } from '@tanstack/react-query'

import { getPlanMonitor } from '@/services/philharmonic-chat'

export const planMonitorQueryKey = ['philharmonic', 'plan-monitor'] as const

export function usePlanMonitor() {
  return useQuery({
    queryKey: planMonitorQueryKey,
    queryFn: getPlanMonitor,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true
  })
}
