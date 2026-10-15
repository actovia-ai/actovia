import cron from 'node-cron'

import { resetStuckDiscoverRefresh } from '../discover/manager'
import { reconcileKnowledgeIndexStatus } from '../knowledge-base/reconcile'
import { logger } from '../logger'
import { stackFramesOf } from '../logger/record'
import { bindTraceAttributes, withTrace } from '../logger/trace-context'
import { handlers } from './handlers'
import { extractOriginTraceId } from './origin-trace'
import {
  archiveMessage,
  deleteMessage,
  enqueueJob,
  purgeArchive,
  readBatch
} from './queries'
import { QUEUE_NAMES, type QueueName } from './types'

/**
 * Deliberately generous: it must exceed the slowest realistic handler runtime,
 * or the periodic sweep re-reads a message that is still being processed and
 * runs its handler a second time concurrently (`lcm-post-turn`'s
 * `compactAfterTurn` can run up to 10 rounds of LLM summarization and routinely
 * outlives a 30-second window). It costs nothing in the happy path —
 * `enqueueAndProcess`'s immediate kick already handles low-latency processing,
 * so this value only governs crash-recovery timing.
 */
const VISIBILITY_TIMEOUT_SECONDS = 300
const BATCH_SIZE = 5
const MAX_READ_COUNT = 5

/**
 * Reads and processes one batch from a queue. A job whose handler succeeds is
 * deleted (see `deleteMessage` for why it isn't archived). Errors are isolated
 * per message: a handler throwing logs the error and leaves the message alone
 * (pgmq's visibility timeout makes it available again for retry), unless
 * it has already been read `MAX_READ_COUNT` times, in which case it's
 * archived so a permanently-broken payload doesn't retry forever — the one
 * case where keeping the payload around (until the next launch's
 * `purgeArchive`) is worth it.
 *
 * Known limitation — not every job type can actually trigger this
 * retry/give-up logic, because some handlers in `./handlers` wrap
 * functions that catch and log their own errors internally and never
 * rethrow:
 *
 * - `lcm-post-turn` — half-and-half. `trackNewMessages` can throw and
 *   propagate (full retry-on-failure for that half), but `compactAfterTurn`
 *   swallows its own errors internally (best-effort only for that half) —
 *   see `LcmManager.compactAfterTurn` in `../ai/context-management`.
 * - `memory-consolidate` — best-effort only. `runMemoryConsolidation` catches
 *   and logs its own errors and never rethrows, so this handler always
 *   resolves regardless of whether consolidation actually ran successfully.
 *
 * This is a deliberate, accepted tradeoff (ruled on during the job-queue
 * decoupling plan's review), not an oversight: the old fire-and-forget code
 * had identical silent-failure behavior for these job types, and changing
 * `runMemoryConsolidation`/`compactAfterTurn`'s error
 * handling is explicitly out of scope for that plan. The queue still adds
 * real value for these jobs via durability across process restarts — it's
 * only the retry-on-logged-failure behavior that doesn't apply to them.
 */
export async function processQueue(queueName: QueueName): Promise<void> {
  const messages = await readBatch(
    queueName,
    VISIBILITY_TIMEOUT_SECONDS,
    BATCH_SIZE
  )

  for (const msg of messages) {
    try {
      await withTrace(
        async () => {
          // Ride every log line the handler emits, so a failure deep in a
          // handler is still attributable to this queue + message.
          bindTraceAttributes({ queueName, msgId: msg.msgId })
          logger.debug('jobs', 'processing')
          await handlers[queueName](msg.message)
        },
        { originTraceId: extractOriginTraceId(msg.message) }
      )
      await deleteMessage(queueName, msg.msgId)
    } catch (error) {
      logger.error('jobs', `Job handler failed for ${queueName}`, {
        msgId: msg.msgId,
        readCt: msg.readCt,
        error
      })
      if (msg.readCt >= MAX_READ_COUNT) {
        logger.error(
          'jobs',
          `Giving up on ${queueName} job after ${msg.readCt} attempts`,
          { msgId: msg.msgId }
        )
        // Guarded: an unhandled rejection here would propagate out of
        // `processQueue` and skip every remaining message in the batch, not
        // just this one.
        await archiveMessage(queueName, msg.msgId).catch((archiveError) => {
          logger.error('jobs', `Failed to archive gave-up ${queueName} job`, {
            msgId: msg.msgId,
            error: archiveError
          })
        })
      }
    }
  }
}

