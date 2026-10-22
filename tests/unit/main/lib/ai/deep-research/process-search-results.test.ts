import { describe, expect, it, vi } from 'vitest'

const completeSimple = vi.fn(async () => ({
  role: 'assistant',
  stopReason: 'stop',
  content: [
    { type: 'text', text: '{"learnings": [], "followUpQuestions": []}' }
  ]
}))

vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({ completeSimple })
}))

describe('processSerpResult', () => {
  it("asks for the learnings in the topic's language, not the query's", async () => {
    const { processSerpResult } =
      await import('@main/lib/ai/deep-research/process-search-results')
    await processSerpResult(
      {
        topic: 'How do Dutch apartment buildings pay for heat pumps?',
        query: 'collectieve warmtepomp VvE kosten per appartement',
        searchResults: [
          {
            rank: 1,
            title: 'Collectieve warmtepomp',
            link: 'https://example.nl',
            content: 'Een collectieve warmtepomp kost netto €4.000–7.000.'
          } as never
        ]
      },
      { model: { id: 'm', provider: 'p', api: 'a' } as never, apiKey: 'k' }
    )
    const calls = completeSimple.mock.calls as unknown as [
      unknown,
      { messages: { content: { text: string }[] }[] }
    ][]
    const prompt = calls[0][1].messages[0].content[0].text
    // After the contents, where the model reads it last.
    const topic = prompt.indexOf(
      'The research topic is: <topic>How do Dutch apartment buildings pay for heat pumps?</topic>'
    )
    expect(topic).toBeGreaterThan(prompt.lastIndexOf('</content>'))
    expect(prompt.slice(topic)).toContain(
      'Write every learning and follow-up question in the language of the research topic'
    )
  })
})
