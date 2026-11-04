import { useQuery } from '@tanstack/react-query'

import { getConversationProject } from '@/services/projects'

export const conversationProjectQueryKey = (conversationId: string) =>
  ['projects', 'conversation', conversationId] as const

export function useConversationProject(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: conversationProjectQueryKey(conversationId),
    queryFn: () => getConversationProject(conversationId),
    enabled
  })
}
