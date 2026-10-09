import type { Settings } from '@exodus/shared/schemas/settings-schema'
import { fetcher } from '@exodus/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'

// The presence token lets the save change the agents' CLI paths and projects
// folder; without it the server keeps the stored values.
export const updateSettings = async (payload: Settings) =>
  fetcher<void>('/api/v1/settings', {
    method: 'POST',
    body: payload,
    headers: await presenceHeaders()
  })

/**
 * `GET /api/v1/settings/secrets-status`: whether stored secrets are encrypted
 * (the system keychain is there), and which stored secrets did not decrypt and
 * read as unset until entered again — a settings path
 * (`providers.openaiApiKey`) or `mcp:<server>:<column>.<name>`.
 */
export interface SecretsStatus {
  encryption: 'on' | 'unavailable'
  needsReentry: string[]
}

export const getSecretsStatus = () =>
  fetcher<SecretsStatus>('/api/v1/settings/secrets-status')
