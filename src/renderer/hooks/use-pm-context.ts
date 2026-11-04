import { useQuery } from '@tanstack/react-query'

import { getPmContext } from '@/services/philharmonic-chat'

export function usePmContext({
  conversationId,
  revision,
  enabled
}: {
  conversationId: string
  revision: number
  enabled: boolean
}) {
  return useQuery({
    queryKey: ['philharmonic', conversationId, 'context', revision],
    queryFn: () => getPmContext(conversationId),
    enabled,
    refetchOnWindowFocus: true,
    retry: false
  })
}
