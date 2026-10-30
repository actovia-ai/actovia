import { PM_SYSTEM_PROMPT } from '@main/lib/ai/philharmonic/pm-prompt'
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
    runtime: 'actovia'
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

// The round recorder (Task 2) is a spy here: the coordinator only feeds it.
const recorder = {
  roundId: 'r1',
  input: vi.fn(),
  reports: vi.fn(),
  onEvent: vi.fn(),
  error: vi.fn(),
  finish: vi.fn(async () => ({ delegations: 2, waits: 1 }))
}
const createRoundRecorder = vi.fn((_c: string, _r: string) => recorder)
vi.mock('@main/lib/ai/philharmonic/round-recorder', () => ({
  createRoundRecorder
}))
const lastRoundStartedAt = vi.fn(async (): Promise<Date | null> => null)
vi.mock('@main/lib/db/pm-round-queries', () => ({ lastRoundStartedAt }))

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
    // Saved under the id it streamed with, so the live bubble and the row
    // are one message in the transcript.
    const started = emit.mock.calls.find(
      ([e]) => e.type === 'message_start' && e.role === 'pm'
    )![0]
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pm', id: started.messageId })
    )
  })
})

describe('runPmCoordinator — secrets outside Actovia', () => {
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
    const { getActoviaHome, getGroupsDir } = await import('@main/lib/paths')
    await expect(
      call('write_file', {
        path: `${getActoviaHome()}/tls/key.pem`,
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

describe('runPmCoordinator — the group’s members', () => {
  async function delegateTool(memberAgentIds: string[]) {
    const convs = await import('@main/lib/db/conversation-queries')
    vi.mocked(convs.getConversationById).mockResolvedValueOnce({
      id: 'c1',
      title: 'Group X',
      memberAgentIds
    } as never)
    vi.mocked(convs.addMemberToConversation).mockClear()
    const emit = vi.fn()
    agentLoopMock.mockReset()
    agentLoopMock.mockReturnValue(fakeStream([]))
    await runPmCoordinator({ conversationId: 'c1', userText: 'go', emit })
    const tools = agentLoopMock.mock.calls[0][1].messages[0]
      .toolsAdded as Array<{
      name: string
      execute: (id: string, p: unknown) => Promise<unknown>
    }>
    return {
      delegate: tools.find((t) => t.name === 'delegateTask')!,
      add: vi.mocked(convs.addMemberToConversation),
      emit
    }
  }
  const joined = (emit: ReturnType<typeof vi.fn>) =>
    emit.mock.calls.filter(([e]) => e.type === 'member_joined')

  it('an employee handed a step joins the group, once', async () => {
    const { delegate, add, emit } = await delegateTool([])
    await delegate.execute('x', { employeeId: 'a1', instructions: 'one' })
    await delegate.execute('y', { employeeId: 'a1', instructions: 'two' })
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('c1', 'a1')
    expect(joined(emit)).toEqual([
      [{ type: 'member_joined', conversationId: 'c1', agentId: 'a1' }]
    ])
  })

  it('an employee’s report is saved under the id its bubble streamed with', async () => {
    const engine = await import('@main/lib/ai/philharmonic/execution-engine')
    vi.mocked(engine.runDelegatedTask).mockResolvedValueOnce({
      output: 'the report',
      liveMessageId: 'live-1'
    })
    createConversationMessage.mockClear()
    const { delegate } = await delegateTool(['a1'])
    await delegate.execute('x', { employeeId: 'a1', instructions: 'one' })
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'live-1',
        role: 'employee',
        content: 'the report'
      })
    )
  })

  it('a member already in the group is not added again', async () => {
    const { delegate, add, emit } = await delegateTool(['a1'])
    await delegate.execute('x', { employeeId: 'a1', instructions: 'one' })
    expect(add).not.toHaveBeenCalled()
    expect(joined(emit)).toEqual([])
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

  it('plan tools called in parallel write the mirror one at a time', async () => {
    const plans = await import('@main/lib/db/plan-queries')
    vi.mocked(plans.updateStep).mockImplementation(
      async (id, patch) =>
        ({ id, status: patch.status ?? 'running', note: null }) as never
    )
    vi.mocked(plans.getActivePlanByConversationId).mockResolvedValue({
      plan: { id: 'p', status: 'active' },
      steps: []
    } as never)
    const { writePlanMirror } =
      await import('@main/lib/ai/philharmonic/plan-mirror')
    let inFlight = 0
    let most = 0
    vi.mocked(writePlanMirror).mockImplementation(async () => {
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return '/tmp/plan.md'
    })
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
    const update = tools.find((t) => t.name === 'updatePlanStep')!
    await Promise.all([
      update.execute('x', { stepId: 's1', status: 'running' }),
      update.execute('y', { stepId: 's2', status: 'done' })
    ])
    expect(vi.mocked(writePlanMirror)).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
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

  const activePlan = {
    plan: { id: 'p1', status: 'active', summary: 'Ship the parser' },
    steps: [
      {
        id: 's1',
        ordinal: 1,
        title: 'Refactor the parser',
        status: 'pending',
        assignedAgentId: 'opus-id',
        note: "waiting for Ada's week quota — needs opus"
      },
      {
        id: 's2',
        ordinal: 2,
        title: 'Fix the docs',
        status: 'done',
        assignedAgentId: null,
        note: null
      }
    ]
  }

  async function runWith(reading: unknown, plan: unknown = activePlan) {
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
    vi.mocked(plans.getActivePlanByConversationId).mockReset()
    vi.mocked(plans.getActivePlanByConversationId).mockResolvedValue(
      plan as never
    )
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
    expect(result).toMatch(/quota is used up .*week 100 %/)
    expect(result).toMatch(/waitForQuota/)
    expect(result).toContain(
      'If you had marked the step running, set it back to pending, or call waitForQuota.'
    )
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

  it('waitForQuota refuses a step that is not in the active plan', async () => {
    const { plans, tool } = await runWith(rejected)
    const result = textOf(
      await tool('waitForQuota').execute('w', {
        stepId: 'nope',
        employeeId: 'opus-id',
        reason: 'needs opus'
      })
    )
    expect(result).toBe("Refused: no step nope in this group's active plan.")
    expect(createTask).not.toHaveBeenCalled()
    expect(plans.updateStep).not.toHaveBeenCalled()
  })

  it('waitForQuota schedules the wake-up before it parks the step', async () => {
    const { plans, tool } = await runWith(rejected)
    createTask.mockRejectedValueOnce(new Error('db down'))
    await expect(
      tool('waitForQuota').execute('w', {
        stepId: 's1',
        employeeId: 'opus-id',
        reason: 'needs opus'
      })
    ).rejects.toThrow('db down')
    expect(plans.updateStep).not.toHaveBeenCalled()
  })

  it('shows the PM the active plan’s steps, so a wake-up round continues it', async () => {
    const { system } = await runWith(rejected)
    expect(system).toContain('Active plan: Ship the parser')
    expect(system).toContain(
      "- [pending] step 1 (id: s1): Refactor the parser — assigned: Ada — note: waiting for Ada's week quota — needs opus"
    )
    expect(system).toContain(
      '- [done] step 2 (id: s2): Fix the docs — assigned: unassigned'
    )
    expect(system).toContain(
      "Exception: while a plan is active and this message continues it — a [Scheduled] 'Quota reset' round, or the owner answering about the plan in flight — do not call createPlan; continue the active plan with updatePlanStep and delegateTask."
    )
  })

  it('shows no plan block when no plan is active', async () => {
    const { system } = await runWith(rejected, null)
    expect(system).not.toContain('Active plan:')
    expect(system).not.toMatch(/\(id: s1\)/)
    const plans = await import('@main/lib/db/plan-queries')
    vi.mocked(plans.getActivePlanByConversationId).mockResolvedValue(null)
  })

  it('tells the PM to wait only on LIMIT REACHED, and to run or downgrade at 90 %', async () => {
    const { system } = await runWith(rejected)
    expect(system).toContain(
      "When a skilled hand's window says LIMIT REACHED, it cannot run: downgrade the step to an ordinary hand if one can do it well; otherwise call waitForQuota for it. At 90 % or more, or marked warning, it can still run: downgrade the step if an ordinary hand can do it well, else run it — never wait for it."
    )
  })

  it('a step that leaves pending cancels its quota wake-up; a pending one keeps it', async () => {
    const wakeUp = {
      id: 't-wait',
      conversationId: 'c1',
      input: { kind: 'quota-wait', stepId: 's1', employeeId: 'opus-id' }
    }
    const other = {
      id: 't-other',
      conversationId: 'c2',
      input: { kind: 'quota-wait', stepId: 's1', employeeId: 'opus-id' }
    }
    const { tool } = await runWith(rejected)
    getUpcomingOneOffTasks.mockResolvedValue([wakeUp, other])
    await tool('updatePlanStep').execute('u0', {
      stepId: 's1',
      status: 'pending',
      note: 'still waiting'
    })
    expect(updateTask).not.toHaveBeenCalled()
    await tool('updatePlanStep').execute('u1', {
      stepId: 's1',
      status: 'skipped'
    })
    expect(updateTask).toHaveBeenCalledWith('t-wait', { status: 'cancelled' })
    expect(updateTask).not.toHaveBeenCalledWith('t-other', expect.anything())
  })

  it('delegating a waiting step cancels its quota wake-up', async () => {
    const { tool } = await runWith({
      cli: 'claude-code',
      windows: [{ name: 'seven_day', usedPercent: 50, resetsAt: R }],
      state: 'ok',
      rejectedWindow: null,
      overage: false,
      asOf: Date.now()
    })
    getUpcomingOneOffTasks.mockResolvedValue([
      {
        id: 't-wait',
        conversationId: 'c1',
        input: { kind: 'quota-wait', stepId: 's1', employeeId: 'opus-id' }
      }
    ])
    await tool('delegateTask').execute('d', {
      employeeId: 'plain-id',
      instructions: 'do it',
      stepId: 's1'
    })
    expect(updateTask).toHaveBeenCalledWith('t-wait', { status: 'cancelled' })
  })

  it('a quota store that throws leaves every CLI line unknown and is logged', async () => {
    const quota = await import('@main/lib/agents/quota')
    const { logger } = await import('@main/lib/logger')
    vi.mocked(quota.getQuota).mockImplementationOnce(() => {
      throw new Error('store broken')
    })
    const { system } = await runWith(rejected)
    expect(system).toContain(
      'Claude Code quota: unknown (it has not reported any).'
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'philharmonic',
      'quota lines not built',
      expect.objectContaining({ error: expect.any(Error) })
    )
  })
})

describe('runPmCoordinator — the decision trail', () => {
  const reset = () => {
    agentLoopMock.mockReset()
    createConversationMessage.mockClear()
    getMessagesByConversationId.mockReset()
    getMessagesByConversationId.mockResolvedValue([])
    lastRoundStartedAt.mockReset()
    lastRoundStartedAt.mockResolvedValue(null)
    for (const f of [
      recorder.input,
      recorder.reports,
      recorder.onEvent,
      recorder.error,
      recorder.finish,
      createRoundRecorder
    ])
      f.mockClear()
  }
  const endEvent = {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'All done.' }],
      usage: { input: 1, output: 1 }
    }
  }

  it('records the input, every loop event in order, and the PM row carries the round id and its counts', async () => {
    reset()
    const events = [
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Al' }] }
      },
      endEvent
    ]
    agentLoopMock.mockReturnValue(fakeStream(events))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'build a report',
      emit: vi.fn()
    })
    expect(createRoundRecorder).toHaveBeenCalledWith('c1', expect.any(String))
    expect(recorder.input).toHaveBeenCalledWith('user', 'build a report')
    expect(recorder.onEvent.mock.calls.map((c) => c[0])).toEqual(events)
    expect(recorder.finish).toHaveBeenCalledTimes(1)
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'pm',
        roundId: 'r1',
        parts: [{ kind: 'decision', delegations: 2, waits: 1 }]
      })
    )
  })

  it('a scheduled round says so', async () => {
    reset()
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'Daily report',
      trigger: 'scheduled',
      emit: vi.fn()
    })
    expect(recorder.input).toHaveBeenCalledWith('scheduled', 'Daily report')
  })

  it('records the reports since the last round began — reading that before the new input', async () => {
    reset()
    const since = new Date('2026-10-17T10:00:00Z')
    lastRoundStartedAt.mockImplementation(() => {
      expect(recorder.input).not.toHaveBeenCalled()
      return Promise.resolve(since)
    })
    getMessagesByConversationId.mockResolvedValue([
      {
        id: 'old',
        role: 'employee',
        agentId: 'a1',
        createdAt: new Date('2026-10-17T09:00:00Z')
      },
      {
        id: 'new',
        role: 'employee',
        agentId: 'a1',
        createdAt: new Date('2026-10-17T11:00:00Z')
      },
      {
        id: 'gone',
        role: 'employee',
        agentId: 'zz',
        createdAt: new Date('2026-10-17T11:30:00Z')
      },
      {
        id: 'pm',
        role: 'pm',
        agentId: null,
        createdAt: new Date('2026-10-17T11:40:00Z')
      }
    ] as never)
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'go on',
      emit: vi.fn()
    })
    expect(lastRoundStartedAt).toHaveBeenCalledWith('c1')
    expect(recorder.reports).toHaveBeenCalledWith([
      { messageId: 'new', agentId: 'a1', name: 'Avery' },
      { messageId: 'gone', agentId: 'zz', name: 'former employee' }
    ])
  })

  it('a group older than the trail reads only the reports after its newest PM message', async () => {
    reset()
    getMessagesByConversationId.mockResolvedValue([
      {
        id: 'e1',
        role: 'employee',
        agentId: 'a1',
        createdAt: new Date('2026-10-01T09:00:00Z')
      },
      {
        id: 'p1',
        role: 'pm',
        agentId: null,
        createdAt: new Date('2026-10-01T10:00:00Z')
      },
      {
        id: 'e2',
        role: 'employee',
        agentId: 'a1',
        createdAt: new Date('2026-10-01T11:00:00Z')
      }
    ] as never)
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'go on',
      emit: vi.fn()
    })
    expect(recorder.reports).toHaveBeenCalledWith([
      { messageId: 'e2', agentId: 'a1', name: 'Avery' }
    ])
  })

  it('a group whose PM never spoke reads every report', async () => {
    reset()
    getMessagesByConversationId.mockResolvedValue([
      {
        id: 'e1',
        role: 'employee',
        agentId: 'a1',
        createdAt: new Date('2026-10-01T09:00:00Z')
      }
    ] as never)
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'go on',
      emit: vi.fn()
    })
    expect(recorder.reports).toHaveBeenCalledWith([
      { messageId: 'e1', agentId: 'a1', name: 'Avery' }
    ])
  })

  it('a trail read that fails still runs the round and records its input', async () => {
    reset()
    lastRoundStartedAt.mockRejectedValueOnce(new Error('db down'))
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'carry on',
      emit: vi.fn()
    })
    expect(recorder.input).toHaveBeenCalledWith('user', 'carry on')
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pm', content: 'All done.' })
    )
  })

  it('a provider error is recorded, the round finished, and the error row carries the round id', async () => {
    reset()
    agentLoopMock.mockReturnValue(
      fakeStream([
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'rate limited'
          }
        }
      ])
    )
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'x',
      emit: vi.fn()
    })
    expect(recorder.error).toHaveBeenCalledWith('rate limited', false)
    expect(recorder.finish).toHaveBeenCalledTimes(1)
    expect(recorder.error.mock.invocationCallOrder[0]).toBeLessThan(
      recorder.finish.mock.invocationCallOrder[0]
    )
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: '⚠️ PM error: rate limited',
        roundId: 'r1',
        parts: [{ kind: 'decision', delegations: 2, waits: 1 }]
      })
    )
    const { logger } = await import('@main/lib/logger')
    expect(logger.error).toHaveBeenCalledWith(
      'philharmonic',
      'PM round failed',
      expect.objectContaining({
        conversationId: 'c1',
        roundId: 'r1',
        error: expect.objectContaining({ message: 'rate limited' })
      })
    )
  })

  it('an abort is recorded as aborted, and the interrupted row carries the round id', async () => {
    reset()
    const ctl = new AbortController()
    ctl.abort()
    agentLoopMock.mockReturnValue({
      // oxlint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }
    })
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'x',
      emit: vi.fn(),
      signal: ctl.signal
    })
    expect(recorder.error).toHaveBeenCalledWith('aborted', true)
    expect(recorder.finish).toHaveBeenCalledTimes(1)
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: '⚠️ PM run was interrupted by the user.',
        roundId: 'r1',
        parts: [{ kind: 'decision', delegations: 2, waits: 1 }]
      })
    )
  })

  it('a recorder that throws never fails the round', async () => {
    reset()
    recorder.input.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    getMessagesByConversationId.mockRejectedValueOnce(new Error('db down'))
    agentLoopMock.mockReturnValue(fakeStream([endEvent]))
    await runPmCoordinator({
      conversationId: 'c1',
      userText: 'x',
      emit: vi.fn()
    })
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pm', content: 'All done.' })
    )
  })
})

describe('PM_SYSTEM_PROMPT', () => {
  it('names the escalation tool the PM actually receives', () => {
    expect(PM_SYSTEM_PROMPT).toContain('escalateToUser')
    expect(PM_SYSTEM_PROMPT).not.toContain('askUser')
  })
})
