import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'

import {
  getChildIds,
  getSummaryById,
  searchSummaries
} from '../context-management/queries'
import { completeSimple } from '../utils/complete'
import { conversationTarget } from './lcm-conversation'

const lcmExpandSchema = Type.Object({
  chatId: Type.Optional(
    Type.String({
      description:
        'Only to recall from ANOTHER conversation: the conversation id the user gave you. Omit it for this conversation.'
    })
  ),
  query: Type.String({
    description:
      'The question or topic to investigate deeply in the compressed conversation history.'
  }),
  summaryIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Optional: specific summary IDs to start DAG traversal from. ' +
        'If omitted, a grep search is performed first.'
    })
  ),
  maxTokens: Type.Optional(
    Type.Number({
      description: 'Max tokens for the answer. Default: 2000.',
      minimum: 200,
      maximum: 4000
    })
  )
})

/**
 * Deep recall: walks the LCM DAG to answer a specific question.
 * This is the most expensive LCM operation; prefer lcm_grep → lcm_describe first.
 *
 * Bound into the chat tool set whenever LCM is enabled (see
 * `tool-binding-util.ts`), alongside `lcm_grep` and `lcm_describe`.
 */
export const lcmExpand = (
  model: Model<string>,
  apiKey: string,
  /** The chat the tool is bound for: what it reads unless another is named. */
  currentChatId?: string
): AgentTool<typeof lcmExpandSchema> => ({
  name: TOOL_NAMES.lcmExpand,
  label: 'LCM Deep Recall',
  description:
    'Deeply recall information from compressed conversation history by walking the LCM summary DAG. ' +
    'This is the most thorough (and expensive) recall operation. ' +
    'Use lcm_grep first, then lcm_describe, and only use this for complex recall needs. ' +
    'It reads this conversation, or another one whose id the user gave you (pass it as chatId).',
  parameters: lcmExpandSchema,
  execute: async (
    _toolCallId,
    { chatId: named, query, summaryIds: startIds, maxTokens = 2000 },
    signal
  ) => {
    if (signal?.aborted) throw new Error('Aborted')
    const target = await conversationTarget(named, currentChatId)
    if (target.problem !== undefined) {
      return {
        content: [{ type: 'text' as const, text: target.problem }],
        details: { answer: target.problem, citedIds: [] }
      }
    }
    const { chatId } = target
    // Step 1: Find relevant summaries
    let targetIds: string[] = startIds ?? []
    if (targetIds.length === 0) {
      const grepResults = await searchSummaries(chatId, query)
      targetIds = grepResults.slice(0, 5).map((r) => r.summary.id)
    }

    if (targetIds.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No relevant summaries found for this query.'
          }
        ],
        details: { answer: 'No relevant summaries found.', citedIds: [] }
      }
    }

    // Step 2: Collect context by traversing DAG
    const visited = new Set<string>()
    const contextParts: string[] = []
    const citedIds: string[] = []

    async function traverse(id: string, depth: number): Promise<void> {
      if (visited.has(id) || depth > 4) return
      visited.add(id)

      const summary = await getSummaryById(id)
      if (!summary) return

      citedIds.push(id)
      contextParts.push(
        `[${summary.kind.toUpperCase()} depth=${summary.depth} ${summary.earliestAt.toISOString()} → ${summary.latestAt.toISOString()}]\n${summary.content}`
      )

      // Traverse children (more detailed)
      const childIds = await getChildIds(id)
      for (const childId of childIds.slice(0, 3)) {
        await traverse(childId, depth + 1)
      }
    }

    for (const id of targetIds) {
      await traverse(id, 0)
    }

    // Step 3: Ask LLM to synthesize an answer
    const contextText = contextParts.join('\n\n---\n\n')
    const result = await completeSimple(
      model,
      {
        systemPrompt: `You are a memory recall engine. Given compressed conversation history, answer the user's question as accurately as possible.
Cite specific summary IDs when referencing information.
Be concise. Max ${maxTokens} tokens.`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Question: ${query}\n\nAvailable context:\n\n${contextText}`
              }
            ],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey, signal }
    )

    const answer = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim()

    const details = { answer, citedIds }
    return {
      content: [{ type: 'text' as const, text: answer }],
      details
    }
  }
})
