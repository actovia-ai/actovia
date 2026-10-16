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
const createTask = vi.fn(async (d) => ({ id: 't1', ...d }))
const getUpcomingOneOffTasks = vi.fn(async (): Promise<unknown[]> => [])
const updateTask = vi.fn(async (id: string, d: unknown) => ({
  id,
  ...(d as object)
}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getActiveAgents,
  createTask,
  getUpcomingOneOffTasks,
  updateTask
}))
const refreshQuotas = vi.fn(async () => {})
vi.mock('@main/lib/agents/quota-refresh', () => ({ refreshQuotas }))
// What the store holds for each test; blockedUntil / formatQuotaForPm are the real ones.
let quotaReading: unknown = null
vi.mock('@main/lib/agents/quota', async () => {
  const actual = await vi.importActual<typeof import('@main/lib/agents/quota')>(
    '@main/lib/agents/quota'
  )
  return {
    ...actual,
    getQuota: vi.fn(() => quotaReading)
  }
})
vi.mock('@main/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
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
  it('is described to the PM as a coding agent, and its step’s own message is the only one saved', async () => {
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
    vi.mocked(runDelegatedTask).mockResolvedValueOnce({
      output: '[Claude Code · done]',
      messageId: 'm-step'
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
    expect(createConversationMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: 'employee' })
    )
  })
})

describe('runPmCoordinator — the plan mirror', () => {
  it('never fails a step: a mirror that throws is logged and the delegation still succeeds', async () => {
    const plans = await import('@main/lib/db/plan-queries')
    const step = (status: string) => ({
      id: 's1',
      status,
      output: null,
      note: null,
      startedAt: null,
      completedAt: null
    })
    vi.mocked(plans.updateStep).mockImplementation(
      async (_id, patch) => step(patch.status ?? 'running') as never
    )
    vi.mocked(plans.getActivePlanByConversationId).mockResolvedValue({
      plan: { id: 'p', status: 'active' },
      steps: [step('running')]
    } as never)
    const { writePlanMirror } =
      await import('@main/lib/ai/philharmonic/plan-mirror')
    vi.mocked(writePlanMirror).mockRejectedValue(new Error('meta dir refused'))
    const { logger } = await import('@main/lib/logger')
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'go',
      emit: vi.fn()
    }).catch(() => {})
    const tools = agentLoopMock.mock.calls[0][1].messages[0]
      .toolsAdded as Array<{
      name: string
      execute: (id: string, p: unknown) => Promise<unknown>
    }>
    const delegate = tools.find((t) => t.name === 'delegateTask')!
    await expect(
      delegate.execute('x', {
        employeeId: 'a1',
        instructions: 'go',
        stepId: 's1'
      })
    ).resolves.toBeDefined()
    expect(plans.updateStep).not.toHaveBeenCalledWith('s1', {
      status: 'failed'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'philharmonic',
      'plan mirror failed',
      expect.objectContaining({ message: 'meta dir refused' })
    )
    vi.mocked(plans.getActivePlanByConversationId).mockResolvedValue(null)
  })
})

