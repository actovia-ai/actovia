import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatAssistantMessage,
  ChatMessage
} from '@actovia/shared/types/chat'
import type { Model } from '@earendil-works/pi-ai'

import { scaleSnapshot, type ContextParts } from '../../chat/context-snapshot'
import { saveChatSources, sourcesOfRows } from '../../chat/sources'
import { saveChatContextSnapshot, saveMessages } from '../../db/queries'
import { enqueueAndProcess, logEnqueueFailure } from '../../jobs/worker'
import { logger } from '../../logger'
import { toDbRow } from '../../server/routes/chat-persistence'
import { contextTokens, trackContextMessages } from '../context-management'
import { settleDeepResearchResult } from '../deep-research/chat-result'
import type { KernelEvent } from './events'

export interface RecorderDeps {
  chatId: string
  /** The run's model; the post-run jobs read its key from settings (R3). */
  model: Model<string>
  /** LCM's post-run compaction job, or null when LCM is off. */
  lcm: { freshTailRuns: number; contextWindowPercent: number } | null
  /** Whether the memory-consolidation job runs after the run. */
  memoryCapture: boolean
  /**
   * The request's parts as the route measured them before the run
   * (`measureContext`), saved as the chat's context snapshot (ISSUE-235).
   */
  context?: {
    parts: ContextParts
    contextWindow: number
    compactAt: number | null
    model: string
    runId: string
  } | null
}

/**
 * Persists a run however it ended. The route feeds it every `KernelEvent`
 * and calls `persist()` from its `finally`: the messages that completed
 * (done, provider error midway, Stop) are saved with the run's duration
 * stamped on the last assistant message, then the post-run jobs — LCM
 * compaction, memory consolidation — go on the queue
 * rather than running inline.
 */
export class RunRecorder {
  private done: ChatMessage[] = []
  private durationMs = 0
  private persisted = false
  /** The provider's input for the run's first call — the context it sent. */
  private firstInput: number | null = null

  constructor(private readonly deps: RecorderDeps) {}

  observe(event: KernelEvent): void {
    if (event.type === 'message_end' && this.firstInput === null) {
      const u = event.message.usage
      if (u) this.firstInput = u.input + u.cacheRead + u.cacheWrite
    }
    if (event.type === 'run_end') {
      this.done = event.messages
      this.durationMs = event.durationMs
      // "Worked for X seconds" reads the last assistant message of the run.
      // Stamped here, not at persist: the route sends these same messages in
      // `done` before it persists, and a client that merged them unstamped
      // showed "Thought" with no time until the chat was opened again.
      for (let i = this.done.length - 1; i >= 0; i--) {
        const m = this.done[i]
        if (m.role === 'assistant') {
          ;(m as ChatAssistantMessage).durationMs ??= this.durationMs
          break
        }
      }
    }
  }

  /** The run's completed messages (empty until `run_end`). */
  get messages(): ChatMessage[] {
    return this.done
  }

  async persist(): Promise<void> {
    if (this.persisted || this.done.length === 0) return
    this.persisted = true
    const { chatId, model, lcm, memoryCapture } = this.deps

    const rows = this.done.map((m) => toDbRow(m, chatId))
    // Rows are read back ORDER BY createdAt. A tool result is stamped at
    // tool_end and the next step at its stream start — often the same
    // millisecond — so make the stamps strictly increasing within the run
    // rather than leave the order to the database.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].createdAt.getTime()
      if (rows[i].createdAt.getTime() <= prev) {
        rows[i] = { ...rows[i], createdAt: new Date(prev + 1) }
      }
    }
    await saveMessages({ messages: rows })
    // The run's numbered sources, for `recall` and the next run's numbering.
    await saveChatSources(sourcesOfRows(rows))
    // A research job that ended before its run was saved (one that failed
    // at once) found no row to write its outcome into.
    for (const row of rows) {
      const id = (row.details as { id?: unknown } | null)?.id
      if (row.toolName === TOOL_NAMES.deepResearch && typeof id === 'string') {
        await settleDeepResearchResult(id).catch((error: unknown) =>
          logger.error('kernel', 'Failed to settle a deep research result', {
            chatId,
            error
          })
        )
      }
    }

    if (lcm) {
      // Into the context now, not from the queue: a follow-up sent a second
      // later must see this run, and tracking needs no model or key. Only
      // compaction waits for the queue.
      await trackContextMessages(
        chatId,
        this.done.map((m) => ({ id: m.id, content: m.content }))
      )
    }
    // After tracking: the snapshot carries LCM's count with this run in it.
    await this.saveContextSnapshot()

    if (lcm) {
      enqueueAndProcess('lcm-post-turn', {
        chatId,
        model,
        freshTailRuns: lcm.freshTailRuns,
        contextWindowPercent: lcm.contextWindowPercent
      }).catch((error) => logEnqueueFailure('lcm-post-turn', error))
    }

    if (memoryCapture) {
      // The handler reads the conversation when it runs; a job no longer
      // carries a whole conversation through the queue every turn.
      enqueueAndProcess('memory-consolidate', { chatId, model }).catch(
        (error) => logEnqueueFailure('memory-consolidate', error)
      )
    }
  }

  /**
   * Only a run that answered: one that failed before any answer leaves the
   * last good snapshot. Never fails the run's save.
   */
  private async saveContextSnapshot(): Promise<void> {
    const { chatId, context } = this.deps
    if (!context || !this.done.some((m) => m.role === 'assistant')) return
    const { parts, ...rest } = context
    try {
      await saveChatContextSnapshot(chatId, {
        takenAt: new Date().toISOString(),
        ...rest,
        lcmTokens: this.deps.lcm ? await contextTokens(chatId) : null,
        ...scaleSnapshot(parts, this.firstInput)
      })
    } catch (error) {
      logger.error('kernel', 'Failed to save the context snapshot', {
        chatId,
        error
      })
    }
  }
}
