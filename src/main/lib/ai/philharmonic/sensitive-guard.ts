import { join } from 'path'

import type {
  BeforeToolCallContext,
  BeforeToolCallResult
} from '@earendil-works/pi-agent-core'

import { getGroupsDir } from '../../paths'
import {
  groupRefusedReason,
  refusedReason,
  sensitiveTarget
} from '../kernel/approval'

/**
 * The approval gate's matcher for Philharmonic's loops (the employee loop and
 * the PM coordinator), which run on `agentLoop` rather than the chat kernel.
 * A Group run has no chat window to show an approval card in — and a
 * scheduled one has nobody at all — so a call the chat would ask about is
 * refused here, with a result the model reads; Actovia's own lock/TLS secrets
 * are refused as everywhere. The Group's workspace is
 * `~/.actovia/groups/<conversationId>`.
 */
export function groupBeforeToolCall(conversationId: string) {
  const workspaceDir = join(getGroupsDir(), conversationId)
  return async ({
    toolCall,
    args
  }: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const target = await sensitiveTarget(toolCall.name, args, workspaceDir)
    if (!target) return undefined
    return {
      block: true,
      reason:
        target.kind === 'refuse'
          ? refusedReason(target.summary)
          : groupRefusedReason(target.summary)
    }
  }
}
