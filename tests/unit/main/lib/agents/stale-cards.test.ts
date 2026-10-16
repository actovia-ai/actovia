import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const stopped = [{ messageId: 'm1' }, { messageId: null }, { messageId: 'm2' }]
vi.mock('@main/lib/db/agent-session-queries', () => ({
  markLiveSessionsStopped: async () => stopped
}))
const update = vi.fn(async () => {})
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationMessageById: async (id: string) => {
    if (id === 'm2') throw new Error('boom')
    return {
      parts: [
        { kind: 'text', text: 'hi' },
        {
          kind: 'agent_card',
          state: 'blocked',
          prompts: [{ id: 'r' }],
          queued: true,
          steps: [1]
        }
      ]
    }
  },
  updateConversationMessageParts: update
}))

const { stopStaleSessions } = await import('@main/lib/agents/stale-cards')

describe('stopStaleSessions', () => {
  it("rewrites a crashed run's card as stopped, best effort", async () => {
    await stopStaleSessions()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('m1', [
      { kind: 'text', text: 'hi' },
      {
        kind: 'agent_card',
        state: 'stopped',
        prompts: [],
        queued: false,
        steps: [1]
      }
    ])
  })
})
