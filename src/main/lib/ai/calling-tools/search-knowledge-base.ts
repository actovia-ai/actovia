import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
// src/main/lib/ai/calling-tools/search-knowledge-base.ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import type { LightRagClient } from '../../knowledge-base/lightrag-client'
import { logger } from '../../logger'

const schema = Type.Object({
  query: Type.String({
    description: 'What to look up in the knowledge base.'
  })
})

interface QueryConfig {
  queryMode?: 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | null
  topK?: number | null
  chunkTopK?: number | null
}

export function searchKnowledgeBase(
  client: LightRagClient,
  cfg: QueryConfig | null | undefined
): AgentTool<typeof schema> {
  return {
    name: TOOL_NAMES.searchKnowledgeBase,
    label: 'Search Knowledge Base',
    description:
      "Search the user's knowledge base for relevant context. Use before " +
      'answering questions that may be covered by the user’s own notes, ' +
      'documents, or saved company facts.',
    parameters: schema,
    execute: async (_id, { query }) => {
      try {
        const { context, references } = await client.retrieve(query, {
          mode: cfg?.queryMode ?? 'mix',
          topK: cfg?.topK ?? 60,
          chunkTopK: cfg?.chunkTopK ?? 10
        })
        const text = context.trim()
          ? context
          : `No knowledge base documents matched "${query}".`
        return {
          content: [{ type: 'text' as const, text }],
          details: { query, references }
        }
      } catch (error) {
        logger.warn('knowledge-base', 'retrieval failed', {
          query,
          error
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: 'The knowledge base is currently unavailable.'
            }
          ],
          details: { query, references: [] }
        }
      }
    }
  }
}
