import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import type { KernelEvent } from '@main/lib/ai/kernel/events'
import { registerFauxProvider } from '@main/lib/ai/kernel/faux'
import {
  decideApproval,
  pendingApprovalCount,
  resetApprovalsForTests
} from '@main/lib/ai/kernel/pending-approvals'
import { runAgent, type RunInput } from '@main/lib/ai/kernel/run'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))

const RUN_ID = '22222222-2222-4222-8222-222222222222'
let home: string
let keyPath: string
const originalActoviaHome = process.env.ACTOVIA_HOME

// A stand-in read_file: the gate keys on the tool's name and `path`, and
// what it would read must never reach an event unless allowed.
const execute = vi.fn(async (_id: string, { path }: { path: string }) => ({
  content: [{ type: 'text' as const, text: `contents of ${path}` }],
  details: { path }
}))
const readFile: AgentTool = {
  name: TOOL_NAMES.readFile,
  label: 'Read File',
  description: 'test',
  parameters: Type.Object({ path: Type.String() }),
  execute: execute as unknown as AgentTool['execute']
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'actovia-run-approval-'))
  mkdirSync(join(home, '.ssh'))
  keyPath = join(home, '.ssh', 'id_rsa')
  writeFileSync(keyPath, 'PRIVATE KEY')
  mkdirSync(join(home, '.actovia'))
  process.env.ACTOVIA_HOME = join(home, '.actovia')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  if (originalActoviaHome === undefined) delete process.env.ACTOVIA_HOME
  else process.env.ACTOVIA_HOME = originalActoviaHome
})

afterEach(() => {
  execute.mockClear()
  resetApprovalsForTests()
})

function scripted(path: string) {
  const faux = registerFauxProvider()
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall(TOOL_NAMES.readFile, { path }, { id: 'call_1' })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage([fauxText('done')])
  ])
  return faux
}

function input(over: Partial<RunInput> & Pick<RunInput, 'model'>): RunInput {
  return {
    chatId: 'c',
    userMessage: {
      id: RUN_ID,
      runId: RUN_ID,
      role: 'user',
      content: 'read my key',
      timestamp: 1
    },
    systemPrompt: 'sys',
    contextMessages: [],
    tools: [readFile],
    apiKey: 'k',
    workspaceDir: join(home, '.actovia', 'workspace', 'c'),
    ...over
  }
}

/** Runs to the end, answering the first `approval_required` with `answer`. */
async function run(
  over: Partial<RunInput> & Pick<RunInput, 'model'>,
  answer?: (e: Extract<KernelEvent, { type: 'approval_required' }>) => void
) {
  const out: KernelEvent[] = []
  for await (const e of runAgent(input(over))) {
    out.push(e)
    if (e.type === 'approval_required') answer?.(e)
  }
  return out
}

function toolEnd(events: KernelEvent[]) {
  const e = events.find((x) => x.type === 'tool_end')
  if (!e || e.type !== 'tool_end') throw new Error('no tool_end')
  return e.message
}

