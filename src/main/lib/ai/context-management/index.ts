import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import type { CurrentRun } from '@actovia/shared/utils/attempts'
import type { Model } from '@earendil-works/pi-ai'

import { logger } from '../../logger'
import { runFullCompaction } from './compaction'
import { assembleContext, bootstrapContextItems } from './context-assembler'
import type { AssembledContext } from './context-assembler'
import { lcmStatusBus } from './lcm-status-bus'
import { appendContextItem, getContextItems } from './queries'
import { estimateMessageTokens } from './token-counter'

export type { AssembledContext }

// Default context window sizes by provider pattern (tokens)
// Used when the setting doesn't specify an explicit limit
const DEFAULT_CONTEXT_WINDOW = 128_000

export const DEFAULT_FRESH_TAIL_RUNS = SETTING_DEFAULTS.memory.freshTailSize
const MIN_FRESH_TAIL_RUNS = 2
const MAX_FRESH_TAIL_RUNS = 24

/**
 * The `memory.freshTailSize` setting as a number of runs. It counted messages
 * (8-64, default 16) before the chat kernel rewrite, so a value saved then is
 * clamped into the new range rather than read as that many runs.
 */
export function freshTailRuns(
  memory:
    | {
        freshTailSize?: number | null
      }
    | null
    | undefined
): number {
  const raw = memory?.freshTailSize
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_FRESH_TAIL_RUNS
  return Math.min(MAX_FRESH_TAIL_RUNS, Math.max(MIN_FRESH_TAIL_RUNS, raw))
}

/**
 * LcmManager: per-instance manager for a single chat session.
 *
 * Usage:
 *   const lcm = new LcmManager(chatId, model, apiKey, { ... })
 *   const ctx = await lcm.assembleContext(tokenBudget)
 *   // after chat completes:
 *   await lcm.trackNewMessages(newMessages)
 *   await lcm.compactAfterTurn()  // non-blocking: call without await
 */
/**
 * Appends messages to a chat's context items, skipping any already there —
 * safe to call twice for the same run. Needs no model or key: the run's rows
 * enter the context as they are saved (`RunRecorder.persist`), so the next
 * message sees them however quickly it is sent.
 */
export async function trackContextMessages(
  chatId: string,
  messages: Array<{ id: string; content: unknown }>
): Promise<void> {
  if (messages.length === 0) return
  let items = await getContextItems(chatId)
  // A chat begun with LCM off has rows and no items. Tracking the new
  // question first used to make the assembler skip its bootstrap (it saw one
  // item), so the whole history was left out: seed from the rows first.
  if (items.length === 0) {
    await bootstrapContextItems(chatId)
    items = await getContextItems(chatId)
  }
  const tracked = new Set(
    items.filter((i) => i.kind === 'message').map((i) => i.refId)
  )
  for (const msg of messages) {
    if (tracked.has(msg.id)) continue
    tracked.add(msg.id)
    await appendContextItem(
      chatId,
      'message',
      msg.id,
      estimateMessageTokens(msg.content)
    )
  }
}

export class LcmManager {
  private chatId: string
  private model: Model<string>
  private apiKey: string
  private freshTailRuns: number
  private contextWindowPercent: number
  private contextWindow: number

  // Per-chat serialization queue to prevent concurrent compaction
  private static compactionQueues = new Map<string, Promise<void>>()

  constructor(
    chatId: string,
    model: Model<string>,
    apiKey: string,
    options: {
      /** Runs kept verbatim, never compacted (see context-assembler). */
      freshTailRuns?: number
      contextWindowPercent?: number
      contextWindow?: number
    } = {}
  ) {
    this.chatId = chatId
    this.model = model
    this.apiKey = apiKey
    this.freshTailRuns = options.freshTailRuns ?? DEFAULT_FRESH_TAIL_RUNS
    this.contextWindowPercent =
      options.contextWindowPercent ??
      SETTING_DEFAULTS.memory.contextWindowPercent
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  }

  get tokenBudget(): number {
    return Math.floor((this.contextWindow * this.contextWindowPercent) / 100)
  }

  /**
   * Assembles the LLM message array for this chat session.
   * Bootstraps context tracking on first call. `current` is the run being
   * answered: a regenerate sees no other run of its group.
   */
  async assembleContext(current?: CurrentRun): Promise<AssembledContext> {
    return assembleContext(
      this.chatId,
      this.tokenBudget,
      this.freshTailRuns,
      current
    )
  }

  /**
   * Appends newly produced messages to the context item tracking table.
   * Call this after receiving new messages from the agent loop.
   */
  async trackNewMessages(
    messages: Array<{ id: string; content: unknown }>
  ): Promise<void> {
    await trackContextMessages(this.chatId, messages)
  }

  /**
   * Runs compaction after a turn if context exceeds the threshold.
   * Uses a per-chatId promise queue to prevent concurrent runs.
   *
   * Call this WITHOUT await to run in the background:
   *   lcm.compactAfterTurn().catch(err => logger.error('lcm', 'Compaction failed', { error: String(err) }))
   */
  async compactAfterTurn(): Promise<void> {
    const chatId = this.chatId
    const existing =
      LcmManager.compactionQueues.get(chatId) ?? Promise.resolve()

    const next = existing.then(async () => {
      try {
        await this.runCompactionIfNeeded()
      } catch (err) {
        logger.error('lcm', 'Compaction failed', { chatId, error: String(err) })
      }
    })

    LcmManager.compactionQueues.set(chatId, next)
    // Clean up queue reference after completion
    next.finally(() => {
      if (LcmManager.compactionQueues.get(chatId) === next) {
        LcmManager.compactionQueues.delete(chatId)
      }
    })

    return next
  }

  private async runCompactionIfNeeded(): Promise<void> {
    const initialItems = await getContextItems(this.chatId)
    const initialTokens = initialItems.reduce(
      (sum, i) => sum + (i.tokenCount ?? 0),
      0
    )
    const threshold = this.contextWindow * (this.contextWindowPercent / 100)

    if (initialTokens <= threshold) return

    const messagesBefore = initialItems.filter(
      (i) => i.kind === 'message'
    ).length

    const startedAt = Date.now()
    lcmStatusBus.emit({ type: 'start', chatId: this.chatId, startedAt })

    try {
      // Budget-targeted compaction: up to 10 rounds (unchanged behavior)
      const targetTokens = Math.floor(this.contextWindow * 0.6)
      for (let round = 0; round < 10; round++) {
        const updated = await getContextItems(this.chatId)
        const total = updated.reduce((sum, i) => sum + (i.tokenCount ?? 0), 0)
        if (total <= targetTokens) break

        await runFullCompaction(
          this.chatId,
          this.model,
          this.apiKey,
          this.freshTailRuns
        )
      }

      const finalItems = await getContextItems(this.chatId)
      const finalTokens = finalItems.reduce(
        (sum, i) => sum + (i.tokenCount ?? 0),
        0
      )
      const messagesAfter = finalItems.filter(
        (i) => i.kind === 'message'
      ).length

      lcmStatusBus.emit({
        type: 'complete',
        chatId: this.chatId,
        durationMs: Date.now() - startedAt,
        messagesBefore,
        messagesAfter,
        tokensSaved: Math.max(0, initialTokens - finalTokens)
      })
    } catch (err) {
      lcmStatusBus.emit({
        type: 'error',
        chatId: this.chatId,
        error: String(err instanceof Error ? err.message : err)
      })
      throw err
    }
  }
}
