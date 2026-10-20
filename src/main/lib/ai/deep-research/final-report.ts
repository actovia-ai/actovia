import { Learning } from '@actovia/shared/types/deep-research'
import type { Model } from '@earendil-works/pi-ai'

import { deepResearchSystemPrompt } from '../prompts'
import { completeSimple } from '../utils/complete'
import { extractTextFromCompletion } from '../utils/llm-response-util'

export async function writeFinalReport(
  {
    prompt,
    learnings
  }: {
    prompt: string
    learnings: Learning[]
  },
  {
    model,
    apiKey
  }: {
    model: Model<string>
    apiKey: string
  }
) {
  const learningsString = learnings
    .map(({ learning, citations, image }) => {
      const imageMarkdown = image ? `\n![](${image})` : ''
      return `<learning>\n【${citations.join(',')}-source】 ${learning}${imageMarkdown}\n</learning>`
    })
    .join('\n')

  const userPrompt =
    'Given the following prompt from the user, write a final report on the topic using the learnings from research. ' +
    'Cite every factual claim using the format 【#-source】 (single) or 【#,#-source】 (multiple) — ' +
    'place the citation immediately after the sentence it supports, not at the end of the paragraph. ' +
    'Never write raw URLs. ' +
    'When a learning includes an image URL, embed it in the report near the content it illustrates using markdown: ![description](url). ' +
    'Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research: ' +
    `\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>` +
    `\n\nRespond with a JSON object: {"report": "<markdown report text>"}`

  const result = await completeSimple(
    model,
    {
      systemPrompt: deepResearchSystemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userPrompt }],
          timestamp: Date.now()
        }
      ]
    },
    { apiKey }
  )

  const text = extractTextFromCompletion(result.content)

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    const parsed = JSON.parse(jsonMatch[0]) as { report: string }
    return parsed.report
  } catch {
    return text
  }
}
