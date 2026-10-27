// src/main/lib/server/routes/philharmonic-conversations.ts
import { NotFoundError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import { agentRegistry } from '../../agents/registry'
import { askUserRegistry } from '../../ai/philharmonic/ask-user-registry'
import { toPlanDto } from '../../ai/philharmonic/plan-dto'
import { runPmCoordinator } from '../../ai/philharmonic/pm-coordinator'
import { pmRunRegistry } from '../../ai/philharmonic/pm-run-registry'
import { fitImageDataUrl } from '../../ai/utils/image-fit'
import {
  createConversation,
  createConversationMessage,
  deleteConversation,
  getAllConversations,
  getLatestMessagePerConversation,
  getMessagesAfter,
  getMessagesByConversationId,
  updateConversation
} from '../../db/conversation-queries'
import { getPhilharmonicCostRows } from '../../db/philharmonic-queries'
import { getActivePlanByConversationId } from '../../db/plan-queries'
import { getPmCostRows, listRoundEvents } from '../../db/pm-round-queries'
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
    /** A CLI employee: `cost` is the CLI's API-price estimate, not spend. */
    estimated?: boolean
  } | null
  startedAt: Date
}

/** One PM round's usage (`pm_round_event`, kind `usage`). */
export interface PmCostRow {
  conversationId: string
  tokens: number
  cost: number
  createdAt: Date
}

interface Figures {
  cost: number
  /** What CLI employees' runs would have cost at API prices — not spent. */
  estimatedCost: number
  tokens: number
}

export interface PhilharmonicCostSummary {
  totalCost: number
  estimatedCost: number
  totalTokens: number
  byConversation: Array<{ conversationId: string } & Figures>
  byAgent: Array<{ agentId: string } & Figures>
  /** The PM's own rounds. */
  pm: { cost: number; tokens: number }
  daily: Array<{ date: string } & Figures>
}

const zero = (): Figures => ({ cost: 0, estimatedCost: 0, tokens: 0 })

function add(
  map: Map<string, Figures>,
  key: string,
  cost: number,
  estimatedCost: number,
  tokens: number
) {
  const f = map.get(key) ?? zero()
  f.cost += cost
  f.estimatedCost += estimatedCost
  f.tokens += tokens
  map.set(key, f)
}

/**
 * Pure aggregation — unit tested. Employees' executions and the PM's rounds;
 * a CLI employee's dollar figure is an estimate, kept apart (ISSUE-132).
 */
export function aggregateCosts(
  rows: CostRow[],
  pmRows: PmCostRow[] = []
): PhilharmonicCostSummary {
  const total = zero()
  const pm = { cost: 0, tokens: 0 }
  const conv = new Map<string, Figures>()
  const agent = new Map<string, Figures>()
  const day = new Map<string, Figures>()

  const count = (
    conversationId: string | null,
    agentId: string | null,
    at: Date,
    cost: number,
    estimatedCost: number,
    tokens: number
  ) => {
    total.cost += cost
    total.estimatedCost += estimatedCost
    total.tokens += tokens
    if (conversationId) add(conv, conversationId, cost, estimatedCost, tokens)
    if (agentId) add(agent, agentId, cost, estimatedCost, tokens)
    // The user's day, not the UTC one: the chart labels it as a local date.
    add(day, localDateStr(at), cost, estimatedCost, tokens)
  }

  for (const r of rows) {
    const u = r.tokenUsage
    if (!u) continue
    const tokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
    const cost = u.cost ?? 0
    if (u.estimated)
      count(r.conversationId, r.agentId, r.startedAt, 0, cost, tokens)
    else count(r.conversationId, r.agentId, r.startedAt, cost, 0, tokens)
  }
  for (const r of pmRows) {
    pm.cost += r.cost
    pm.tokens += r.tokens
    count(r.conversationId, null, r.createdAt, r.cost, 0, r.tokens)
  }

  return {
    totalCost: total.cost,
    estimatedCost: total.estimatedCost,
    totalTokens: total.tokens,
    byConversation: [...conv.entries()].map(([conversationId, v]) => ({
      conversationId,
      ...v
    })),
    byAgent: [...agent.entries()].map(([agentId, v]) => ({ agentId, ...v })),
    pm,
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

// `?after=<messageId>`: only the rows saved after that one (404 when it is not
// a row of the group). For the re-read after a `message_end` — rows can change
// after they are saved, so a client that (re)connects reads them all.
router.get('/conversations/:id/messages', async (c) => {
  const id = getRequiredParam(c, 'id')
  const after = c.req.query('after')
  if (!after) return successResponse(c, await getMessagesByConversationId(id))
  const rows = await getMessagesAfter(id, after)
  if (!rows) throw new NotFoundError()
  return successResponse(c, rows)
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
  // A picture is a data URL, as in Chat: a link would reach the model as if it
  // were image data (`bareImageData` in the PM's user content).
  const attachmentSchema = z
    .object({
      name: z.string(),
      url: z.string(),
      contentType: z.string()
    })
    .refine(
      (a) =>
        !a.contentType.startsWith('image/') || a.url.startsWith('data:image/'),
      { message: 'An image attachment must be a data URL' }
    )
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
  // Fitted once, before the row is saved, with Chat's rules
  // (`withFittedImages`), so a stored row never changes afterwards.
  const attachments = body.attachments?.map((a) =>
    a.contentType.startsWith('image/')
      ? { ...a, ...fitImageDataUrl(a.url, a.contentType) }
      : a
  )
  const parts = attachments?.map((a) => ({
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
    attachments,
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

// `?days=7|30`: today and the days before it, by the local day the chart
// buckets on (`localDateStr`); without it, all time.
router.get('/costs', async (c) => {
  const raw = c.req.query('days')
  const days =
    raw === undefined
      ? undefined
      : validateSchema(
          z.enum(['7', '30']).transform(Number),
          raw,
          'Invalid period'
        )
  let since: Date | undefined
  if (days) {
    since = new Date()
    since.setHours(0, 0, 0, 0)
    since.setDate(since.getDate() - (days - 1))
  }
  const [rows, pmRows] = await Promise.all([
    getPhilharmonicCostRows(since),
    getPmCostRows(since)
  ])
  return successResponse(c, aggregateCosts(rows as never, pmRows))
})

export default router
