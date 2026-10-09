import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const agentLoopMock = vi.fn()
vi.mock('@earendil-works/pi-agent-core', () => ({
  agentLoop: (...a: unknown[]) => agentLoopMock(...a)
}))
vi.mock('@earendil-works/pi-ai', () => ({
  Type: {
    Object: (o: unknown) => o,
    String: (o?: unknown) => o ?? {},
    Array: (_t: unknown, o?: unknown) => o ?? {}
  }
}))
vi.mock('@main/lib/db/queries', () => ({
  getSettings: async () => ({ id: 's' })
}))
vi.mock('@main/lib/ai/utils/chat-message-util', () => ({
  getModelFromProvider: () => ({ chatModel: {}, apiKey: 'k' })
}))
// Mock execution-engine to avoid transitive mcp/electron imports
vi.mock('@main/lib/ai/philharmonic/execution-engine', () => ({
  runDelegatedTask: vi.fn(async () => ({ output: 'delegated result' }))
}))
// Mock recruit to avoid transitive pi-ai/queries imports
vi.mock('@main/lib/ai/philharmonic/recruit', () => ({
  autoCreateEmployee: vi.fn(async () => ({ id: 'a2', name: 'Quinn' }))
}))
// No knowledge base configured in tests → the PM tool list stays KB-free.
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: vi.fn(() => null)
}))
// Notifications pull in Electron — short-circuit them.
vi.mock('@main/lib/philharmonic-notifications', () => ({
  notifyIfBackground: vi.fn()
}))
// LCM module pulls in Drizzle through queries — short-circuit so this test
// stays a unit test focused on the PM happy path.
vi.mock('@main/lib/ai/philharmonic/lcm', () => ({
  PhilharmonicLcm: class {
    async assembleContext() {
      return []
    }
    async trackAndCompact() {
      // unit test stub
      return
    }
  }
}))
// Mock ask-user-registry
vi.mock('@main/lib/ai/philharmonic/ask-user-registry', () => ({
  askUserRegistry: { wait: vi.fn(), has: vi.fn(), resolve: vi.fn() }
}))
const getActiveAgents = vi.fn(async () => [
  {
    id: 'a1',
    name: 'Avery',
    description: 'Analyst',
    isActive: true,
    runtime: 'exodus'
  }
])
const createConversationMessage = vi.fn(async (d) => ({ id: 'm', ...d }))
const getMessagesByConversationId = vi.fn(async () => [])
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getActiveAgents,
  createTask: vi.fn(async (d) => ({ id: 't1', ...d }))
}))
const updateAgentSession = vi.fn()
vi.mock('@main/lib/db/agent-session-queries', () => ({ updateAgentSession }))
vi.mock('@main/lib/db/team-queries', () => ({ getAllTeams: async () => [] }))
vi.mock('@main/lib/db/conversation-queries', () => ({
  createConversationMessage,
  getMessagesByConversationId,
  addMemberToConversation: vi.fn(async () => ({ memberAgentIds: ['a1'] })),
  getConversationById: vi.fn(async () => ({ id: 'c1', title: 'Group X' }))
}))
// Plan tables aren't touched by the smoke test (the LLM stream we feed in
// doesn't call any plan tool); these stubs short-circuit DB access.
vi.mock('@main/lib/db/plan-queries', () => ({
  appendStepToPlan: vi.fn(),
  createPlanWithSteps: vi.fn(),
  getActivePlanByConversationId: vi.fn(async () => null),
  updatePlanStatus: vi.fn(),
  updateStep: vi.fn()
}))
vi.mock('@main/lib/ai/philharmonic/plan-mirror', () => ({
  writePlanMirror: vi.fn(async () => '/tmp/plan.md')
}))

function fakeStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    }
  }
}

const { runPmCoordinator } =
  await import('@main/lib/ai/philharmonic/pm-coordinator')

describe('runPmCoordinator', () => {
  it('persists the PM final message and emits bubbles', async () => {
    agentLoopMock.mockReturnValue(
      fakeStream([
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'All done — report ready.' }],
            usage: { input: 10, output: 5 }
          }
        }
      ])
    )
    const emit = vi.fn()
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'build a report',
      emit
    })
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        role: 'pm',
        content: expect.stringContaining('report')
      })
    )
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_start', role: 'pm' })
    )
  })
})

describe('runPmCoordinator — secrets outside Exodus', () => {
  it('refuses a sensitive call outright, and the Group workspace .env is its own', async () => {
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'read my key',
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
    const { getExodusHome, getGroupsDir } = await import('@main/lib/paths')
    await expect(
      call('write_file', {
        path: `${getExodusHome()}/tls/key.pem`,
        content: 'x'
      })
    ).resolves.toMatchObject({ reason: expect.stringContaining('is refused') })
    await expect(
      call('read_file', { path: `${getGroupsDir()}/c1/.env` })
    ).resolves.toBe(undefined)
  })
})

describe('runPmCoordinator — a Claude Code employee', () => {
  it('is described to the PM as a coding agent, and its card is persisted with the message it binds its session to', async () => {
    getActiveAgents.mockResolvedValueOnce([
      {
        id: 'cc',
        name: 'Claude Code',
        description: 'Builds things',
        isActive: true,
        runtime: 'claude-code'
      }
    ])
    const { runDelegatedTask } =
      await import('@main/lib/ai/philharmonic/execution-engine')
    const card = { kind: 'agent_card', state: 'done' }
    vi.mocked(runDelegatedTask).mockResolvedValueOnce({
      output: '[Claude Code · done]',
      parts: [card],
      sessionId: 'sess-1'
    })
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    createConversationMessage.mockClear()
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'build it',
      emit: vi.fn()
    }).catch(() => {})
    const tools = agentLoopMock.mock.calls[0][1].messages[0]
      .toolsAdded as Array<{
      name: string
      description: string
      execute: (id: string, p: unknown) => Promise<unknown>
    }>
    const delegate = tools.find((t) => t.name === 'delegateTask')!
    expect(delegate.description).toContain(
      'Builds things [Coding agent — Claude Code'
    )
    expect(delegate.description).toContain(
      'UNAVAILABLE: this group has no folder'
    )
    await delegate.execute('x', { employeeId: 'cc', instructions: 'go' })
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'employee',
        content: '[Claude Code · done]',
        parts: [card]
      })
    )
    expect(updateAgentSession).toHaveBeenCalledWith('sess-1', {
      messageId: 'm'
    })
  })
})
