import { Learning } from '@actovia/shared/types/deep-research'
import type { Model } from '@earendil-works/pi-ai'
import { z } from 'zod'

import { deepResearchSystemPrompt } from '../prompts'
import { completeSimple } from '../utils/complete'
import {
  extractTextFromCompletion,
  parseJsonFromLlmResponse
} from '../utils/llm-response-util'

const queriesSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().describe('The SERP query'),
        researchGoal: z
          .string()
          .describe(
            'First talk about the goal of the research that this query is meant to accomplish, ' +
              'then go deeper into how to advance the research once the results are found, ' +
              'mention additional research directions. Be as specific as possible, especially for additional research directions. '
          )
      })
    )
    .describe(`List of SERP queries`)
})

export async function generateSerpQueries(
  {
    query,
    numQueries = 3,
    learnings
  }: {
    query: string
    numQueries?: number
    learnings?: Learning[]
  },
  { model, apiKey }: { model: Model<string>; apiKey: string }
) {
  const prompt =
    'Given the following prompt from the user, generate a list of SERP queries to research the topic.' +
    `Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. ` +
    `Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>\n\n` +
    `${
      learnings
        ? `Here are some learnings from previous research, use them to generate more specific queries:\n ${learnings
            .map((learning) => `<learning>\n${learning}\n</learning>`)
            .join('\n')}`
        : ''
    }` +
    `\n\nRespond with a JSON object: {"queries": [{"query": string, "researchGoal": string}]}`

  const result = await completeSimple(
    model,
    {
      systemPrompt: deepResearchSystemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          timestamp: Date.now()
        }
      ]
    },
    { apiKey }
  )

  const text = extractTextFromCompletion(result.content)
  const parsed = parseJsonFromLlmResponse(text, queriesSchema, {
    queries: [{ query, researchGoal: `Research about: ${query}` }]
  })
  return parsed.queries
}
