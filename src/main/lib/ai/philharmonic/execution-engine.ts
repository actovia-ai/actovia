// src/main/lib/ai/philharmonic/execution-engine.ts
import {
  runAgentEmployee,
  type DelegatedOutput
} from '../../agents/run-agent-employee'
import {
  createTaskExecution,
  getAgentById,
  getTaskById,
  incrementTaskRetryCount,
  updateTask,
  updateTaskExecution
} from '../../db/philharmonic-queries'
import { logger } from '../../logger'
import { rememberTaskOutcome } from './agent-memory'
import { runEmployeeLoop, type SseEmitter } from './employee-loop'
import { DEFAULT_POLICY, withRetry } from './retry'

export type { DelegatedOutput }

/**
 * Run one delegated employee task end-to-end: mark running, create the
 * execution row, run the employee loop (with transient-failure retry), mark
 * completed/failed. Returns the employee's final text output for the PM
 * to review — for a CLI employee also the message its step saved (the
 * card lives in it).
 *
 * Retry behavior (Actovia' own loop only — a CLI step is never retried: a
 * second run would redo the work):
 * - Transient errors (network / 429 / 5xx / rate-limit phrasing) retry with
 *   decorrelated jitter up to `task.maxRetries + 1` attempts total.
 * - Permanent errors throw immediately.
 * - Abort signal is honored — aborted runs never retry.
 * - Each retry increments `task.retryCount` and emits a `delegation_retry`
 *   SSE event so the UI can show a small note instead of looking frozen.
 */
export async function runDelegatedTask(args: {
  taskId: string
  agentId: string
  conversationId: string
  instructions: string
  emit: SseEmitter
  signal?: AbortSignal
}): Promise<DelegatedOutput> {
  const { taskId, agentId, conversationId, instructions, emit, signal } = args
  const agent = await getAgentById(agentId)
  // Only an active employee runs — never one the PM model named on its own say-so.
  if (!agent?.isActive) {
    await updateTask(taskId, { status: 'failed' })
    throw new Error(`Employee ${agent?.name ?? agentId} is not active`)
  }

  const taskRow = await getTaskById(taskId)
  // task.maxRetries is the number of retries beyond the first attempt.
  const maxAttempts = Math.max(1, (taskRow?.maxRetries ?? 1) + 1)
  const policy = { ...DEFAULT_POLICY, maxAttempts }

  await updateTask(taskId, { status: 'running' })
  const execution = await createTaskExecution({
    taskId,
    agentId,
    status: 'running',
    error: null,
    tokenUsage: null
  })

  try {
    const outcome: DelegatedOutput =
      agent.runtime === 'actovia'
        ? {
            output: await withRetry(
              () =>
                runEmployeeLoop({
                  agent,
                  instructions,
                  executionId: execution.id,
                  conversationId,
                  emit,
                  signal
                }),
              {
                policy,
                signal,
                onRetry: async (attempt, delayMs, err) => {
                  const message =
                    err instanceof Error ? err.message : String(err)
                  logger.warn('philharmonic', 'delegation retry', {
                    taskId,
                    attempt,
                    delayMs,
                    message
                  })
                  const retryCount = await incrementTaskRetryCount(
                    taskId
                  ).catch(() => 0)
                  emit({
                    type: 'delegation_retry',
                    conversationId,
                    taskId,
                    agentId,
                    attempt: retryCount,
                    delayMs,
                    error: message
                  })
                }
              }
            )
          }
        : await runAgentEmployee({
            agent,
            instructions,
            taskId,
            conversationId,
            emit,
            signal
          })
    const output = outcome.output
    // Actovia' loop closes its own execution row; a CLI run leaves it to us.
    if (agent.runtime !== 'actovia')
      await updateTaskExecution(execution.id, {
        status: 'completed',
        completedAt: new Date()
      })

    await updateTask(taskId, {
      status: 'completed',
      output: { result: output },
      completedAt: new Date()
    })
    await rememberTaskOutcome(agentId, conversationId, instructions, output)
    return outcome
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateTaskExecution(execution.id, {
      status: 'failed',
      completedAt: new Date(),
      error: message
    })
    await updateTask(taskId, { status: 'failed' })
    throw err
  }
}
