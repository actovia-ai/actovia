import { fetcher } from '@actovia/shared/utils/http'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { sileo } from 'sileo'

import { i18n } from '@/lib/i18n'
import { deleteChat, fetchChatPage, updateChat } from '@/services/chat'
import type { Chat } from '@/types/db'

export const historyKeys = {
  all: ['history'] as const,
  detail: (id: string) => [...historyKeys.all, 'detail', id] as const,
  page: (id: string) => [...historyKeys.all, 'page', id] as const
}

// `exact`: only the list. Every chat's messages sit under the same root, and a
// prefix match would re-GET the open chat's messages too — a 404 when it is the
// chat that was just deleted.
export const invalidateHistory = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: historyKeys.all, exact: true })

export function useChatHistory() {
  const { data, isLoading } = useQuery({
    queryKey: historyKeys.all,
    queryFn: () => fetcher<Chat[]>('/api/v1/history'),
    // actovia-ios and the CLI edit chats through the API; coming back to the
    // window is when the user would look. Off app-wide (settings autosave),
    // on for this list read.
    refetchOnWindowFocus: true
  })
  return { data, isLoading }
}

/**
 * The newest page of a chat, to open it with (spec 2026-10-01 §C3). `isFresh`
 * says it was fetched for this visit: `<Chat>` is seeded once, on mount, so a
 * copy cached by an earlier visit — without the runs sent since, with a
 * regenerate group's state as it was — must not be what seeds it.
 */
export function useChatPage(id: string | undefined) {
  const { data, isLoading, isFetchedAfterMount } = useQuery({
    queryKey: historyKeys.page(id ?? ''),
    queryFn: () => fetchChatPage(id ?? ''),
    enabled: !!id
  })
  return { data, isLoading, isFresh: isFetchedAfterMount }
}

export function useUpdateChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<Chat>) => updateChat(payload),
    meta: { errorTitle: i18n.t('errors:generic') },
    onSuccess: () => {
      void invalidateHistory(queryClient)
      sileo.success({ title: i18n.t('chat:toast.chatUpdated') })
    }
  })
}

export function useDeleteChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      chat
    }: {
      chat: Pick<Chat, 'id' | 'title'>
      currentId?: string
    }) => deleteChat(chat.id),
    meta: { errorTitle: i18n.t('errors:generic') },
    onSuccess: (_void, { chat, currentId }) => {
      void invalidateHistory(queryClient)
      if (chat.id === currentId) {
        // Hash-only navigation — an absolute `href = '/'` resolves against the
        // packaged app's `file://` origin as the filesystem root, not index.html.
        window.location.hash = '/'
      }
      sileo.success({
        title: i18n.t('chat:toast.chatDeleted'),
        description: chat.title
      })
    }
  })
}
