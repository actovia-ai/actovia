// src/main/lib/ai/philharmonic/scheduler.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runPmCoordinator = vi.fn(async () => {})
const createConversationMessage = vi.fn(async () => ({ id: 'm' }))
const updateTask = vi.fn()
const claimOneOffTask = vi.fn(async (id: string) => ({
  id,
  status: 'running'
}))
const getDueOneOffTasks = vi.fn(async () => [] as Array<{ id: string }>)
const getTaskById = vi.fn(async () => ({
  id: 't',
  title: 'Daily report',
  conversationId: 'c1',
  status: 'pending'
}))
vi.mock('@main/lib/ai/philharmonic/pm-coordinator', () => ({
  runPmCoordinator
}))
vi.mock('@main/lib/db/conversation-queries', () => ({
  createConversationMessage
}))
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getCronTasks: async () => [],
  getDueOneOffTasks,
  getTaskById,
  updateTask,
  claimOneOffTask
}))
vi.mock('node-cron', () => ({
  default: {
    validate: () => true,
    schedule: (_e: string, fn: () => void) => ({ stop: () => {}, _fn: fn })
  }
}))
// Mock logger to avoid pulling in electron
vi.mock('@main/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

const { runScheduledRound, runDueOneOffTasks } =
  await import('@main/lib/ai/philharmonic/scheduler')

describe('runScheduledRound', () => {
  beforeEach(() => vi.clearAllMocks())

  it('injects a round-start system message and runs the PM loop', async () => {
    const emit = vi.fn()
    await runScheduledRound('t', emit)
    expect(createConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', role: 'system' })
    )
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'round_start', conversationId: 'c1' })
    )
    expect(runPmCoordinator).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        userText: expect.stringContaining('Daily report'),
        trigger: 'scheduled'
      })
    )
  })
})

describe('runDueOneOffTasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires each due task and marks it completed', async () => {
    getDueOneOffTasks.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }])
    await runDueOneOffTasks(vi.fn())
    expect(runPmCoordinator).toHaveBeenCalledTimes(2)
    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'completed' })
    expect(updateTask).toHaveBeenCalledWith('t2', { status: 'completed' })
  })

  it('does nothing when no tasks are due', async () => {
    getDueOneOffTasks.mockResolvedValueOnce([])
    await runDueOneOffTasks(vi.fn())
    expect(runPmCoordinator).not.toHaveBeenCalled()
  })

  it('claims a task via compare-and-swap before executing it, so a concurrent sweep cannot double-fire it', async () => {
    // Record the sequence of status values updateTask is called with, per task id.
    const statusSequence: Record<string, string[]> = {}
    updateTask.mockImplementation(
      async (id: string, data: { status?: string }) => {
        if (data.status) {
          statusSequence[id] ??= []
          statusSequence[id].push(data.status)
        }
        return { id, ...data }
      }
    )

    getDueOneOffTasks.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }])
    await runDueOneOffTasks(vi.fn())

    // Each due task ran exactly once.
    expect(runPmCoordinator).toHaveBeenCalledTimes(2)

    // Each task is claimed via the CAS query — which flips 'pending' ->
    // 'running' only if it's still 'pending' — before the slow
    // runScheduledRound call, not after.
    expect(claimOneOffTask).toHaveBeenCalledWith('t1')
    expect(claimOneOffTask).toHaveBeenCalledWith('t2')

    // The claim itself no longer goes through updateTask — only the
    // terminal status transition does.
    expect(statusSequence.t1).toEqual(['completed'])
    expect(statusSequence.t2).toEqual(['completed'])
  })

  it('isolates a per-task failure: other due tasks still run, and the throwing task ends up failed, not stuck pending', async () => {
    const statusSequence: Record<string, string[]> = {}
    updateTask.mockImplementation(
      async (id: string, data: { status?: string }) => {
        if (data.status) {
          statusSequence[id] ??= []
          statusSequence[id].push(data.status)
        }
        return { id, ...data }
      }
    )

    // t1's runScheduledRound throws because its internal getTaskById lookup
    // rejects (e.g. a transient DB error). t2/t3 fall through to the default
    // getTaskById implementation and should still run despite t1's throw.
    getTaskById.mockRejectedValueOnce(new Error('boom'))

    getDueOneOffTasks.mockResolvedValueOnce([
      { id: 't1' },
      { id: 't2' },
      { id: 't3' }
    ])
    await runDueOneOffTasks(vi.fn())

    // Only t2 and t3 reached the PM loop — the loop didn't abort after t1
    // threw, so all three were attempted, but t1 failed before getting there.
    expect(runPmCoordinator).toHaveBeenCalledTimes(2)

    // All three were claimed via the CAS query.
    expect(claimOneOffTask).toHaveBeenCalledWith('t1')
    expect(claimOneOffTask).toHaveBeenCalledWith('t2')
    expect(claimOneOffTask).toHaveBeenCalledWith('t3')

    // t1 was claimed, then marked failed (never stuck at 'pending').
    expect(statusSequence.t1).toEqual(['failed'])
    // t2/t3 completed normally.
    expect(statusSequence.t2).toEqual(['completed'])
    expect(statusSequence.t3).toEqual(['completed'])
  })

  it('skips a task another concurrent sweep tick already claimed, without re-running or overwriting its outcome', async () => {
    // Simulate a concurrent sweep: t2 was already claimed (and is presumably
    // mid-run or finished) by another sweep tick by the time this sweep's
    // loop reaches it, so the CAS claim for t2 matches zero rows.
    claimOneOffTask.mockImplementation(async (id: string) => {
      if (id === 't2') return undefined
      return { id, status: 'running' }
    })

    getDueOneOffTasks.mockResolvedValueOnce([
      { id: 't1' },
      { id: 't2' },
      { id: 't3' }
    ])
    await runDueOneOffTasks(vi.fn())

    // The claim was attempted for every due task in this sweep's stale snapshot...
    expect(claimOneOffTask).toHaveBeenCalledWith('t1')
    expect(claimOneOffTask).toHaveBeenCalledWith('t2')
    expect(claimOneOffTask).toHaveBeenCalledWith('t3')

    // ...but only the tasks that actually won the claim reached the PM loop.
    // t2 lost the claim, so it must NOT have been re-run by this sweep.
    expect(runPmCoordinator).toHaveBeenCalledTimes(2)

    // This sweep never touched t2's terminal status — whatever outcome the
    // sweep that actually claimed it recorded is left alone, not overwritten.
    expect(updateTask).not.toHaveBeenCalledWith('t2', { status: 'completed' })
    expect(updateTask).not.toHaveBeenCalledWith('t2', { status: 'failed' })
  })
})
