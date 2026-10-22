import { Learning } from '@actovia/shared/types/deep-research'
import { WebSearchResult } from '@actovia/shared/types/web-search'
import type { Model } from '@earendil-works/pi-ai'
import { z } from 'zod'

import { deepResearchSystemPrompt } from '../prompts'
import { completeSimple } from '../utils/complete'
import {
  extractTextFromCompletion,
  parseJsonFromLlmResponse
} from '../utils/llm-response-util'

const processResultSchema = z.object({
  learnings: z
    .object({
      learning: z.string().describe('The learning from the search results'),
      citations: z
        .number()
        .array()
        .describe('Record which sources are the learning referencing.'),
      image: z
        .string()
        .nullable()
        .describe(
          "Extract the most representative image URL from the search results to enhance the vividness of your learning. If the search results didn't provide proper images, return `null`"
        )
    })
    .array()
    .describe(`List of learnings`),
  followUpQuestions: z
    .array(z.string())
    .describe(`List of follow-up questions to research the topic further`)
})

export async function processSerpResult(
  {
    topic,
    query,
    searchResults,
    numLearnings = 3,
    numFollowUpQuestions = 3
  }: {
    /** The user's research topic. A query may be in the language of the place it is about. */
    topic: string
    query: string
    searchResults: WebSearchResult[]
    numLearnings?: number
    numFollowUpQuestions?: number
  },
  { model, apiKey }: { model: Model<string>; apiKey: string }
) {
  const prompt =
    `Given the following contents from a SERP search for the query <query>${query}</query>,\n` +
    `generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings,\n` +
    `but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other.\n` +
    `The learnings should be concise and to the point, as detailed and information dense as possible.\n` +
    `Make sure to include any entities like people, places, companies, products, things, etc in the learnings,\n` +
    `as well as any exact metrics, numbers, or dates.\n` +
    `The learnings will be used to research the topic further.\n` +
    `Also return up to ${numFollowUpQuestions} follow-up questions.\n` +
    // The user reads the learnings as they arrive: a query about Dutch
    // programs, searched in Dutch, gave Dutch learnings to an English question.
    `Write the learnings and follow-up questions in the language of this research topic, whatever language the query and contents are in: <topic>${topic}</topic>\n` +
    searchResults
      .map(
        ({ content, rank, title }) =>
          `<content>\n[Source: ${rank}]\n[Title: ${title}]\n${content}\n</content>`
      )
      .join('\n') +
    `\n\nRespond with a JSON object: {"learnings": [{"learning": string, "citations": [number], "image": string|null}], "followUpQuestions": [string]}`

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
  const parsed = parseJsonFromLlmResponse(text, processResultSchema, {
    learnings: [] as Learning[],
    followUpQuestions: [] as string[]
  })
  return {
    learnings: parsed.learnings,
    followUpQuestions: parsed.followUpQuestions
  }
}
