import { describe, expect, it, vi } from 'vitest'

const agentLoopMock = vi.fn()
vi.mock('@earendil-works/pi-agent-core', () => ({
  agentLoop: (...args: unknown[]) => agentLoopMock(...args)
}))
vi.mock('@earendil-works/pi-ai', () => ({}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({ id: 's' })
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => []
}))
vi.mock('@main/lib/ai/utils/employee-model', () => ({
  resolveEmployeeModel: () => ({
    chatModel: { cost: { input: 1, output: 2 } },
    apiKey: 'k'
  })
}))
vi.mock('@main/lib/ai/mcp', () => ({
  getMcpTools: async () => [],
  getMcpToolsByNames: async () => []
}))
vi.mock('@main/lib/db/team-queries', () => ({ getTeamById: async () => null }))
vi.mock('@main/lib/ai/skills/skills-manager', () => ({
  getActiveSkillsContent: async () => '',
  getSkillsContentBySlugs: async () => 'SKILL-X'
}))
const updateTaskExecution = vi.fn()
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  updateTaskExecution,
  createTaskExecutionEvent: vi.fn(),
  getAgentMemories: async () => []
}))

const { runEmployeeLoop } =
  await import('@main/lib/ai/philharmonic/employee-loop')

function fakeStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    }
  }
}

describe('runEmployeeLoop', () => {
  it('leads the transcript with a system message the model is actually sent — the prompt and the tool declarations (pi 1.0)', async () => {
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runEmployeeLoop({
      agent: {
        id: 'a',
        name: 'Avery',
        skillSlugs: [],
        mcpServerNames: [],
        toolAllowList: []
      } as never,
      instructions: 'do it',
      executionId: 'e1',
      conversationId: 'c1',
      emit: vi.fn()
    })
    const [, context, config] = agentLoopMock.mock.calls[0] as [
      unknown,
      { messages: Array<Record<string, unknown>>; tools: unknown[] },
      { convertToLlm: (m: unknown[]) => unknown[] }
    ]
    const lead = context.messages[0]
    expect(lead.role).toBe('system')
    expect(typeof lead.content).toBe('string')
    expect((lead.content as string).length).toBeGreaterThan(0)
    expect(lead.toolsAdded).toBe(context.tools)
    // The loop's own filter must let it through: pi 1.0 reads the prompt and
    // the tools from here, and 0.85's filter dropped system rows.
    const kept = config.convertToLlm([
      lead,
      { role: 'user', content: 'hi', timestamp: 1 }
    ])
    expect(kept).toHaveLength(2)
    expect((kept[0] as { role: string }).role).toBe('system')
  })

  it('uses the agent skills (not a department) and captures usage', async () => {
    agentLoopMock.mockReturnValue(
      fakeStream([
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            usage: { input: 100, output: 50 }
          }
        }
      ])
    )
    const emit = vi.fn()
    const out = await runEmployeeLoop({
      agent: {
        id: 'a',
        name: 'Avery',
        skillSlugs: ['x'],
        mcpServerNames: [],
        toolAllowList: []
      } as never,
      instructions: 'do it',
      executionId: 'e1',
      conversationId: 'c1',
      emit
    })
    expect(out).toBe('done')
    // usage written to execution
    expect(updateTaskExecution).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        tokenUsage: expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50
        })
      })
    )
    // streamed a message_end conversation event
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_end', conversationId: 'c1' })
    )
  })

  it('throws on stopReason error (no silent empty message)', async () => {
    agentLoopMock.mockReturnValue(
      fakeStream([
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'boom'
          }
        }
      ])
    )
    await expect(
      runEmployeeLoop({
        agent: {
          id: 'a',
          name: 'A',
          skillSlugs: [],
          mcpServerNames: [],
          toolAllowList: []
        } as never,
        instructions: 'x',
        executionId: 'e',
        conversationId: 'c',
        emit: vi.fn()
      })
    ).rejects.toThrow('boom')
  })
})

describe('runEmployeeLoop — secrets outside Actovia', () => {
  it('refuses a sensitive call outright (no one can approve in a Group run)', async () => {
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runEmployeeLoop({
      agent: {
        id: 'a',
        name: 'A',
        skillSlugs: [],
        mcpServerNames: [],
        toolAllowList: []
      } as never,
      instructions: 'x',
      executionId: 'e',
      conversationId: 'c1',
      emit: vi.fn()
    }).catch(() => {})
    const config = agentLoopMock.mock.calls[0][2] as {
      beforeToolCall: (ctx: unknown) => Promise<unknown>
    }
    const call = (name: string, args: unknown) =>
      config.beforeToolCall({ toolCall: { id: 't', name }, args })

    await expect(call('read_file', { path: '~/.ssh/id_rsa' })).resolves.toEqual(
      {
        block: true,
        reason: 'Access to ~/.ssh/id_rsa is not available in a Group run.'
      }
    )
    await expect(
      call('terminal', { command: 'cat ~/.aws/credentials' })
    ).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining('is not available in a Group run')
    })
    // Actovia's home (a scratch ACTOVIA_HOME in tests).
    const { getActoviaHome } = await import('@main/lib/paths')
    await expect(
      call('read_file', { path: `${getActoviaHome()}/lock.dat` })
    ).resolves.toMatchObject({ reason: expect.stringContaining('is refused') })
    await expect(call('read_file', { path: '/tmp/notes.md' })).resolves.toBe(
      undefined
    )
  })
})
