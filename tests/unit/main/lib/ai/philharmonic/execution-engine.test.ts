// tests/unit/main/lib/ai/philharmonic/execution-engine.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

let agentRow: Record<string, unknown>
const updateTask = vi.fn()
const updateTaskExecution = vi.fn()
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getAgentById: async () => agentRow,
  getTaskById: async () => ({ id: 't1', maxRetries: 1 }),
  createTaskExecution: async () => ({ id: 'exec-1' }),
  incrementTaskRetryCount: async () => 1,
  updateTask,
  updateTaskExecution
}))
vi.mock('@main/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/lib/ai/philharmonic/agent-memory', () => ({
  rememberTaskOutcome: vi.fn(async () => {})
}))
const runEmployeeLoop = vi.fn()
vi.mock('@main/lib/ai/philharmonic/employee-loop', () => ({ runEmployeeLoop }))
const runAgentEmployee = vi.fn()
vi.mock('@main/lib/agents/run-agent-employee', () => ({ runAgentEmployee }))
// Retries without the real backoff.
vi.mock('@main/lib/ai/philharmonic/retry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DEFAULT_POLICY: { baseMs: 1, capMs: 2, maxAttempts: 3 }
}))

const { runDelegatedTask } =
  await import('@main/lib/ai/philharmonic/execution-engine')

const call = () =>
  runDelegatedTask({
    taskId: 't1',
    agentId: 'a1',
    conversationId: 'c1',
    instructions: 'do it',
    emit: vi.fn()
  })

beforeEach(() => {
  runEmployeeLoop.mockReset()
  runAgentEmployee.mockReset()
  updateTask.mockClear()
  updateTaskExecution.mockClear()
})

describe('runDelegatedTask', () => {
  it('runs an Actovia employee in its own loop, retrying a transient failure', async () => {
    agentRow = { id: 'a1', name: 'Avery', runtime: 'actovia', isActive: true }
    runEmployeeLoop
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('the report')
    const result = await call()
    expect(result.output).toBe('the report')
    expect(runEmployeeLoop).toHaveBeenCalledTimes(2)
    // Each attempt streams under an id of its own; the report is the last one's.
    const [first, second] = runEmployeeLoop.mock.calls.map(
      ([a]) => (a as { messageId: string }).messageId
    )
    expect(first).not.toBe(second)
    expect(result.liveMessageId).toBe(second)
    expect(runAgentEmployee).not.toHaveBeenCalled()
    expect(updateTask).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        status: 'completed',
        output: { result: 'the report' }
      })
    )
  })

  it('gives a Claude Code employee’s step to the CLI, with the message its step saved', async () => {
    agentRow = {
      id: 'a1',
      name: 'Claude Code',
      runtime: 'claude-code',
      isActive: true
    }
    const outcome = {
      output: '[Claude Code · done]',
      messageId: 'm1'
    }
    runAgentEmployee.mockResolvedValueOnce(outcome)
    await expect(call()).resolves.toEqual(outcome)
    expect(runEmployeeLoop).not.toHaveBeenCalled()
    expect(runAgentEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', instructions: 'do it' })
    )
    expect(updateTaskExecution).toHaveBeenCalledWith(
      'exec-1',
      expect.objectContaining({ status: 'completed' })
    )
  })

  it('never retries a CLI step, even on a transient-looking failure', async () => {
    agentRow = {
      id: 'a1',
      name: 'Claude Code',
      runtime: 'claude-code',
      isActive: true
    }
    runAgentEmployee.mockRejectedValue(new Error('ECONNRESET'))
    await expect(call()).rejects.toThrow('ECONNRESET')
    expect(runAgentEmployee).toHaveBeenCalledTimes(1)
    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'failed' })
  })

  it('starts no employee that is not active', async () => {
    agentRow = {
      id: 'a1',
      name: 'Claude Code',
      runtime: 'claude-code',
      isActive: false
    }
    await expect(call()).rejects.toThrow('Employee Claude Code is not active')
    expect(runAgentEmployee).not.toHaveBeenCalled()
    expect(runEmployeeLoop).not.toHaveBeenCalled()
    expect(updateTaskExecution).not.toHaveBeenCalled()
  })
})
