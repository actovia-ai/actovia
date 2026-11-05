import type { WebAccessConfig } from '@actovia/shared/types/web-terminal'
import { fetcher } from '@actovia/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'

export interface WebAccessState extends WebAccessConfig {
  running: boolean
  port: number
  pairing: { code: string; expiresAt: number } | null
}
const URL = '/api/v1/web-access'
export const getWebAccess = async () =>
  fetcher<WebAccessState>(URL, { headers: await presenceHeaders() })
export const saveWebAccess = async (value: WebAccessConfig) =>
  fetcher<WebAccessState>(URL, {
    method: 'PUT',
    body: { ...value },
    headers: await presenceHeaders()
  })
export const pairWebBrowser = async () =>
  fetcher<WebAccessState>(`${URL}/pairing`, {
    method: 'POST',
    headers: await presenceHeaders()
  })
export const cancelWebPairing = async () =>
  fetcher<WebAccessState>(`${URL}/pairing`, {
    method: 'DELETE',
    headers: await presenceHeaders()
  })
