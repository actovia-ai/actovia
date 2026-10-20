import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { describeConversation } from '../context-management/conversation-overview'
import {
  getChildIds,
  getParentIds,
  getSourceMessageIds,
  getSummaryById
} from '../context-management/queries'
import { conversationIdOf } from './lcm-conversation'

const lcmDescribeSchema = Type.Object({
  id: Type.String({
    description:
      'A summary ID (e.g. "sum_abc123...") returned by lcm_grep: returns its full content and DAG metadata. ' +
      'Or a conversation id the user gave you (e.g. "5b30d978-ebe8-4da6-9e73-02c6fc42b771"): ' +
      'returns what that conversation was about — its summaries and its latest messages.'
  })
})

export const lcmDescribe: AgentTool<typeof lcmDescribeSchema> = {
  name: TOOL_NAMES.lcmDescribe,
  label: 'LCM Describe',
  description:
    'Retrieve the full content and metadata of a specific LCM summary by its ID. ' +
    'Use this after lcm_grep to read a full summary. ' +
    'The response includes parent/child summary IDs for DAG traversal. ' +
    'Given a conversation id instead, it returns an overview of that conversation: ' +
    'start here when the user points you at another conversation.',
  parameters: lcmDescribeSchema,
  execute: async (_toolCallId, { id }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const conversationId = conversationIdOf(id)
    if (conversationId) {
      const overview = await describeConversation(conversationId)
      if (!overview) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No conversation has the id ${conversationId}. It may have been deleted, or the id was copied incompletely.`
            }
          ],
          details: null
        }
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(overview, null, 2) }
        ],
        details: overview
      }
    }
    const summary = await getSummaryById(id)
    if (!summary) {
      return {
        content: [
          { type: 'text' as const, text: `Summary "${id}" not found.` }
        ],
        details: null
      }
    }

    const [parentIds, childIds, sourceMessageIds] = await Promise.all([
      getParentIds(id),
      getChildIds(id),
      getSourceMessageIds(id)
    ])

    const details = {
      id: summary.id,
      kind: summary.kind,
      depth: summary.depth,
      tokenCount: summary.tokenCount,
      descendantCount: summary.descendantCount,
      earliestAt: summary.earliestAt,
      latestAt: summary.latestAt,
      parentIds,
      childIds,
      sourceMessageIds,
      content: summary.content
    }

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(details, null, 2) }
      ],
      details
    }
  }
}
