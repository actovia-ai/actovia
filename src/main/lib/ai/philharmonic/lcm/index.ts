// src/main/lib/ai/philharmonic/lcm/index.ts
//
// PhilharmonicLcm — single-summary rolling compactor for Group conversations.
//
// Public surface mirrors what Chat's LcmManager offers but stays small. Chat
// keeps a DAG of leaf and condensed summaries; for Philharmonic v1 we keep
// one summary row per conversation. Future iterations can graduate if needed.

import type { Message, Model } from '@earendil-works/pi-ai'
import type { Attachment } from '@exodus/shared/types/chat'

import { getMessagesByConversationId } from '../../../db/conversation-queries'
import { getAllAgents } from '../../../db/philharmonic-queries'
import type { ConversationMessage } from '../../../db/schema'
import { logger } from '../../../logger'
import {
  estimateMessageTokens,
  estimateTokens
} from '../../context-management/token-counter'
import { bareImageData } from '../../utils/image-data'
import { storedUsage } from '../../utils/usage'
import { employeeLabel, type LabelledAgent } from './labels'
import { getSessionSummary, upsertSessionSummary } from './queries'
import { summarizeMessages } from './summarize'

const DEFAULT_CONTEXT_WINDOW = 128_000

export interface PhilharmonicLcmOptions {
  freshTailSize?: number
  contextWindowPercent?: number
  contextWindow?: number
  /** When false, assembleContext returns every message as-is and trackAndCompact is a no-op. */
  enabled?: boolean
}

type StoredAttachmentPart = {
  kind: 'attachment'
  name: string
  url: string
  contentType: string
}

function isAttachmentPart(p: unknown): p is StoredAttachmentPart {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return (
    o.kind === 'attachment' &&
    typeof o.name === 'string' &&
    typeof o.url === 'string' &&
    typeof o.contentType === 'string'
  )
}

