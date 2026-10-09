import { ConflictError, ErrorCode, NotFoundError } from '@exodus/shared'
import {
  CLI_IDS,
  type AgentCard,
  type CliId
} from '@exodus/shared/types/agents'
import { shell } from 'electron'
import { Hono } from 'hono'
import { z } from 'zod'

import { getCliStatus } from '../../agents/cli-check'
import { ensureDefaultCliEmployees } from '../../agents/default-employees'
import { resetLoginShellEnv } from '../../agents/login-shell'
import { agentRegistry } from '../../agents/registry'
import { openInTerminal } from '../../agents/terminal'
import {
  getAgentSession,
  updateAgentSession
} from '../../db/agent-session-queries'
import {
  getConversationMessageById,
  updateConversationMessageParts
} from '../../db/conversation-queries'
import type { Variables } from '../types'
import { getRequiredParam, successResponse, validateSchema } from '../utils'
import { emitToConversation } from './philharmonic-sse'

const AnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }),
  z.object({
    kind: z.literal('deny'),
    reason: z.string().max(2000).optional()
  }),
  z.object({
    kind: z.literal('answers'),
    answers: z.record(z.string(), z.string())
  })
])

const router = new Hono<{ Variables: Variables }>()

router.get('/clis', async (c) =>
  successResponse(c, await Promise.all(CLI_IDS.map((id) => getCliStatus(id))))
)

router.post('/clis/:id/check', async (c) => {
  const id = getRequiredParam(c, 'id') as CliId
  if (!CLI_IDS.includes(id)) throw new NotFoundError()
  resetLoginShellEnv()
  const status = await getCliStatus(id, { refresh: true })
  if (status.state === 'ready')
    await ensureDefaultCliEmployees().catch(() => {})
  return successResponse(c, status)
})

router.post('/sessions/:id/respond', async (c) => {
  const id = getRequiredParam(c, 'id')
  const { requestId, answer } = validateSchema(
    z.object({ requestId: z.string().min(1), answer: AnswerSchema }),
    await c.req.json(),
    'Invalid answer'
  )
  const run = agentRegistry.bySession(id)
  if (!run || !run.respond(requestId, answer))
    throw new ConflictError(ErrorCode.AGENT_PROMPT_GONE)
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/interrupt', async (c) => {
  const run = agentRegistry.bySession(getRequiredParam(c, 'id'))
  if (!run || !run.interrupt())
    throw new ConflictError(ErrorCode.AGENT_NOT_RUNNING)
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/terminal', async (c) => {
  const id = getRequiredParam(c, 'id')
  const session = await getAgentSession(id)
  if (!session?.cliSessionId) throw new NotFoundError()
  const status = await getCliStatus('claude-code')
  if (!status.path) throw new ConflictError(ErrorCode.AGENT_NOT_RUNNING)
  // Never two drivers on one session: Exodus lets go first.
  await agentRegistry.stopSession(id)
  await openInTerminal(session.cwd, status.path, session.cliSessionId)
  await updateAgentSession(id, { continuedInTerminal: true })
  // The persisted card says so too, and an open group sees it at once.
  if (session.messageId) {
    const message = await getConversationMessageById(session.messageId)
    const card = message?.parts?.find((p) => p.kind === 'agent_card') as
      | AgentCard
      | undefined
    if (card) {
      const next = { ...card, continuedInTerminal: true }
      await updateConversationMessageParts(session.messageId, [next as never])
      emitToConversation(session.conversationId, {
        type: 'agent_card',
        conversationId: session.conversationId,
        messageId: session.messageId,
        card: next
      })
    }
  }
  return successResponse(c, { success: true })
})

router.post('/sessions/:id/open-folder', async (c) => {
  const session = await getAgentSession(getRequiredParam(c, 'id'))
  if (!session) throw new NotFoundError()
  await shell.openPath(session.cwd)
  return successResponse(c, { success: true })
})

export default router
