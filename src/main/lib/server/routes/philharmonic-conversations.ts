// src/main/lib/server/routes/philharmonic-conversations.ts
import { NotFoundError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import { agentRegistry } from '../../agents/registry'
import { askUserRegistry } from '../../ai/philharmonic/ask-user-registry'
import { toPlanDto } from '../../ai/philharmonic/plan-dto'
import { runPmCoordinator } from '../../ai/philharmonic/pm-coordinator'
import { pmRunRegistry } from '../../ai/philharmonic/pm-run-registry'
import {
  createConversation,
  createConversationMessage,
  deleteConversation,
  getAllConversations,
  getLatestMessagePerConversation,
  getMessagesByConversationId,
  updateConversation
} from '../../db/conversation-queries'
import { getPhilharmonicCostRows } from '../../db/philharmonic-queries'
import { getActivePlanByConversationId } from '../../db/plan-queries'
import { listRoundEvents } from '../../db/pm-round-queries'
import { localDateStr } from '../../local-date'
import { logger } from '../../logger'
import { removeGroupMedia } from '../../media/store'
import type { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'
import { emitToConversation } from './philharmonic-sse'

interface CostRow {
  conversationId: string | null
  agentId: string
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    cost?: number
  } | null
  startedAt: Date
}

export interface PhilharmonicCostSummary {
  totalCost: number
  totalTokens: number
  byConversation: Array<{
    conversationId: string
    cost: number
    tokens: number
  }>
  byAgent: Array<{ agentId: string; cost: number; tokens: number }>
  daily: Array<{ date: string; cost: number; tokens: number }>
}

/** Pure aggregation — unit tested. Costs come ONLY from philharmonic executions. */
export function aggregateCosts(rows: CostRow[]): PhilharmonicCostSummary {
  let totalCost = 0
  let totalTokens = 0
  const conv = new Map<string, { cost: number; tokens: number }>()
  const agent = new Map<string, { cost: number; tokens: number }>()
  const day = new Map<string, { cost: number; tokens: number }>()

  for (const r of rows) {
    const u = r.tokenUsage
    if (!u) continue
    const tokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
    const cost = u.cost ?? 0
    totalCost += cost
    totalTokens += tokens
    if (r.conversationId) {
      const c = conv.get(r.conversationId) ?? { cost: 0, tokens: 0 }
      c.cost += cost
      c.tokens += tokens
      conv.set(r.conversationId, c)
    }
    const a = agent.get(r.agentId) ?? { cost: 0, tokens: 0 }
    a.cost += cost
    a.tokens += tokens
    agent.set(r.agentId, a)
    // The user's day, not the UTC one: the chart labels it as a local date.
    const d = localDateStr(r.startedAt)
    const dd = day.get(d) ?? { cost: 0, tokens: 0 }
    dd.cost += cost
    dd.tokens += tokens
    day.set(d, dd)
  }

  return {
    totalCost,
    totalTokens,
    byConversation: [...conv.entries()].map(([conversationId, v]) => ({
      conversationId,
      ...v
    })),
    byAgent: [...agent.entries()].map(([agentId, v]) => ({ agentId, ...v })),
    daily: [...day.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }))
  }
}

const router = new Hono<{ Variables: Variables }>()

// ─── Conversations ──────────────────────────────────────────────────────────

router.get('/conversations', async (c) => {
  const [conversations, latest] = await Promise.all([
    handleDatabaseOperation(
      () => getAllConversations(),
      'Failed to list conversations'
    ),
    handleDatabaseOperation(
      () => getLatestMessagePerConversation(),
      'Failed to list conversations'
    )
  ])
  const latestByConv = new Map(latest.map((m) => [m.conversationId, m]))
  return successResponse(
    c,
    conversations.map((row) => ({
      ...row,
      latestMessage: latestByConv.get(row.id) ?? null
    }))
  )
})

router.post('/conversations', async (c) => {
  const data = validateSchema(
    z.object({ title: z.string().min(1), icon: z.string().optional() }),
    await c.req.json(),
    'Invalid conversation data'
  )
  const row = await handleDatabaseOperation(
    () => createConversation(data),
    'Failed to create conversation'
  )
  return successResponse(c, row, 201)
})

router.delete('/conversations/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  // Spec §10: nothing keeps working for a group that is gone — the PM is
  // stopped, and every agent on one of its steps interrupted and exited.
  // The folders are left alone.
  pmRunRegistry.abort(id)
  await agentRegistry.stopConversation(id)
  await handleDatabaseOperation(
    () => deleteConversation(id),
    'Failed to delete conversation'
  )
  await removeGroupMedia(id)
  return deletionSuccessResponse(c, 'Conversation')
})