describe('runPmCoordinator — the quota in view', () => {
  type CapturedTool = {
    name: string
    description: string
    execute: (id: string, p: unknown) => Promise<unknown>
  }
  const R = Date.now() + 3 * 24 * 3_600_000
  const rejected = {
    cli: 'claude-code',
    windows: [{ name: 'seven_day', usedPercent: 100, resetsAt: R }],
    state: 'rejected',
    rejectedWindow: 'seven_day',
    overage: false,
    asOf: Date.now()
  }
  const textOf = (res: unknown) =>
    (res as { content: Array<{ text: string }> }).content
      .map((c) => c.text)
      .join('')

  async function runWith(reading: unknown) {
    quotaReading = reading
    getActiveAgents.mockResolvedValueOnce([
      {
        id: 'opus-id',
        name: 'Ada',
        description: 'Hard problems',
        isActive: true,
        runtime: 'claude-code',
        model: 'opus'
      },
      {
        id: 'plain-id',
        name: 'Ben',
        description: 'Routine work',
        isActive: true,
        runtime: 'claude-code',
        model: null
      }
    ] as never)
    const plans = await import('@main/lib/db/plan-queries')
    vi.mocked(plans.updateStep).mockReset()
    vi.mocked(plans.updateStep).mockImplementation(
      async (id, patch) =>
        ({
          id,
          title: 'Refactor the parser',
          status: patch.status ?? 'running',
          output: null,
          note: patch.note ?? null,
          startedAt: null,
          completedAt: null
        }) as never
    )
    const { runDelegatedTask } =
      await import('@main/lib/ai/philharmonic/execution-engine')
    vi.mocked(runDelegatedTask).mockClear()
    refreshQuotas.mockClear()
    createTask.mockClear()
    updateTask.mockClear()
    getUpcomingOneOffTasks.mockReset()
    getUpcomingOneOffTasks.mockResolvedValue([])
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'build it',
      emit: vi.fn()
    }).catch(() => {})
    const system = agentLoopMock.mock.calls[0][1].messages[0]
    const tools = system.toolsAdded as CapturedTool[]
    return {
      plans,
      runDelegatedTask,
      system: system.content as string,
      tool: (name: string) => tools.find((t) => t.name === name)!
    }
  }

  it('tells the PM each CLI employee’s model and its CLI’s quota, and how to deal', async () => {
    const { system } = await runWith({
      cli: 'claude-code',
      windows: [
        { name: 'five_hour', usedPercent: 5, resetsAt: Date.now() + 3_600_000 },
        { name: 'seven_day', usedPercent: 85, resetsAt: R }
      ],
      state: 'warning',
      rejectedWindow: null,
      overage: false,
      asOf: Date.now()
    })
    expect(system).toContain('model: opus')
    expect(system).toContain('model: CLI default')
    expect(system).toMatch(
      /Claude Code quota \(as of .*\): .*week 85 % \(warning\)/
    )
    expect(system).toContain('schedule flexibly')
    expect(refreshQuotas).toHaveBeenCalledWith(['claude-code'])
  })

  it('does not start an employee its CLI has rejected; tells the PM the reset', async () => {
    const { plans, runDelegatedTask, tool } = await runWith(rejected)
    const result = textOf(
      await tool('delegateTask').execute('x', {
        employeeId: 'opus-id',
        instructions: 'x',
        stepId: 's1'
      })
    )
    expect(runDelegatedTask).not.toHaveBeenCalled()
    expect(plans.updateStep).not.toHaveBeenCalledWith('s1', {
      status: 'running'
    })
    expect(result).toMatch(/quota is used up .*seven_day 100 %/)
    expect(result).toMatch(/waitForQuota/)
  })

  it('waitForQuota parks the step and schedules one wake-up, moved on a second call', async () => {
    const { plans, tool } = await runWith(rejected)
    const wait = tool('waitForQuota')
    const args = { stepId: 's1', employeeId: 'opus-id', reason: 'needs opus' }
    await wait.execute('w1', args)
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        status: 'pending',
        runAt: new Date(R + 120_000),
        input: { kind: 'quota-wait', stepId: 's1', employeeId: 'opus-id' }
      })
    )
    expect(plans.updateStep).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'pending',
        note: expect.stringContaining('waiting for')
      })
    )
    getUpcomingOneOffTasks.mockResolvedValue([
      {
        id: 't-wait',
        conversationId: 'c1',
        input: { kind: 'quota-wait', stepId: 's1', employeeId: 'opus-id' }
      }
    ])
    await wait.execute('w2', args)
    expect(updateTask).toHaveBeenCalledWith('t-wait', {
      runAt: new Date(R + 120_000)
    })
    expect(createTask).toHaveBeenCalledTimes(1)
  })

  it('waitForQuota refuses when nothing blocks the employee', async () => {
    const { tool } = await runWith({
      cli: 'claude-code',
      windows: [{ name: 'seven_day', usedPercent: 85, resetsAt: R }],
      state: 'warning',
      rejectedWindow: null,
      overage: false,
      asOf: Date.now()
    })
    const result = textOf(
      await tool('waitForQuota').execute('w', {
        stepId: 's1',
        employeeId: 'opus-id',
        reason: 'needs opus'
      })
    )
    expect(result).toMatch(/nothing blocks .* delegate/i)
    expect(createTask).not.toHaveBeenCalled()
  })
})
