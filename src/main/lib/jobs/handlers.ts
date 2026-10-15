import type { Model } from '@earendil-works/pi-ai'

import { LcmManager, trackContextMessages } from '../ai/context-management'
import { runMemoryConsolidation } from '../ai/memory/manager'
import { getKnowledgeDocById, setIndexStatus } from '../db/knowledge-queries'
import { getMessagesByChatId, getSettings } from '../db/queries'
import { runDiscoverRefresh } from '../discover/manager'
import { contentHash } from '../knowledge-base/reconcile'
import { resolveKnowledgeBase } from '../knowledge-base/resolve-knowledge-base'
import { logger } from '../logger'
import { jobApiKey } from './job-api-key'
import type { KbSyncPayload, QueueName } from './types'

// No `apiKey` in a payload (ledger ruling R3): `jobApiKey` reads it from
// settings when the job runs. A payload queued by an earlier build may still
// carry one; it is ignored (and stripped at launch, `queries.ts`).
interface LcmPostTurnPayload {
  chatId: string
  model: Model<string>
  freshTailRuns: number
  contextWindowPercent: number
  /** Only in a job an earlier build queued: the run's rows enter the
   *  context as they are saved now (`RunRecorder.persist`). */
  newMessages?: Array<{ id: string; content: unknown }>
}

/** `chatId` now; `messages` (the whole conversation) in a job an earlier
 *  build queued. */
type MemoryConsolidatePayload = { model: Model<string> } & (
  | { chatId: string; messages?: undefined }
  | { messages: Array<{ role: string; content: unknown }>; chatId?: undefined }
)

async function keyFor(
  queue: QueueName,
  model: Model<string>
): Promise<string | null> {
  const key = jobApiKey(model, await getSettings())
  if (!key) {
    logger.warn('jobs', 'No API key saved for the job model — skipped', {
      queue,
      provider: model.provider
    })
  }
  return key
}

export const handlers: Record<QueueName, (payload: unknown) => Promise<void>> =
  {
    'lcm-post-turn': async (payload) => {
      const p = payload as LcmPostTurnPayload
      // Tracking needs no key; skipping it with the key gone left the run out
      // of the context for good.
      if (p.newMessages?.length) {
        await trackContextMessages(p.chatId, p.newMessages)
      }
      const apiKey = await keyFor('lcm-post-turn', p.model)
      if (!apiKey) return
      const lcm = new LcmManager(p.chatId, p.model, apiKey, {
        freshTailRuns: p.freshTailRuns,
        contextWindowPercent: p.contextWindowPercent
      })
      await lcm.compactAfterTurn()
    },

    'memory-consolidate': async (payload) => {
      const p = payload as MemoryConsolidatePayload
      const apiKey = await keyFor('memory-consolidate', p.model)
      if (!apiKey) return
      const messages =
        p.messages ??
        (await getMessagesByChatId({ id: p.chatId })).map((m) => ({
          role: m.role,
          content: m.content
        }))
      await runMemoryConsolidation(messages, p.model, apiKey)
    },

    'kb-sync': async (payload) => {
      const p = payload as KbSyncPayload
      const kb = resolveKnowledgeBase(await getSettings())
      if (!kb) return

      if (p.op === 'delete') {
        try {
          await kb.deleteDoc(p.lightragDocId)
        } catch {
          // The doc is already gone from Exodus; an orphan in LightRAG is
          // harmless and Reindex all never recreates it. Nothing to retry.
        }
        return
      }

      const doc = await getKnowledgeDocById(p.docId)
      if (!doc) return
      const hash = contentHash(doc.title, doc.content)
      if (hash === doc.syncedHash && doc.indexStatus === 'processed') return

      try {
        if (doc.lightragDocId) await kb.deleteDoc(doc.lightragDocId)
        const { trackId } = await kb.insertText(
          `# ${doc.title}\n\n${doc.content}`,
          doc.id
        )
        await setIndexStatus(doc.id, {
          lightragTrackId: trackId,
          syncedHash: hash,
          indexStatus: 'processing',
          indexError: null,
          lightragDocId: null
        })
      } catch (error) {
        await setIndexStatus(doc.id, {
          indexStatus: 'failed',
          indexError: String(error)
        })
        throw error // let pgmq retry the transient case
      }
    },

    'discover-refresh': async (payload) => {
      const p = payload as { force?: boolean }
      await runDiscoverRefresh({ force: p?.force })
    }
  }