/**
 * Enqueues a job, then fires an immediate (non-blocking) processing
 * attempt so the common case has near-zero latency instead of waiting for
 * the next periodic sweep. The returned promise resolves once the job is
 * durably enqueued — it does not wait for processing to finish.
 */
export async function enqueueAndProcess(
  queueName: QueueName,
  payload: unknown
): Promise<void> {
  await enqueueJob(queueName, payload)
  processQueue(queueName).catch((error) => {
    logger.error('jobs', `Immediate processing kick failed for ${queueName}`, {
      error
    })
  })
}

/**
 * Shared `.catch` reporter for `enqueueAndProcess` call sites.
 *
 * Deliberately logs neither `error.message` nor the payload: a Drizzle
 * `DrizzleQueryError`'s message embeds the failing query *and its bound
 * parameters* — the job's payload — which would otherwise land in plaintext in `~/.exodus/logs/*.jsonl`. `error.name` alone is safe and still
 * distinguishes error types; the stack's frames (no message) say where.
 */
export function logEnqueueFailure(queueName: QueueName, error: unknown): void {
  logger.error('jobs', `Failed to enqueue ${queueName} job`, {
    queueName,
    errorName: error instanceof Error ? error.name : typeof error,
    'exception.stacktrace': stackFramesOf(error)
  })
}

/**
 * Periodic safety-net sweep — catches anything the immediate kick in
 * `enqueueAndProcess` missed (e.g. a process restart between enqueue and
 * the kick completing). Each queue's sweep failure is isolated from the
 * others.
 */
export function initJobQueue(): void {
  // Archives are write-only (see `deleteMessage`). Builds before this one
  // archived every finished job, so an existing database carries a copy of
  // each conversation per turn in there, plaintext `apiKey` included.
  for (const queueName of QUEUE_NAMES) {
    purgeArchive(queueName).catch((error) => {
      logger.error('jobs', `Failed to purge the ${queueName} archive`, {
        errorName: error instanceof Error ? error.name : typeof error,
        'exception.stacktrace': stackFramesOf(error)
      })
    })
  }

  // A refresh can't outlive the process — clear any row stuck at 'refreshing'
  // from a crash or a rejected enqueue so it isn't blocked for up to ~20h.
  resetStuckDiscoverRefresh().catch((error) => {
    logger.error(
      'discover',
      'failed to reset stuck refresh status on startup',
      {
        error
      }
    )
  })

  cron.schedule('*/15 * * * * *', () => {
    for (const queueName of QUEUE_NAMES) {
      processQueue(queueName).catch((error) => {
        logger.error('jobs', `Sweep failed for ${queueName}`, {
          error
        })
      })
    }
  })

  // Settle knowledge_doc rows stuck in `processing` by polling LightRAG's
  // track_status — the only status-settlement path (see reconcile.ts).
  cron.schedule('*/30 * * * * *', () => {
    reconcileKnowledgeIndexStatus().catch((error) => {
      logger.error('knowledge-base', 'index-status reconcile sweep failed', {
        error
      })
    })
  })

  // Discover's own staleness gate lives inside runDiscoverRefresh — this just
  // gives it a chance to run periodically while the app is open. In practice
  // this produces roughly one real refresh a day, whenever the app happens to
  // be running, with no dependency on a specific wall-clock hour.
  cron.schedule('*/30 * * * *', () => {
    enqueueAndProcess('discover-refresh', {}).catch((error) => {
      logger.error('discover', 'periodic refresh enqueue failed', {
        error
      })
    })
  })
}
