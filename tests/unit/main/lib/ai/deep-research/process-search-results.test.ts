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
        searchResults: []
      },
      { model: { id: 'm', provider: 'p', api: 'a' } as never, apiKey: 'k' }
    )
    const calls = completeSimple.mock.calls as unknown as [
      unknown,
      { messages: { content: { text: string }[] }[] }
    ][]
    const prompt = calls[0][1].messages[0].content[0].text
    expect(prompt).toContain(
      'in the language of this research topic, whatever language the query and contents are in: <topic>How do Dutch apartment buildings pay for heat pumps?</topic>'
    )
  })
})
