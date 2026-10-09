// tests/unit/main/lib/agents/run-agent-employee.test.ts
import type { AgentEvent, AgentRun, StartInput } from '@main/lib/agents/driver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateTask = vi.fn()
const notify = vi.fn()
const updateParts = vi.fn(async () => {})
const updateContent = vi.fn(async () => {})
const createMessage = vi.fn(async (d: Record<string, unknown>) => ({ ...d }))
const emitToConversation = vi.fn()
const prepareWorkDir = vi.fn(
  async (_p: unknown, id: string, othersRunning: boolean) =>
    othersRunning
      ? {
          cwd: `/x/notes/.exodus/worktrees/${id}`,
          branch: `exodus/${id}`,
          note: null
        }
      : { cwd: '/x/notes', branch: 'main', note: null }
)
const sessions = new Map<string, Record<string, unknown>>()
let resumable: Record<string, unknown> | undefined
let sessionSeq = 0

vi.mock('@main/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({ updateTask }))
vi.mock('@main/lib/philharmonic-notifications', () => ({
  notifyIfBackground: notify
}))
vi.mock('@main/lib/i18n', () => ({
  mainT: (_k: string, d: string, v?: Record<string, string>) =>
    d.replace('{{name}}', v?.name ?? '')
}))
vi.mock('@main/lib/server/routes/philharmonic-sse', () => ({
  emitToConversation
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  getConversationById: async (id: string) =>
    id === 'no-folder' ? { id, projectId: null } : { id, projectId: 'p1' },
  createConversationMessage: createMessage,
  updateConversationMessageParts: updateParts,
  updateConversationMessageContent: updateContent
}))
vi.mock('@main/lib/db/project-queries', () => ({
  getProjectById: async () => ({
    id: 'p1',
    name: 'notes',
    dir: '/x/notes',
    workDir: '/x/notes',
    useWorktrees: true
  })
}))
vi.mock('@main/lib/db/agent-session-queries', () => ({
  findResumableSession: async () => resumable,
  createAgentSession: async (d: Record<string, unknown>) => {
    const row = { ...d, id: d.id ?? `sess-${++sessionSeq}` }
    sessions.set(row.id as string, row)
    return { ...row }
  },
  updateAgentSession: async (id: string, d: Record<string, unknown>) => {
    if (!sessions.has(id)) sessions.set(id, { id })
    return { ...Object.assign(sessions.get(id)!, d) }
  },
  getAgentSession: async (id: string) => sessions.get(id)
}))
vi.mock('@main/lib/agents/projects', () => ({
  prepareWorkDir,
  sessionLogPath: (_p: unknown, id: string) =>
    `/x/notes/.exodus/logs/${id}.jsonl`,
  writeSessionMeta: async () => {}
}))
vi.mock('@main/lib/agents/meta-files', () => ({
  assertMetaDir: async () => '/x/notes/.exodus/logs'
}))
vi.mock('@main/lib/agents/settings', () => ({
  agentSettings: async () => ({
    worktrees: true,
    maxRunning: 2,
    keepAliveMinutes: 10
  })
}))
vi.mock('@main/lib/agents/cli-check', () => ({ getCliStatus: vi.fn() }))
vi.mock('@main/lib/agents/login-shell', () => ({ loginShellEnv: vi.fn() }))

const { AgentRegistry } = await import('@main/lib/agents/registry')
const { runAgentEmployee, formatAgentOutput } =
  await import('@main/lib/agents/run-agent-employee')

interface FakeRun {
  cliSessionId: string | null
  alive: boolean
  busy: boolean
  sent: string[]
  interrupted: number
  on(l: (e: AgentEvent) => void): () => void
  send(text: string): boolean
  respond(): boolean
  interrupt(): boolean
  stop(): Promise<void>
  fire(e: AgentEvent): void
}
function makeRun(script: (run: FakeRun) => void): FakeRun {
  const listeners = new Set<(e: AgentEvent) => void>()
  const run: FakeRun = {
    cliSessionId: null as string | null,
    alive: true,
    busy: false,
    sent: [] as string[],
    interrupted: 0,
    on(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    send(text) {
      run.sent.push(text)
      run.busy = true
      queueMicrotask(() => script(run))
      return true
    },
    respond: () => true,
    interrupt() {
      run.interrupted++
      queueMicrotask(() =>
        run.fire({
          type: 'turn_end',
          ok: false,
          interrupted: true,
          text: '',
          costUsd: null,
          denials: 0
        })
      )
      return true
    },
    async stop() {
      run.alive = false
    },
    fire(e: AgentEvent) {
      if (e.type === 'init') run.cliSessionId = e.cliSessionId
      if (e.type === 'turn_end') run.busy = false
      for (const l of Array.from(listeners)) l(e)
    }
  }
  return run
}

const agent = {
  id: 'a1',
  name: 'Claude Code',
  systemPrompt: 'You review.',
  model: 'opus',
  permissionMode: null,
  runtime: 'claude-code'
} as never
const ready = async () =>
  ({
    id: 'claude-code',
    state: 'ready',
    path: '/bin/claude',
    version: '2.1.294',
    authMethod: 'claude.ai',
    detail: null,
    checkedAt: 0
  }) as never

function deps(run: ReturnType<typeof makeRun>, starts: StartInput[] = []) {
  return {
    start: (input: StartInput) => {
      starts.push(input)
      return run as unknown as AgentRun
    },
    registry: new AgentRegistry({
      maxRunning: async () => 2,
      keepAliveMs: async () => 60_000
    }),
    cliStatus: ready,
    env: async () => ({ PATH: '/bin' })
  }
}

const args = (over: Record<string, unknown> = {}) => ({
  agent,
  instructions: 'x',
  taskId: 't',
  conversationId: 'c',
  emit: vi.fn(),
  ...over
})

beforeEach(() => {
  sessions.clear()
  sessionSeq = 0
  resumable = undefined
  updateTask.mockClear()
  notify.mockClear()
  updateParts.mockClear()
  updateContent.mockClear()
  createMessage.mockClear()
  emitToConversation.mockClear()
  prepareWorkDir.mockClear()
})

const happy = (run: FakeRun) => {
  run.fire({ type: 'init', cliSessionId: 'cli-1', model: 'opus' })
  run.fire({
    type: 'step_start',
    id: 't1',
    tool: 'Write',
    summary: 'index.html'
  })
  run.fire({ type: 'step_end', id: 't1', isError: false })
  run.fire({ type: 'text', text: 'Built it.' })
  run.fire({
    type: 'turn_end',
    ok: true,
    interrupted: false,
    text: 'Built it.',
    costUsd: 0.02,
    denials: 0
  })
}

describe('runAgentEmployee', () => {
  it('refuses a group without a folder', async () => {
    await expect(
      runAgentEmployee(
        args({ conversationId: 'no-folder' }),
        deps(makeRun(happy))
      )
    ).rejects.toThrow(/no folder/)
  })

  it('refuses when Claude Code is not ready, with its state', async () => {
    const d = {
      ...deps(makeRun(happy)),
      cliStatus: async () =>
        ({ state: 'logged_out', detail: 'run claude' }) as never
    }
    await expect(runAgentEmployee(args(), d)).rejects.toThrow(/logged_out/)
  })

  it('runs a step: the instructions after the employee’s own, a card streamed, the PM told what happened', async () => {
    const run = makeRun(happy)
    const emit = vi.fn()
    const starts: StartInput[] = []
    const out = await runAgentEmployee(
      args({ instructions: 'Build a page', emit }),
      deps(run, starts)
    )
    expect(run.sent).toEqual(['You review.\n\nBuild a page'])
    expect(starts[0]).toMatchObject({
      binPath: '/bin/claude',
      cwd: '/x/notes',
      env: { PATH: '/bin' },
      model: 'opus',
      permissionMode: 'default',
      resume: null
    })
    expect(starts[0].logPath).toMatch(/\.exodus\/logs\/.+\.jsonl$/)
    const types = emit.mock.calls.map((c) => c[0].type)
    expect(types[0]).toBe('message_start')
    expect(types).toContain('agent_card')
    expect(types.at(-1)).toBe('message_end')
    const sessionId = [...sessions.keys()][0]
    expect(out.output).toBe(
      `[Claude Code · done]\nBuilt it.\nFiles changed: index.html\nSession: ${sessionId}`
    )
    // One message, saved as the step began under the live events' id, kept current.
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: out.messageId,
        conversationId: 'c',
        role: 'employee',
        agentId: 'a1',
        taskId: 't',
        parts: [expect.objectContaining({ kind: 'agent_card', queued: true })]
      })
    )
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: 'message_start',
      messageId: out.messageId
    })
    expect(updateParts.mock.calls.at(-1)).toEqual([
      out.messageId,
      [expect.objectContaining({ kind: 'agent_card', state: 'done' })]
    ])
    expect(updateContent).toHaveBeenCalledWith(out.messageId, out.output)
    expect(sessions.get(sessionId)).toMatchObject({
      messageId: out.messageId,
      cliSessionId: 'cli-1',
      state: 'done',
      projectId: 'p1',
      agentId: 'a1',
      runtime: 'claude-code'
    })
  })

  it('resumes the employee’s last session in its own folder', async () => {
    resumable = {
      id: 'sess-old',
      cliSessionId: 'cli-old',
      cwd: '/x/notes/.exodus/worktrees/w',
      branch: 'exodus/w'
    }
    sessions.set('sess-old', { ...resumable })
    const starts: StartInput[] = []
    const out = await runAgentEmployee(
      args({ instructions: 'Add tests' }),
      deps(makeRun(happy), starts)
    )
    expect(starts[0]).toMatchObject({
      resume: 'cli-old',
      cwd: '/x/notes/.exodus/worktrees/w'
    })
    expect(prepareWorkDir).not.toHaveBeenCalled()
    expect(sessions.get('sess-old')?.messageId).toBe(out.messageId)
  })

  it('reuses the employee’s live process for its next step', async () => {
    const run = makeRun(happy)
    const starts: StartInput[] = []
    const d = deps(run, starts)
    const first = await runAgentEmployee(args(), d)
    const sessionId = [...sessions.keys()][0]
    resumable = sessions.get(sessionId)
    const second = await runAgentEmployee(args({ instructions: 'again' }), d)
    expect(starts).toHaveLength(1)
    expect(run.sent).toHaveLength(2)
    // The session points at the step it runs now, never the one before.
    expect(second.messageId).not.toBe(first.messageId)
    expect(sessions.get(sessionId)?.messageId).toBe(second.messageId)
  })

  it('waits for the owner: the task is waiting, a notification goes out, and work resumes on the answer', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.fire({
        type: 'blocked',
        prompt: {
          kind: 'permission',
          requestId: 'q1',
          tool: 'Bash',
          summary: 'npm install',
          detail: 'npm install --save-dev vitest'
        }
      })
      setTimeout(() => {
        r.fire({ type: 'answered', requestId: 'q1' })
        r.fire({
          type: 'turn_end',
          ok: true,
          interrupted: false,
          text: 'ok',
          costUsd: null,
          denials: 0
        })
      }, 5)
    })
    await runAgentEmployee(args({ taskId: 'task-9' }), deps(run))
    expect(updateTask).toHaveBeenCalledWith('task-9', {
      status: 'waiting_for_user'
    })
    expect(updateTask).toHaveBeenCalledWith('task-9', { status: 'running' })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Claude Code is waiting for you',
        body: 'npm install'
      })
    )
  })

  it('interrupts when the group is stopped, and reports it stopped', async () => {
    const run = makeRun((r) =>
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
    )
    const ctrl = new AbortController()
    const pending = runAgentEmployee(args({ signal: ctrl.signal }), deps(run))
    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()
    const out = await pending
    expect(run.interrupted).toBe(1)
    expect(out.output.startsWith('[Claude Code · stopped]')).toBe(true)
  })

  it('fails the step when the process dies mid-turn', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.alive = false
      r.fire({ type: 'exit', code: 1, stderrTail: 'boom', expected: false })
    })
    const emit = vi.fn()
    await expect(runAgentEmployee(args({ emit }), deps(run))).rejects.toThrow(
      'boom'
    )
    expect([...sessions.values()][0]).toMatchObject({ state: 'error' })
    expect(emit.mock.calls.at(-1)?.[0].type).toBe('message_end')
  })

  it('keeps the persisted card current through an unprompted turn after the step', async () => {
    const run = makeRun(happy)
    const out = await runAgentEmployee(args(), deps(run))
    run.fire({ type: 'text', text: 'The background job finished.' })
    run.fire({
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: '',
      costUsd: null,
      denials: 0
    })
    await vi.waitFor(() =>
      expect(emitToConversation).toHaveBeenCalledWith(
        'c',
        expect.objectContaining({
          type: 'agent_card',
          messageId: out.messageId,
          card: expect.objectContaining({
            blocks: ['Built it.', 'The background job finished.']
          })
        })
      )
    )
    await vi.waitFor(() =>
      expect(updateParts).toHaveBeenLastCalledWith(out.messageId, [
        expect.objectContaining({
          blocks: ['Built it.', 'The background job finished.']
        })
      ])
    )
  })

  it('lets a reused process finish its unprompted turn before the next step speaks', async () => {
    const reply = (r: FakeRun) => {
      r.fire({ type: 'text', text: `Reply ${r.sent.length}` })
      r.fire({
        type: 'turn_end',
        ok: true,
        interrupted: false,
        text: '',
        costUsd: null,
        denials: 0
      })
    }
    const run = makeRun(reply)
    const d = deps(run)
    const first = await runAgentEmployee(args(), d)
    resumable = sessions.get([...sessions.keys()][0])
    // An unprompted turn begins…
    run.busy = true
    run.fire({ type: 'text', text: 'The background job finished.' })
    const second = runAgentEmployee(args({ instructions: 'next' }), d)
    await new Promise((r) => setTimeout(r, 5))
    expect(run.sent).toHaveLength(1)
    // …and ends: only then does the next step send.
    run.fire({
      type: 'turn_end',
      ok: true,
      interrupted: false,
      text: '',
      costUsd: null,
      denials: 0
    })
    const out = await second
    expect(run.sent).toHaveLength(2)
    expect(out.output).toContain('Reply 2')
    expect(out.output).not.toContain('background')
    await vi.waitFor(() =>
      expect(updateParts).toHaveBeenCalledWith(first.messageId, [
        expect.objectContaining({
          blocks: ['Reply 1', 'The background job finished.']
        })
      ])
    )
    // …and the next step's card never took the unprompted turn's text.
    expect(updateParts).not.toHaveBeenCalledWith(out.messageId, [
      expect.objectContaining({
        blocks: expect.arrayContaining(['The background job finished.'])
      })
    ])
  })

  it('starts afresh, resuming, when the busy process exits instead', async () => {
    const runs = [makeRun(happy), makeRun(happy)]
    const starts: StartInput[] = []
    const d = {
      ...deps(runs[0]),
      start: (input: StartInput) => {
        starts.push(input)
        return runs[starts.length - 1] as unknown as AgentRun
      }
    }
    await runAgentEmployee(args(), d)
    resumable = sessions.get([...sessions.keys()][0])
    runs[0].busy = true
    const second = runAgentEmployee(args({ instructions: 'next' }), d)
    await new Promise((r) => setTimeout(r, 5))
    runs[0].alive = false
    runs[0].fire({ type: 'exit', code: 0, stderrTail: '', expected: true })
    const out = await second
    expect(starts).toHaveLength(2)
    expect(starts[1].resume).toBe('cli-1')
    expect(runs[1].sent).toHaveLength(1)
    expect(out.output.startsWith('[Claude Code · done]')).toBe(true)
  })

  it('a step stopped while queued is stopped, not failed', async () => {
    const emit = vi.fn()
    const d = {
      ...deps(makeRun(happy)),
      registry: new AgentRegistry({
        maxRunning: async () => 0,
        keepAliveMs: async () => 60_000
      })
    }
    const ctrl = new AbortController()
    const pending = runAgentEmployee(args({ emit, signal: ctrl.signal }), d)
    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()
    await expect(pending).rejects.toBeDefined()
    expect([...sessions.values()][0]).toMatchObject({ state: 'stopped' })
    const cards = emit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'agent_card')
    expect(cards.at(-1).card).toMatchObject({ state: 'stopped', queued: false })
    expect(emit.mock.calls.at(-1)?.[0].type).toBe('message_end')
  })

  it('saves a waiting prompt with its card before any answer, answerable from what was saved', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.fire({
        type: 'blocked',
        prompt: {
          kind: 'permission',
          requestId: 'q1',
          tool: 'Bash',
          summary: 'npm install',
          detail: 'npm install'
        }
      })
    })
    run.respond = (requestId: string) => {
      if (requestId !== 'q1') return false
      queueMicrotask(() => {
        run.fire({ type: 'answered', requestId: 'q1' })
        run.fire({
          type: 'turn_end',
          ok: true,
          interrupted: false,
          text: 'ok',
          costUsd: null,
          denials: 0
        })
      })
      return true
    }
    const d = deps(run)
    // The owner is elsewhere: no one reads the live events.
    const pending = runAgentEmployee(args({ emit: vi.fn() }), d)
    await vi.waitFor(() =>
      expect(updateParts).toHaveBeenLastCalledWith(expect.any(String), [
        expect.objectContaining({ state: 'blocked' })
      ])
    )
    // What a reload of the group's history shows: the saved row's card.
    const [messageId, [saved]] = updateParts.mock.calls.at(-1) as unknown as [
      string,
      [{ sessionId: string; prompts: Array<{ requestId: string }> }]
    ]
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: messageId })
    )
    expect(saved.prompts).toEqual([
      expect.objectContaining({ requestId: 'q1', summary: 'npm install' })
    ])
    expect(sessions.get(saved.sessionId)?.messageId).toBe(messageId)
    // The respond route answers through the saved card's session and request.
    expect(
      d.registry
        .bySession(saved.sessionId)
        ?.respond(saved.prompts[0].requestId, { kind: 'allow' })
    ).toBe(true)
    const out = await pending
    expect(out.messageId).toBe(messageId)
    expect(updateParts).toHaveBeenLastCalledWith(messageId, [
      expect.objectContaining({ state: 'done', prompts: [] })
    ])
  })

  it('gives parallel steps in one project their own folders: the first the shared one, the next a worktree', async () => {
    const d = deps(makeRun(happy))
    const starts: StartInput[] = []
    const runs = [makeRun(happy), makeRun(happy)]
    d.start = (input: StartInput) => {
      starts.push(input)
      return runs[starts.length - 1] as unknown as AgentRun
    }
    const other = { ...(agent as object), id: 'a2' } as never
    await Promise.all([
      runAgentEmployee(args(), d),
      runAgentEmployee(args({ agent: other }), d)
    ])
    expect(prepareWorkDir.mock.calls.map((c) => c[2])).toEqual([false, true])
    const cwds = starts.map((s) => s.cwd)
    expect(cwds).toContain('/x/notes')
    expect(new Set(cwds).size).toBe(2)
    expect(d.registry.claimsInProject('p1')).toBe(0)
  })

  it('a failed step leaves its saved card failed and its content what the PM was told', async () => {
    const run = makeRun((r) => {
      r.fire({ type: 'init', cliSessionId: 'cli-1', model: null })
      r.alive = false
      r.fire({ type: 'exit', code: 1, stderrTail: 'boom', expected: false })
    })
    await expect(runAgentEmployee(args(), deps(run))).rejects.toThrow('boom')
    const messageId = createMessage.mock.calls[0][0].id as string
    expect(updateParts).toHaveBeenLastCalledWith(messageId, [
      expect.objectContaining({ state: 'error' })
    ])
    expect(updateContent).toHaveBeenCalledWith(
      messageId,
      expect.stringMatching(/^\[Claude Code · error\]/)
    )
  })

  it('formats what the PM reads', () => {
    const card = {
      state: 'done',
      blocks: ['Done.'],
      pending: '',
      steps: [],
      denials: 2
    } as never
    expect(formatAgentOutput(card, 's')).toBe(
      '[Claude Code · done]\nDone.\nThe owner denied 2 requests.\nSession: s'
    )
  })
})
