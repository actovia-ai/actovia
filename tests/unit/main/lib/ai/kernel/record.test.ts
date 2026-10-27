import type { ChatAssistantMessage } from '@actovia/shared/types/chat'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))
const saveMessages = vi.fn(async () => {})
const saveChatContextSnapshot = vi.fn(async () => {})
vi.mock('@main/lib/db/queries', () => ({
  saveMessages,
  saveChatContextSnapshot
}))
const enqueueAndProcess = vi.fn(async () => {})
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess,
  logEnqueueFailure: vi.fn()
}))

const order: string[] = []
const trackContextMessages = vi.fn(async () => {
  order.push('track')
})
const contextTokens = vi.fn(async () => {
  order.push('measure')
  return 97_000
})
vi.mock('@main/lib/ai/context-management', () => ({
  trackContextMessages,
  contextTokens
}))

const { RunRecorder } = await import('@main/lib/ai/kernel/record')

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const model = { id: 'm', provider: 'faux' } as never

function recorder(
  over: Partial<ConstructorParameters<typeof RunRecorder>[0]> = {}
) {
  return new RunRecorder({
    chatId: 'c',
    model,
    lcm: { freshTailRuns: 6, contextWindowPercent: 75 },
    memoryCapture: true,
    ...over
  })
}

const assistant: ChatAssistantMessage = {
  id: 'a1',
  runId: RUN_ID,
  role: 'assistant',
  content: [{ type: 'text', text: 'x' }],
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  stopReason: 'stop',
  timestamp: 2
}

beforeEach(() => {
  saveMessages.mockClear()
  saveChatContextSnapshot.mockClear()
  enqueueAndProcess.mockClear()
  trackContextMessages.mockClear()
  contextTokens.mockClear()
  order.length = 0
  enqueueAndProcess.mockImplementation(async (queue: string) => {
    order.push(queue)
  })
})

describe('RunRecorder', () => {
  it('stamps the duration at run_end, before persist: the route sends these messages in done first', () => {
    const r = recorder()
    const messages = [{ ...assistant }]
    r.observe({ type: 'run_end', runId: RUN_ID, messages, durationMs: 4321 })
    expect(messages[0]).toMatchObject({ durationMs: 4321 })
    expect(saveMessages).not.toHaveBeenCalled()
  })

  it('persists the run_end messages with durationMs on the last assistant message and enqueues the jobs', async () => {
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1234
    })
    await r.persist()

    expect(saveMessages).toHaveBeenCalledTimes(1)
    const rows = (
      saveMessages.mock.calls[0] as unknown as [
        { messages: Array<Record<string, unknown>> }
      ]
    )[0].messages
    expect(rows[0]).toMatchObject({ id: 'a1', runId: RUN_ID, durationMs: 1234 })
    // The run enters the chat's context as it is saved — a follow-up sent a
    // second later sees it — and only compaction is left to the queue. It
    // used to be tracked by the queued job, which a quick follow-up did not
    // wait for, and which skipped tracking altogether when it found no key
    // (audit, 2026-10-01).
    expect(trackContextMessages).toHaveBeenCalledWith('c', [
      { id: 'a1', content: assistant.content }
    ])
    expect(order.indexOf('track')).toBeLessThan(order.indexOf('lcm-post-turn'))
    const lcmPayload = (
      enqueueAndProcess.mock.calls.find(
        ([queue]) => queue === 'lcm-post-turn'
      ) as unknown as [string, Record<string, unknown>]
    )[1]
    expect(lcmPayload).toMatchObject({ chatId: 'c', freshTailRuns: 6 })
    expect(lcmPayload).not.toHaveProperty('newMessages')
    // The memory job reads the conversation from the database when it runs:
    // the queue no longer carries a whole conversation every turn.
    const memoryPayload = (
      enqueueAndProcess.mock.calls.find(
        ([queue]) => queue === 'memory-consolidate'
      ) as unknown as [string, Record<string, unknown>]
    )[1]
    expect(memoryPayload).toMatchObject({ chatId: 'c' })
    expect(memoryPayload).not.toHaveProperty('messages')
  })

  it('tracks nothing when LCM is off', async () => {
    const r = recorder({ lcm: null })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()
    expect(trackContextMessages).not.toHaveBeenCalled()
  })

  it('keeps the rows of a run in order even when two share a millisecond', async () => {
    // A tool result is stamped at tool_end and the next step at its stream
    // start — the same ms is common. Rows are read back ORDER BY createdAt,
    // so equal stamps would leave the order to the database.
    const call = { ...assistant, id: 'a1', timestamp: 1000 }
    const result = {
      id: 't1',
      runId: RUN_ID,
      role: 'toolResult' as const,
      toolCallId: 'c1',
      toolName: 'weather',
      content: [],
      details: null,
      isError: false,
      timestamp: 1000
    }
    const answer = { ...assistant, id: 'a2', timestamp: 1000 }
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [call, result, answer],
      durationMs: 1
    })
    await r.persist()
    const rows = (
      saveMessages.mock.calls[0] as unknown as [
        { messages: Array<{ createdAt: Date }> }
      ]
    )[0].messages
    const stamps = rows.map((row) => row.createdAt.getTime())
    expect(stamps).toEqual([1000, 1001, 1002])
  })

  it('persists nothing when the run produced nothing', async () => {
    const r = recorder()
    r.observe({ type: 'run_end', runId: RUN_ID, messages: [], durationMs: 5 })
    await r.persist()
    expect(saveMessages).not.toHaveBeenCalled()
    expect(enqueueAndProcess).not.toHaveBeenCalled()
  })

  it('persists nothing when run_end never arrived', async () => {
    const r = recorder()
    r.observe({ type: 'message_end', runId: RUN_ID, message: assistant })
    await r.persist()
    expect(saveMessages).not.toHaveBeenCalled()
  })

  it('persist is idempotent', async () => {
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()
    await r.persist()
    expect(saveMessages).toHaveBeenCalledTimes(1)
  })

  it('skips LCM and memory jobs when they are off', async () => {
    const r = recorder({ lcm: null, memoryCapture: false })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()
    expect(saveMessages).toHaveBeenCalledTimes(1)
    expect(enqueueAndProcess).not.toHaveBeenCalled()
  })

  it('exposes the run messages after run_end', () => {
    const r = recorder()
    expect(r.messages).toEqual([])
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    expect(r.messages).toEqual([assistant])
  })
})

