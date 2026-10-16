import {
  ConflictError,
  ErrorCode,
  NotFoundError,
  ValidationError
} from '@exodus/shared'
import {
  CLI_IDS,
  CLI_NAMES,
  type AgentCard,
  type CliId
} from '@exodus/shared/types/agents'
import { shell } from 'electron'
import { Hono } from 'hono'
import { z } from 'zod'

import { getCliStatus } from '../../agents/cli-check'
import { ensureDefaultCliEmployees } from '../../agents/default-employees'
import { DRIVERS, isCliId } from '../../agents/drivers'
import { resetLoginShellEnv } from '../../agents/login-shell'
import { listQuotas } from '../../agents/quota'
import { agentRegistry } from '../../agents/registry'
import {
  isCliSessionId,
  openInTerminal,
  writeResumeScript
} from '../../agents/terminal'
import {
  getAgentSession,
  updateAgentSession
} from '../../db/agent-session-queries'
import {
  getConversationMessageById,
  updateConversationMessageParts
} from '../../db/conversation-queries'
import { desktopOnly } from '../middlewares/desktop-only'
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
    answers: z
      .record(
        z.string().max(500),
        z.union([z.string().max(4000), z.array(z.string().max(4000)).max(20)])
      )
      .refine((a) => Object.keys(a).length <= 20, 'Too many answers')
  })
])

const router = new Hono<{ Variables: Variables }>()

router.get('/clis', async (c) =>
  successResponse(c, await Promise.all(CLI_IDS.map((id) => getCliStatus(id))))
)

router.get('/quota', (c) => successResponse(c, listQuotas()))

router.post('/clis/:id/check', desktopOnly, async (c) => {
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
    z.object({
      requestId: z.string().min(1).max(200),
      answer: AnswerSchema
    }),
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

router.post('/sessions/:id/terminal', desktopOnly, async (c) => {
  const id = getRequiredParam(c, 'id')
  const { messageId } = validateSchema(
    z.object({ messageId: z.string().uuid() }),
    await c.req.json().catch(() => ({})),
    'Invalid card'
  )
  const session = await getAgentSession(id)
  if (!session?.cliSessionId) throw new NotFoundError()
  if (!isCliId(session.runtime))
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'This session has no coding-agent CLI'
    )
  const cli = session.runtime
  // Only the session's current card, and never while it works: taking the
  // session over would stop a newer step the owner did not mean to stop.
  if (agentRegistry.bySession(id)?.busy || session.messageId !== messageId)
    throw new ConflictError(
      ErrorCode.AGENT_NOT_RUNNING,
      `${CLI_NAMES[cli]} is working on a newer step; wait for it to finish.`
    )
  if (!isCliSessionId(session.cliSessionId))
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      `Invalid ${CLI_NAMES[cli]} session`
    )
  const status = await getCliStatus(cli)
  if (!status.path) throw new ConflictError(ErrorCode.AGENT_NOT_RUNNING)
  // Never two drivers on one session: Exodus lets go first — and only then is
  // the script written, in Exodus' own data where no agent can edit it.
  await agentRegistry.stopSession(session.id)
  const scriptPath = await writeResumeScript(
    session.cwd,
    status.path,
    DRIVERS[cli].resumeArgs(session.cliSessionId)
  )
  await openInTerminal(scriptPath)
  await updateAgentSession(session.id, { continuedInTerminal: true })
  // The persisted card says so too, and an open group sees it at once.
  if (session.messageId) {
    const message = await getConversationMessageById(session.messageId)
    const parts = (message?.parts ?? []) as Array<Record<string, unknown>>
    const index = parts.findIndex((p) => p.kind === 'agent_card')
    if (index !== -1) {
      const next = {
        ...(parts[index] as unknown as AgentCard),
        continuedInTerminal: true
      }
      const all = [...parts]
      all[index] = next as never
      await updateConversationMessageParts(session.messageId, all)
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

router.post('/sessions/:id/open-folder', desktopOnly, async (c) => {
  const session = await getAgentSession(getRequiredParam(c, 'id'))
  if (!session) throw new NotFoundError()
  await shell.openPath(session.cwd)
  return successResponse(c, { success: true })
})

export default router