describe('runAgent — the approval gate', () => {
  it('a sensitive read_file pauses with approval_required; allow runs the tool', async () => {
    const faux = scripted(keyPath)
    const events = await run({ model: faux.getModel() }, (e) => {
      expect(pendingApprovalCount()).toBe(1)
      queueMicrotask(() => decideApproval(e.runId, e.toolCallId, 'allow'))
    })

    const required = events.find((e) => e.type === 'approval_required')
    expect(required).toMatchObject({
      type: 'approval_required',
      runId: RUN_ID,
      toolCallId: 'call_1',
      toolName: TOOL_NAMES.readFile,
      summary: expect.stringMatching(/\.ssh\/id_rsa$/u)
    })
    // The summary is the path, never contents.
    expect(JSON.stringify(required)).not.toContain('PRIVATE KEY')
    const types = events.map((e) => e.type)
    expect(types.indexOf('tool_start')).toBeLessThan(
      types.indexOf('approval_required')
    )
    expect(events).toContainEqual({
      type: 'approval_resolved',
      runId: RUN_ID,
      toolCallId: 'call_1',
      outcome: 'allowed'
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(toolEnd(events)).toMatchObject({ isError: false })
    expect(pendingApprovalCount()).toBe(0)
  })

  it('deny: the tool never runs and the model reads the declined text', async () => {
    const faux = scripted(keyPath)
    const events = await run({ model: faux.getModel() }, (e) =>
      queueMicrotask(() => decideApproval(e.runId, e.toolCallId, 'deny'))
    )
    expect(execute).not.toHaveBeenCalled()
    const result = toolEnd(events)
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringMatching(
          /^The user declined access to .*\.ssh\/id_rsa\.$/u
        )
      }
    ])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'approval_resolved', outcome: 'denied' })
    )
    // The run goes on to the model's answer.
    const end = events.find((e) => e.type === 'run_end')
    if (end?.type !== 'run_end') throw new Error('no run_end')
    expect(end.messages.map((m) => m.role)).toEqual([
      'assistant',
      'toolResult',
      'assistant'
    ])
    expect(pendingApprovalCount()).toBe(0)
  })

  it('no answer within the timeout declines it', async () => {
    const faux = scripted(keyPath)
    const events = await run({ model: faux.getModel(), approvalTimeoutMs: 20 })
    expect(execute).not.toHaveBeenCalled()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'approval_resolved',
        outcome: 'timed_out'
      })
    )
    expect(toolEnd(events).content[0]).toMatchObject({
      text: expect.stringContaining('The user declined access to')
    })
    expect(pendingApprovalCount()).toBe(0)
  })

  it('the default timeout is ten minutes (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const faux = scripted(keyPath)
      let expiresIn = 0
      const events = await run({ model: faux.getModel() }, (e) => {
        expiresIn = e.expiresAt - Date.now()
        // Just short of it, still pending; then over.
        setImmediate(() => {
          vi.advanceTimersByTime(10 * 60 * 1000 - 1)
          expect(pendingApprovalCount()).toBe(1)
          vi.advanceTimersByTime(1)
        })
      })
      // The clock is real (only timers are faked): allow for the ms it took.
      expect(expiresIn).toBeGreaterThan(10 * 60 * 1000 - 1000)
      expect(expiresIn).toBeLessThanOrEqual(10 * 60 * 1000)
      expect(events).toContainEqual(
        expect.objectContaining({ outcome: 'timed_out' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('Stop while waiting declines it, and the run ends cleanly', async () => {
    const faux = scripted(keyPath)
    const controller = new AbortController()
    const events = await run(
      { model: faux.getModel(), signal: controller.signal },
      () => queueMicrotask(() => controller.abort())
    )
    expect(execute).not.toHaveBeenCalled()
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'approval_resolved', outcome: 'stopped' })
    )
    // pi would say "Operation aborted"; the model reads the decline.
    expect(toolEnd(events).content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('The user declined access to')
      }
    ])
    expect(events.at(-1)?.type).toBe('run_end')
    expect(pendingApprovalCount()).toBe(0)
  })

  it('lock.dat is refused without asking', async () => {
    const faux = scripted(join(home, '.actovia', 'lock.dat'))
    const events = await run({ model: faux.getModel() })
    expect(events.some((e) => e.type === 'approval_required')).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    const result = toolEnd(events)
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('is refused')
    })
  })

  it('an ordinary file runs without asking', async () => {
    const faux = scripted(join(home, 'notes.md'))
    const events = await run({ model: faux.getModel() })
    expect(events.some((e) => e.type === 'approval_required')).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('a summary with an embedded newline and a bidi override is sanitized before the approval_required event carries it', async () => {
    // What a malicious tool call can put in a path: a real newline (to hide
    // the rest of the summary from a client that renders only the first
    // line) and a bidi override (to display it reversed). No `/` in the
    // payload — the path still has to resolve to the same sensitive file.
    const evilPath = `${keyPath}\nrm -rf ~‮`
    const faux = scripted(evilPath)
    const events = await run({ model: faux.getModel() }, (e) =>
      queueMicrotask(() => decideApproval(e.runId, e.toolCallId, 'deny'))
    )
    const required = events.find((e) => e.type === 'approval_required')
    if (required?.type !== 'approval_required') {
      throw new Error('no approval_required')
    }
    expect(required.summary).not.toContain('\n')
    expect(required.summary).not.toContain('‮')
    expect(required.summary).toContain('⏎')
    expect(required.summary).toContain('rm -rf ~')
    expect(required.summary).toMatch(/id_rsa⏎rm -rf ~$/u)
  })

  it('a 9000+ character path arrives capped at 8000 with truncated/hiddenChars on the approval_required event (I1 follow-up)', async () => {
    // No `/` in the padding, so the whole thing stays one path segment named
    // like the real key (`isSecretFileName` matches on `id_` alone).
    const evilPath = `${keyPath}${'x'.repeat(9000)}`
    const faux = scripted(evilPath)
    const events = await run({ model: faux.getModel() }, (e) =>
      queueMicrotask(() => decideApproval(e.runId, e.toolCallId, 'deny'))
    )
    const required = events.find((e) => e.type === 'approval_required')
    if (required?.type !== 'approval_required') {
      throw new Error('no approval_required')
    }
    expect(required.truncated).toBe(true)
    expect(required.summary.length).toBe(8000)
    expect(required.hiddenChars).toBeGreaterThan(0)
    expect(required.summary).toContain('id_rsa')
    // What the model reads back stays short regardless.
    const toolResult = toolEnd(events)
    const modelText = (toolResult.content[0] as { text: string }).text
    expect(modelText.length).toBeLessThan(400)
  })
})
