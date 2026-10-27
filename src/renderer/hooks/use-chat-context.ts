import { useQuery } from '@tanstack/react-query'

import { fetchChatContext } from '@/services/chat-context'

export const chatContextKeys = {
  detail: (chatId: string) => ['chat', chatId, 'context'] as const
}

/**
 * What fills a chat's context (ISSUE-235): the header's ring and the panel's
 * Context section. Refreshed when a run ends (the stream manager invalidates
 * it) and on window focus — the phone can run the chat too.
 */
export function useChatContext(chatId: string | undefined) {
  return useQuery({
    queryKey: chatContextKeys.detail(chatId ?? ''),
    queryFn: () => fetchChatContext(chatId!),
    enabled: !!chatId,
    refetchOnWindowFocus: true,
    retry: false
  })
}
