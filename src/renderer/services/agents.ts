import type { AgentAnswer, CliId, CliStatus } from '@exodus/shared/types/agents'
import { fetcher } from '@exodus/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'

const BASE = '/api/v1/agents'

// Every write carries the window's presence token: the API refuses it to any
// other local process.
const post = async <T>(url: string, body?: Record<string, unknown>) =>
  fetcher<T>(url, {
    method: 'POST',
    ...(body ? { body } : {}),
    headers: await presenceHeaders()
  })

export const getClis = () => fetcher<CliStatus[]>(`${BASE}/clis`)
export const checkCli = (id: CliId) =>
  post<CliStatus>(`${BASE}/clis/${id}/check`)
export const respondToAgent = (
  sessionId: string,
  requestId: string,
  answer: AgentAnswer
) =>
  post<{ success: boolean }>(`${BASE}/sessions/${sessionId}/respond`, {
    requestId,
    answer
  })
export const interruptAgent = (sessionId: string) =>
  post<{ success: boolean }>(`${BASE}/sessions/${sessionId}/interrupt`)
export const continueInTerminal = (sessionId: string) =>
  post<{ success: boolean }>(`${BASE}/sessions/${sessionId}/terminal`)
export const openAgentFolder = (sessionId: string) =>
  post<{ success: boolean }>(`${BASE}/sessions/${sessionId}/open-folder`)