// The Context view (ISSUE-235): the route measures the request's parts, the
// recorder scales them to what the provider reported for the run's first
// call and saves the snapshot with the run.
describe('RunRecorder saves the context snapshot', () => {
  const parts = {
    system: 300,
    skills: 0,
    mcp: 0,
    tools: 200,
    memory: 0,
    summaries: 0,
    messages: 500
  }
  const context = {
    parts,
    contextWindow: 400_000,
    compactAt: 300_000,
    model: 'm',
    runId: RUN_ID
  }
  const withUsage = (input: number, cacheRead: number) => ({
    ...assistant,
    usage: {
      ...assistant.usage,
      input,
      cacheRead,
      totalTokens: input + cacheRead
    }
  })

  it("scales to the first call's real input", async () => {
    const r = recorder({ context })
    r.observe({
      type: 'message_end',
      runId: RUN_ID,
      message: withUsage(900, 100)
    })
    // A later step's larger input is not the context the run started with.
    r.observe({
      type: 'message_end',
      runId: RUN_ID,
      message: withUsage(5000, 0)
    })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [withUsage(900, 100)],
      durationMs: 1
    })
    await r.persist()

    expect(saveChatContextSnapshot).toHaveBeenCalledTimes(1)
    const [chatId, snapshot] = saveChatContextSnapshot.mock
      .calls[0] as never as [string, Record<string, unknown>]
    expect(chatId).toBe('c')
    expect(snapshot).toMatchObject({
      runId: RUN_ID,
      model: 'm',
      contextWindow: 400_000,
      compactAt: 300_000,
      total: 1000,
      estimated: false
    })
    expect(typeof snapshot.takenAt).toBe('string')
  })

  // ISSUE-235 review: the ring's amber is LCM's own count — what the
  // post-turn job compares — taken once this run is in the context.
  it("records LCM's own total after the run is tracked", async () => {
    const r = recorder({ context })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()

    const [, snapshot] = saveChatContextSnapshot.mock.calls[0] as never as [
      string,
      Record<string, unknown>
    ]
    expect(snapshot.lcmTokens).toBe(97_000)
    expect(order.indexOf('track')).toBeLessThan(order.indexOf('measure'))
  })

  it('records no LCM total with LCM off', async () => {
    const r = recorder({ context, lcm: null })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()

    const [, snapshot] = saveChatContextSnapshot.mock.calls[0] as never as [
      string,
      Record<string, unknown>
    ]
    expect(snapshot.lcmTokens).toBeNull()
    expect(contextTokens).not.toHaveBeenCalled()
  })

  it('keeps the estimate when the provider reported nothing', async () => {
    const r = recorder({ context })
    r.observe({ type: 'message_end', runId: RUN_ID, message: withUsage(0, 0) })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [withUsage(0, 0)],
      durationMs: 1
    })
    await r.persist()
    expect(saveChatContextSnapshot.mock.calls[0]?.[1]).toMatchObject({
      total: 1000,
      estimated: true
    })
  })

  it('leaves the last snapshot alone when the run produced no answer', async () => {
    const r = recorder({ context })
    const question = {
      id: RUN_ID,
      runId: RUN_ID,
      role: 'user',
      content: [{ type: 'text', text: 'q' }],
      timestamp: 1
    } as never
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [question],
      durationMs: 1
    })
    await r.persist()
    expect(saveMessages).toHaveBeenCalled()
    expect(saveChatContextSnapshot).not.toHaveBeenCalled()
  })

  it('never fails the run when the snapshot cannot be saved', async () => {
    saveChatContextSnapshot.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const r = recorder({ context })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [{ ...assistant }],
      durationMs: 1
    })
    await expect(r.persist()).resolves.toBeUndefined()
    expect(enqueueAndProcess).toHaveBeenCalledWith(
      'lcm-post-turn',
      expect.anything()
    )
  })

  it('saves nothing without a measured context', async () => {
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [{ ...assistant }],
      durationMs: 1
    })
    await r.persist()
    expect(saveChatContextSnapshot).not.toHaveBeenCalled()
  })
})
