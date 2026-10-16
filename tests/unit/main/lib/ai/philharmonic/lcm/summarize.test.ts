import { beforeEach, describe, expect, it, vi } from 'vitest'

const piCompleteSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({
    completeSimple: (...args: unknown[]) => piCompleteSimple(...args)
  })
}))

const { summarizeMessages } =
  await import('@main/lib/ai/philharmonic/lcm/summarize')

const ARGS = {
  messages: [
    { id: 'm1', role: 'user', content: 'Plan the launch', agentId: null }
  ],
  previousSummary: 'Earlier: the team agreed on a March date.',
  model: { id: 'm' },
  apiKey: 'k'
} as never

beforeEach(() => piCompleteSimple.mockReset())

// The caller (PhilharmonicLcm) writes the return value over the conversation's
// rolling summary. It only keeps the old one if this rejects.
describe('summarizeMessages', () => {
  it('returns the summary text', async () => {
    piCompleteSimple.mockResolvedValue({
      content: [{ type: 'text', text: '  Launch set for March; owner TBD.  ' }],
      stopReason: 'stop'
    })

    await expect(summarizeMessages(ARGS)).resolves.toBe(
      'Launch set for March; owner TBD.'
    )
  })

  it('rejects when the provider request failed (pi-ai resolves with stopReason "error")', async () => {
    piCompleteSimple.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: '429 rate limit exceeded'
    })

    await expect(summarizeMessages(ARGS)).rejects.toThrow('429')
  })

  it('rejects rather than return an empty summary', async () => {
    piCompleteSimple.mockResolvedValue({ content: [], stopReason: 'stop' })

    await expect(summarizeMessages(ARGS)).rejects.toThrow('no text')
  })
})

describe('summarizeMessages labels', () => {
  it('labels an employee by name, not by id', async () => {
    piCompleteSimple.mockResolvedValue({
      content: [{ type: 'text', text: 's' }],
      stopReason: 'stop'
    })
    await summarizeMessages({
      ...(ARGS as object),
      messages: [
        { id: 'm2', role: 'employee', content: 'Done', agentId: 'a1' }
      ],
      agents: new Map([
        ['a1', { name: 'CC', runtime: 'claude-code', model: 'opus' }]
      ])
    } as never)
    const text = JSON.stringify(piCompleteSimple.mock.calls[0])
    expect(text).toContain('- CC · Claude Code · opus: Done')
    expect(text).not.toContain('Employee a1')
  })
})
