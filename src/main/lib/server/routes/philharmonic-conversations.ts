// src/main/lib/server/routes/philharmonic-conversations.ts
import { NotFoundError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import { agentRegistry } from '../../agents/registry'
import { stopBackgroundTasks } from '../../ai/calling-tools/start-background'
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
import { getConversationToolResults } from '../../db/philharmonic-queries'
import { getActivePlanByConversationId } from '../../db/plan-queries'
import { listRoundEvents } from '../../db/pm-round-queries'
import { mainT } from '../../i18n'
import { logger } from '../../logger'
import { removeGroupMedia } from '../../media/store'
import { getGroupDir } from '../../paths'
import type { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'
import { emitToConversation, sseManager } from './philharmonic-sse'

const router = new Hono<{ Variables: Variables }>()

router.get('/conversations/:id/tool-results', async (c) =>
  successResponse(
    c,
    await getConversationToolResults(getRequiredParam(c, 'id'))
  )
)

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
  askUserRegistry.cancel(id)
  stopBackgroundTasks(getGroupDir(id))
  await agentRegistry.stopConversation(id)
  await handleDatabaseOperation(
    () => deleteConversation(id),
    'Failed to delete conversation'
  )
  await removeGroupMedia(id)
  // A client still watching the group (the phone) is told by its stream
  // ending: its reconnect then finds the group gone.
  sseManager.closeTopic(id)
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

  // One Group gets one PM round at a time. Owner messages are persisted above,
  // then run in arrival order after the active round finishes.
  void pmRunRegistry
    .run(id, (signal) =>
      runPmCoordinator({
        conversationId: id,
        userText: body.content,
        attachments,
        excludeMessageId: userMsg.id,
        emit: (event) => emitToConversation(id, event),
        signal
      })
    )
    .catch((err) =>
      logger.error('philharmonic', 'PM loop error', { error: err })
    )

  return successResponse(c, userMsg, 201)
})

// Abort the currently-running PM for a conversation, if any. Idempotent —
// returns wasRunning: false when there's nothing to abort.
router.post('/conversations/:id/interrupt', async (c) => {
  const id = getRequiredParam(c, 'id')
  const wasRunning = pmRunRegistry.abort(id)
  askUserRegistry.cancel(id)
  return successResponse(c, { success: true, wasRunning })
})

// Resolve a pending askUser.
router.post('/conversations/:id/respond', async (c) => {
  const id = getRequiredParam(c, 'id')
  const { response, questionId } = validateSchema(
    z.object({ response: z.string(), questionId: z.string().optional() }),
    await c.req.json(),
    'Invalid response'
  )
  const accepted = await askUserRegistry.answer(
    id,
    response,
    questionId,
    async () => {
      await createConversationMessage({
        conversationId: id,
        role: 'user',
        content: response
      })
    }
  )
  if (!accepted)
    return c.json(
      {
        type: 'error',
        error: {
          code: 'UNKNOWN_ERROR',
          message: mainT(
            'errors:questionNoLongerWaiting',
            'This question is no longer waiting for an answer.'
          ),
          hasCustomMessage: true
        }
      },
      409
    )
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

export default router
