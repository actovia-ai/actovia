import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { searchMessages, searchSummaries } from '../context-management/queries'
import { conversationTarget } from './lcm-conversation'

const lcmGrepSchema = Type.Object({
  chatId: Type.Optional(
    Type.String({
      description:
        'Only to search ANOTHER conversation: the conversation id the user gave you. Omit it to search this conversation.'
    })
  ),
  pattern: Type.String({
    description:
      'Regex or literal string to search for in conversation summaries and messages.'
  }),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum number of results to return. Default: 10.',
      minimum: 1,
      maximum: 50
    })
  )
})

/**
 * `currentChatId` is the chat the tool is bound for: what it searches unless
 * the model names another conversation. Philharmonic binds it with none.
 */
export const lcmGrep = (
  currentChatId?: string
): AgentTool<typeof lcmGrepSchema> => ({
  name: TOOL_NAMES.lcmGrep,
  label: 'LCM Search',
  description:
    'Search through conversation history (LCM summaries and raw messages) for a specific pattern. ' +
    'Use this as the first step when you need to recall something from earlier in a long conversation, ' +
    'or from another conversation whose id the user gave you (pass it as chatId). ' +
    'Returns snippets with summary IDs (for lcm_describe) or message previews.',
  parameters: lcmGrepSchema,
  execute: async (
    _toolCallId,
    { chatId: named, pattern, limit = 10 },
    signal
  ) => {
    if (signal?.aborted) throw new Error('Aborted')
    const target = await conversationTarget(named, currentChatId)
    if (target.problem !== undefined) {
      return {
        content: [{ type: 'text' as const, text: target.problem }],
        details: []
      }
    }
    const { chatId } = target
    const [summaryResults, messageResults] = await Promise.all([
      searchSummaries(chatId, pattern),
      searchMessages(chatId, pattern)
    ])

    const summaryHits = summaryResults.slice(0, limit).map((r) => ({
      type: 'summary' as const,
      summaryId: r.summary.id,
      kind: r.summary.kind,
      depth: r.summary.depth,
      earliestAt: r.summary.earliestAt,
      latestAt: r.summary.latestAt,
      tokenCount: r.summary.tokenCount,
      snippet: r.snippet
    }))

    const messageHits = messageResults
      .slice(0, Math.max(0, limit - summaryHits.length))
      .map((r) => ({
        type: 'message' as const,
        messageId: r.messageId,
        role: r.role,
        createdAt: r.createdAt,
        snippet: r.snippet
      }))

    const details = [...summaryHits, ...messageHits]

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(details, null, 2) }
      ],
      details
    }
  }
})
