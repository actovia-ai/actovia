import type { AgentCard } from '@exodus/shared/types/agents'

import { markLiveSessionsStopped } from '../db/agent-session-queries'
import {
  getConversationMessageById,
  updateConversationMessageParts
} from '../db/conversation-queries'
import { logger } from '../logger'
import { sweepResumeScripts } from './terminal'

/**
 * At start: sessions a crash left `working`/`blocked` are stopped, and the
 * cards persisted with their messages say so too (best effort, never blocks).
 */
export async function stopStaleSessions(): Promise<void> {
  await sweepResumeScripts().catch(() => {})
  const rows = await markLiveSessionsStopped()
  for (const row of rows) {
    if (!row.messageId) continue
    try {
      const message = await getConversationMessageById(row.messageId)
      const parts = (message?.parts ?? []) as Array<Record<string, unknown>>
      const index = parts.findIndex((p) => p.kind === 'agent_card')
      if (index === -1) continue
      const next = [...parts]
      next[index] = {
        ...(parts[index] as unknown as AgentCard),
        state: 'stopped',
        prompts: [],
        queued: false
      }
      await updateConversationMessageParts(row.messageId, next)
    } catch (error) {
      logger.error('app', 'Failed to mark a stale agent card stopped', {
        error
      })
    }
  }
}
