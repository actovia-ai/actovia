import type { ChatAssistantMessage } from '@exodus/shared/types/chat'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))
const saveMessages = vi.fn(async () => undefined)
vi.mock('@main/lib/db/queries', () => ({ saveMessages }))
const enqueueAndProcess = vi.fn(async () => undefined)
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess,
  logEnqueueFailure: vi.fn()
}))

const order: string[] = []
const trackContextMessages = vi.fn(async () => {
  order.push('track')
})
vi.mock('@main/lib/ai/context-management', () => ({ trackContextMessages }))

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
  enqueueAndProcess.mockClear()
  trackContextMessages.mockClear()
  order.length = 0
  enqueueAndProcess.mockImplementation(async (queue: string) => {
    order.push(queue)
  })
})

describe('RunRecorder', () => {
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
