import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatMessage } from '@actovia/shared/types/chat'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { AssistantTurnSegment } from '@/components/chat/assistant-turn-segment'
import { groupIntoSegments } from '@/components/chat/messages'
import { recordApprovalRequired, useRunApprovals } from '@/hooks/use-approvals'

export const APPROVAL_EXAMPLE_COMMAND =
  'ps --format user,pid,command && sw_vers && df -h / && pmset -g batt && docker ps --format names && tailscale status && cat ~/.aws/credentials'

const segment = groupIntoSegments([
  {
    id: 'approval-answer',
    runId: 'approval-run',
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'Check the system before writing the summary.'
      },
      {
        type: 'text',
        text: 'I can check the system details. This command also touches credentials, so I need your approval before running it.'
      },
      {
        type: 'toolCall',
        id: 'approval-call',
        name: TOOL_NAMES.terminal,
        arguments: { command: APPROVAL_EXAMPLE_COMMAND }
      }
    ],
    stopReason: 'toolUse',
    timestamp: Date.now()
  } as ChatMessage
])[0]
if (segment.type !== 'assistantTurn') throw new Error('Missing fixture turn')
const turn = segment.turn

/** Real turn and approval controls; all API requests are intercepted by the spec. */
export function ApprovalsExample({ client }: { client: QueryClient }) {
  const approvals = useRunApprovals('approval-chat', turn.runId)
  useEffect(() => {
    recordApprovalRequired(client, 'approval-chat', {
      type: 'approval_required',
      runId: turn.runId,
      toolCallId: 'approval-call',
      toolName: TOOL_NAMES.terminal,
      summary: APPROVAL_EXAMPLE_COMMAND,
      expiresAt: Date.now() + 600_000
    })
  }, [client])
  return (
    <AssistantTurnSegment
      chatId="approval-chat"
      turn={turn}
      isStreaming={approvals.some((approval) => approval.state === 'pending')}
      fresh={false}
    />
  )
}
