import type { Attachment } from '@exodus/shared/types/chat'
import type { PlanDto } from '@exodus/shared/types/philharmonic'
import { fetcher } from '@exodus/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'
import type {
  ConversationData,
  ConversationMessageData
} from '@/stores/philharmonic'

const BASE = '/api/v1/philharmonic'

export const getConversations = () =>
  fetcher<ConversationData[]>(`${BASE}/conversations`)
export const createConversation = (data: { title: string; icon?: string }) =>
  fetcher<ConversationData>(`${BASE}/conversations`, {
    method: 'POST',
    body: data as never
  })
export const updateConversation = (
  id: string,
  data: Partial<ConversationData>
) =>
  fetcher<ConversationData>(`${BASE}/conversations/${id}`, {
    method: 'PUT',
    body: data as never
  })
export const deleteConversation = (id: string) =>
  fetcher<void>(`${BASE}/conversations/${id}`, { method: 'DELETE' })
export const getConversationMessages = (id: string) =>
  fetcher<ConversationMessageData[]>(`${BASE}/conversations/${id}/messages`)
// A group message and an answer to the PM carry the window's presence
// token: no other local process may set the group's agents to work.
export const sendConversationMessage = async (
  id: string,
  content: string,
  attachments?: Attachment[]
) =>
  fetcher<ConversationMessageData>(`${BASE}/conversations/${id}/messages`, {
    method: 'POST',
    body: {
      content,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined
    } as never,
    headers: await presenceHeaders()
  })
export const respondToConversation = async (id: string, response: string) =>
  fetcher<{ success: boolean }>(`${BASE}/conversations/${id}/respond`, {
    method: 'POST',
    body: { response } as never,
    headers: await presenceHeaders()
  })

/**
 * Abort the currently-running PM for a conversation. Idempotent — returns
 * wasRunning=false if there was nothing to stop. Fired from the Composer's
 * Stop button while the PM is busy.
 */
export const interruptConversation = (id: string) =>
  fetcher<{ success: boolean; wasRunning: boolean }>(
    `${BASE}/conversations/${id}/interrupt`,
    { method: 'POST', body: {} as never }
  )

/**
 * Pull the active execution plan for a Group. Returns `null` when no plan
 * has been laid out yet. Renderer reads this on mount and on every SSE
 * reconnect so the UI catches up with anything emitted while disconnected.
 */
export const getActivePlan = (conversationId: string) =>
  fetcher<PlanDto | null>(`${BASE}/conversations/${conversationId}/plan`)

export interface PhilharmonicCostSummary {
  totalCost: number
  totalTokens: number
  byConversation: Array<{
    conversationId: string
    cost: number
    tokens: number
  }>
  byAgent: Array<{ agentId: string; cost: number; tokens: number }>
  daily: Array<{ date: string; cost: number; tokens: number }>
}
export const getPhilharmonicCosts = () =>
  fetcher<PhilharmonicCostSummary>(`${BASE}/costs`)