function extractAttachments(parts: unknown[] | null): Attachment[] {
  if (!parts) return []
  const out: Attachment[] = []
  for (const p of parts) {
    if (isAttachmentPart(p)) {
      out.push({ name: p.name, url: p.url, contentType: p.contentType })
    }
  }
  return out
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** Mirror of pm-coordinator.buildUserContent so the LCM emits the same shape. */
function buildUserContent(
  text: string,
  attachments: Attachment[]
): UserContentPart[] {
  const parts: UserContentPart[] = []
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const a of attachments) {
    if (a.contentType.startsWith('image/')) {
      parts.push({
        type: 'image',
        ...bareImageData(a.url, a.contentType)
      })
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

function rowToLlmMessage(
  row: ConversationMessage,
  agents: Map<string, LabelledAgent>
): Message {
  if (row.role === 'user') {
    const attachments = extractAttachments(row.parts)
    return {
      role: 'user',
      content: buildUserContent(row.content, attachments),
      timestamp: new Date(row.createdAt).getTime()
    } as Message
  }
  // PM / employee / system → assistant role from the LLM's point of view, so
  // the multi-actor conversation reads as a continuous coordinator narrative.
  return {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text:
          row.role === 'employee'
            ? `${employeeLabel(agents.get(row.agentId ?? ''))} ${row.content}`
            : row.content
      }
    ],
    // A Group's rows record no usage; pi needs one on every assistant message.
    usage: storedUsage(null),
    timestamp: new Date(row.createdAt).getTime()
  } as Message
}

async function loadAgents(): Promise<Map<string, LabelledAgent>> {
  return new Map((await getAllAgents()).map((a) => [a.id, a]))
}

function summaryAsMessage(content: string, createdAt: Date): Message {
  // Wrap in a clear marker so the model knows this is a compaction artifact
  // rather than user dialogue. We emit it as a user-role message because
  // assistant-role would suggest the PM said it.
  const xml = `<ph_summary timestamp="${createdAt.toISOString()}">\n${content}\n</ph_summary>`
  return {
    role: 'user',
    content: [{ type: 'text', text: xml }],
    timestamp: createdAt.getTime()
  } as Message
}

export class PhilharmonicLcm {
  private static compactionQueues = new Map<string, Promise<void>>()

  private conversationId: string
  private model: Model<string>
  private apiKey: string
  private freshTailSize: number
  private contextWindowPercent: number
  private contextWindow: number
  private enabled: boolean

  constructor(
    conversationId: string,
    model: Model<string>,
    apiKey: string,
    options: PhilharmonicLcmOptions = {}
  ) {
    this.conversationId = conversationId
    this.model = model
    this.apiKey = apiKey
    this.freshTailSize = options.freshTailSize ?? 16
    this.contextWindowPercent = options.contextWindowPercent ?? 75
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    this.enabled = options.enabled ?? true
  }

  get thresholdTokens(): number {
    return Math.floor((this.contextWindow * this.contextWindowPercent) / 100)
  }

  /**
   * Build the PM's LLM history. When LCM is disabled we behave exactly like
   * the old buildHistory: every persisted message converted in order.
   * Otherwise we splice the rolling summary in front of the fresh tail.
   */
  async assembleContext(excludeMessageId?: string): Promise<Message[]> {
    const rows = await getMessagesByConversationId(this.conversationId)
    const filtered = rows.filter((r) => r.id !== excludeMessageId)
    const agents = await loadAgents()
    const toLlm = (r: ConversationMessage) => rowToLlmMessage(r, agents)

    if (!this.enabled) {
      return filtered.map(toLlm)
    }

    const summary = await getSessionSummary(this.conversationId)
    if (!summary) {
      return filtered.map(toLlm)
    }

    const boundary = filtered.findIndex(
      (r) => r.id === summary.coversThroughMessageId
    )
    if (boundary === -1) {
      // Boundary message was deleted or excluded — fall back to full history
      // rather than risk dropping context.
      return filtered.map(toLlm)
    }

    const tail = filtered.slice(boundary + 1)
    return [
      summaryAsMessage(summary.content, summary.updatedAt),
      ...tail.map(toLlm)
    ]
  }

  /**
   * Recompute the rolling summary if we're over the token threshold. Safe to
   * fire-and-forget. Serialized per-conversation so concurrent turns don't
   * race on the same row.
   */
  async trackAndCompact(): Promise<void> {
    if (!this.enabled) return
    const conversationId = this.conversationId
    const prev =
      PhilharmonicLcm.compactionQueues.get(conversationId) ?? Promise.resolve()
    const next = prev.then(async () => {
      try {
        await this.runCompactionIfNeeded()
      } catch (err) {
        logger.error('philharmonic', 'LCM compaction failed', {
          conversationId,
          error: err
        })
      }
    })
    PhilharmonicLcm.compactionQueues.set(conversationId, next)
    next.finally(() => {
      if (PhilharmonicLcm.compactionQueues.get(conversationId) === next) {
        PhilharmonicLcm.compactionQueues.delete(conversationId)
      }
    })
    return next
  }

  private async runCompactionIfNeeded(): Promise<void> {
    const rows = await getMessagesByConversationId(this.conversationId)
    if (rows.length === 0) return

    const summary = await getSessionSummary(this.conversationId)

    // Tokens of the current "live" context (summary + uncovered messages).
    let coveredIndex = -1
    if (summary) {
      coveredIndex = rows.findIndex(
        (r) => r.id === summary.coversThroughMessageId
      )
    }

    const uncovered = coveredIndex >= 0 ? rows.slice(coveredIndex + 1) : rows
    const liveTokens =
      (summary?.tokenCount ?? 0) +
      uncovered.reduce((sum, m) => sum + estimateMessageTokens(m.content), 0)

    if (liveTokens <= this.thresholdTokens) return

    // Compaction range = everything older than the fresh tail.
    const target = Math.max(0, rows.length - this.freshTailSize)
    if (target === 0) return // nothing to absorb — we're already minimal

    const toAbsorb = rows.slice(0, target)
    const boundary = toAbsorb[toAbsorb.length - 1]
    if (!boundary) return

    logger.info('philharmonic', 'LCM compacting', {
      conversationId: this.conversationId,
      liveTokens,
      threshold: this.thresholdTokens,
      messageCount: toAbsorb.length
    })

    const newContent = await summarizeMessages({
      messages: toAbsorb,
      previousSummary: summary?.content,
      agents: await loadAgents(),
      model: this.model,
      apiKey: this.apiKey
    })

    await upsertSessionSummary({
      conversationId: this.conversationId,
      content: newContent,
      coversThroughMessageId: boundary.id,
      tokenCount: estimateTokens(newContent),
      messageCount: toAbsorb.length
    })

    logger.info('philharmonic', 'LCM compaction complete', {
      conversationId: this.conversationId,
      summaryTokens: estimateTokens(newContent),
      absorbed: toAbsorb.length
    })
  }
}
