import { describe, expect, it, vi } from 'vitest'

const agentLoopMock = vi.fn()
vi.mock('@earendil-works/pi-agent-core', () => ({
  agentLoop: (...args: unknown[]) => agentLoopMock(...args)
}))
vi.mock('@earendil-works/pi-ai', () => ({}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({ id: 's' })
}))
const bindCallingTools = vi.fn((): Array<{ name: string }> => [])
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  bindCallingTools: () => bindCallingTools()
}))
vi.mock('@main/lib/ai/utils/employee-model', () => ({
  resolveEmployeeModel: () => ({
    chatModel: { cost: { input: 1, output: 2 } },
    model: { cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } },
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

const getEmployeeReports = vi.fn(
  async (): Promise<Array<{ content: string; createdAt: Date }>> => []
)
vi.mock('@main/lib/db/conversation-queries', () => ({
  getEmployeeReports: (...a: unknown[]) => getEmployeeReports(...(a as []))
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
  const systemPromptFor = async (tools: string[]) => {
    bindCallingTools.mockReturnValueOnce(tools.map((name) => ({ name })))
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runEmployeeLoop({
      agent: {
        id: 'a',
        name: 'Nora',
        skillSlugs: [],
        mcpServerNames: [],
        toolAllowList: []
      } as never,
      instructions: 'research it',
      executionId: 'e1',
      conversationId: 'c1',
      emit: vi.fn()
    })
    const [, context] = agentLoopMock.mock.calls.at(-1) as [
      unknown,
      { messages: Array<{ content: string }> }
    ]
    return context.messages[0].content
  }

  it('an employee who searches cites by link, never by number — its readers never see the results', async () => {
    const { WEB_CITATIONS } =
      await import('@main/lib/ai/philharmonic/employee-loop')
    expect(await systemPromptFor(['web_search'])).toContain(WEB_CITATIONS)
    expect(await systemPromptFor(['web_fetch'])).toContain(WEB_CITATIONS)
    expect(await systemPromptFor(['read_file'])).not.toContain(WEB_CITATIONS)
  })

  it('is shown its own earlier reports in this group, oldest first — not only what the PM pastes back', async () => {
    getEmployeeReports.mockResolvedValueOnce([
      { content: 'second report', createdAt: new Date('2026-10-22T02:00:00Z') },
      { content: 'first report', createdAt: new Date('2026-10-22T01:00:00Z') }
    ])
    const prompt = await systemPromptFor([])
    expect(getEmployeeReports).toHaveBeenLastCalledWith('c1', 'a', 3)
    expect(prompt).toContain('Your earlier reports in this group')
    expect(prompt.indexOf('first report')).toBeLessThan(
      prompt.indexOf('second report')
    )
    expect(await systemPromptFor([])).not.toContain('earlier reports')
  })

  it('cuts a long earlier report and says how much', async () => {
    const { earlierReportsBlock, EARLIER_REPORTS } =
      await import('@main/lib/ai/philharmonic/employee-loop')
    const block = earlierReportsBlock([
      {
        content: 'x'.repeat(EARLIER_REPORTS.chars + 10),
        createdAt: new Date(0)
      }
    ])
    expect(block).toContain('[… cut, 10 more characters]')
    expect(block).not.toContain('x'.repeat(EARLIER_REPORTS.chars + 1))
  })

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

  it('adds up every step — its tokens, the cached input included, and its cost', async () => {
    const step = (usage: Record<string, number>) => ({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'step' }],
        usage
      }
    })
    agentLoopMock.mockReturnValue(
      fakeStream([
        step({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }),
        step({
          input: 0,
          output: 1_000_000,
          cacheRead: 2_000_000,
          cacheWrite: 0
        })
      ])
    )
    updateTaskExecution.mockClear()
    await runEmployeeLoop({
      agent: {
        id: 'a',
        name: 'Nora',
        skillSlugs: [],
        mcpServerNames: [],
        toolAllowList: []
      } as never,
      instructions: 'research it',
      executionId: 'e2',
      conversationId: 'c1',
      emit: vi.fn()
    })
    // $1 (step 1's input) + $2 (step 2's output) + $0.20 (its cache reads)
    expect(updateTaskExecution).toHaveBeenCalledWith(
      'e2',
      expect.objectContaining({
        tokenUsage: {
          inputTokens: 3_000_000,
          outputTokens: 1_000_000,
          cost: expect.closeTo(3.2, 6)
        }
      })
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