router.put('/conversations/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const data = validateSchema(
    z.object({
      title: z.string().optional(),
      icon: z.string().optional(),
      archived: z.boolean().optional()
    }),
    await c.req.json(),
    'Invalid conversation data'
  )
  return successResponse(
    c,
    await handleDatabaseOperation(
      () => updateConversation(id, data),
      'Failed to update'
    )
  )
})

router.get('/conversations/:id/messages', async (c) => {
  const id = getRequiredParam(c, 'id')
  return successResponse(c, await getMessagesByConversationId(id))
})

// A PM round's decision trail, in order — what the disclosure under its message shows.
router.get('/conversations/:id/rounds/:roundId', async (c) => {
  const id = getRequiredParam(c, 'id')
  const roundId = getRequiredParam(c, 'roundId')
  const rows = await listRoundEvents(id, roundId)
  if (!rows.length) throw new NotFoundError()
  return successResponse(
    c,
    rows.map((r) => ({
      seq: r.seq,
      kind: r.kind,
      payload: r.payload,
      createdAt: r.createdAt.toISOString()
    }))
  )
})

// Send a user message → persist → kick the PM loop (fire-and-forget).
router.post('/conversations/:id/messages', async (c) => {
  const id = getRequiredParam(c, 'id')
  const attachmentSchema = z.object({
    name: z.string(),
    url: z.string(),
    contentType: z.string()
  })
  const body = validateSchema(
    z
      .object({
        content: z.string(),
        attachments: z.array(attachmentSchema).optional()
      })
      .refine(
        (b) => b.content.trim().length > 0 || (b.attachments?.length ?? 0) > 0,
        {
          message: 'Message must include text or attachments'
        }
      ),
    await c.req.json(),
    'Invalid message'
  )
  // Attachments live alongside other message parts so the JSONB column stays
  // one source of truth. `kind` discriminator keeps them addressable.
  const parts = body.attachments?.map((a) => ({
    kind: 'attachment' as const,
    name: a.name,
    url: a.url,
    contentType: a.contentType
  }))
  const userMsg = await createConversationMessage({
    conversationId: id,
    role: 'user',
    content: body.content,
    parts: parts && parts.length > 0 ? parts : null
  })
  emitToConversation(id, {
    type: 'message_start',
    conversationId: id,
    messageId: userMsg.id,
    role: 'user'
  })
  emitToConversation(id, {
    type: 'message_end',
    conversationId: id,
    messageId: userMsg.id
  })

  // Per-conversation AbortController so the user can interrupt the run via
  // POST /conversations/:id/interrupt. The registry slot is cleared in the
  // finally below regardless of how the run ended.
  const controller = new AbortController()
  pmRunRegistry.set(id, controller)
  runPmCoordinator({
    conversationId: id,
    userText: body.content,
    attachments: body.attachments,
    excludeMessageId: userMsg.id,
    emit: (event) => emitToConversation(id, event),
    signal: controller.signal
  })
    .catch((err) =>
      logger.error('philharmonic', 'PM loop error', { error: err })
    )
    .finally(() => {
      pmRunRegistry.clear(id)
    })

  return successResponse(c, userMsg, 201)
})

// Abort the currently-running PM for a conversation, if any. Idempotent —
// returns wasRunning: false when there's nothing to abort.
router.post('/conversations/:id/interrupt', async (c) => {
  const id = getRequiredParam(c, 'id')
  const wasRunning = pmRunRegistry.abort(id)
  return successResponse(c, { success: true, wasRunning })
})

// Resolve a pending askUser.
router.post('/conversations/:id/respond', async (c) => {
  const id = getRequiredParam(c, 'id')
  const { response } = validateSchema(
    z.object({ response: z.string() }),
    await c.req.json(),
    'Invalid response'
  )
  await createConversationMessage({
    conversationId: id,
    role: 'user',
    content: response
  })
  askUserRegistry.resolve(id, response)
  return successResponse(c, { success: true })
})

// ─── Execution plan ──────────────────────────────────────────────────────────

router.get('/conversations/:id/plan', async (c) => {
  const id = getRequiredParam(c, 'id')
  const plan = await getActivePlanByConversationId(id)
  return successResponse(c, plan ? toPlanDto(plan.plan, plan.steps) : null)
})

// Knowledge base management moved to /api/v1/knowledge-base (Settings → Knowledge
// Base). Retrieval is bound as the `searchKnowledgeBase` tool for every
// employee loop via `bindCallingTools`.

// ─── Costs (philharmonic only) ──────────────────────────────────────────────────────

router.get('/costs', async (c) => {
  const rows = await getPhilharmonicCostRows()
  return successResponse(c, aggregateCosts(rows as never))
})

export default router
