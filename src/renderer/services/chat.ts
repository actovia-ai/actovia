import type { ApprovalOutcome, Attempt } from '@actovia/shared/types/chat'
import type { ChatPage, ChatPageRow } from '@actovia/shared/types/chat-page'
import { fetcher } from '@actovia/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'
import type { Chat } from '@/types/db'

export const updateChat = (payload: Partial<Chat>) =>
  fetcher<void>('/api/v1/chat', { method: 'PUT', body: payload })

export const deleteChat = (id: string) =>
  fetcher<void>(`/api/v1/chat/${id}`, { method: 'DELETE' })

export type ApprovalDecision = 'allow' | 'deny'

/** The user's answer to a paused tool call. Carries the window's presence
 *  token — the API takes this answer from no other local process. */
export const decideApproval = async (payload: {
  runId: string
  toolCallId: string
  decision: ApprovalDecision
}) =>
  fetcher<{ outcome: ApprovalOutcome }>('/api/v1/chat/approval', {
    method: 'POST',
    body: payload,
    headers: await presenceHeaders()
  })

/**
 * Keep one answer of a regenerate group ("Use this one" / "Use this
 * instead"). Answers with the states of the group's runs as stored.
 */
export const chooseAttempt = (chatId: string, runId: string) =>
  fetcher<{ attempts: Record<string, Attempt> }>(
    `/api/v1/chat/${chatId}/choose`,
    { method: 'POST', body: { runId } }
  )

/**
 * A page of a chat's history (spec 2026-10-01 §C3): the newest runs, or the
 * ones before `before` (a page's `olderCursor`), reaching back through
 * `through` when given.
 */
export const fetchChatPage = (
  chatId: string,
  query: { before?: string; through?: string } = {}
) => {
  const params = new URLSearchParams()
  if (query.before) params.set('before', query.before)
  if (query.through) params.set('through', query.through)
  const qs = params.size > 0 ? `?${params}` : ''
  return fetcher<ChatPage>(`/api/v1/chat/${chatId}/page${qs}`)
}

/** One row whole: what a page's `truncated` row stands for. */
export const fetchChatRow = (chatId: string, messageId: string) =>
  fetcher<ChatPageRow>(`/api/v1/chat/${chatId}/messages/${messageId}`)

/** Every row of the chat, whole (no paging, no cut): what an export is written from. */
export const fetchChatMessages = (chatId: string) =>
  fetcher<ChatPageRow[]>(`/api/v1/chat/${chatId}`)
