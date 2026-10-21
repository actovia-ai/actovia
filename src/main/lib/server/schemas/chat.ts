import { EffortLevelSchema } from '@actovia/shared/schemas/settings-schema'
import { AdvancedTools, AiProviders } from '@actovia/shared/types/ai'
import { z } from 'zod'

// Chat routes schemas
export const createChatSchema = z.object({
  id: z.string(),
  messages: z.array(z.any()),
  advancedTools: z.array(z.enum(AdvancedTools))
})

/**
 * `PUT /api/v1/chat`: what a client may change of a chat — its title, its
 * star, its model (a provider and a model id together, or both null to
 * follow the default again). Anything else sent is dropped.
 */
export const updateChatSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().max(500).optional(),
    favorite: z.boolean().nullish(),
    provider: z.enum(AiProviders).nullish(),
    model: z.string().min(1).max(200).nullish()
  })
  .refine(
    (c) =>
      (c.provider === undefined) === (c.model === undefined) &&
      (c.provider === null) === (c.model === null),
    { message: 'provider and model are set together' }
  )

/** `POST /api/v1/chat/approval` — the answer to a paused tool call. */
export const approvalDecisionSchema = z.object({
  runId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(500),
  decision: z.enum(['allow', 'deny'])
})

/** `POST /api/v1/chat/:chatId/choose` — keep one answer of a regenerate group. */
export const chooseAttemptSchema = z.object({
  runId: z.uuid()
})

/** `GET /api/v1/chat/:id/page` (`chat/page.ts`): 10 runs unless asked. */
export const chatPageQuerySchema = z.object({
  runs: z.coerce.number().int().min(1).max(50).default(10),
  before: z.uuid().optional(),
  through: z.uuid().optional()
})

// pi-ai user message content
const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
})

const imageContentSchema = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string()
})

const userContentSchema = z.union([textContentSchema, imageContentSchema])

/** The new question of a send: a user message, its id the run's id. */
const userMessageSchema = z.looseObject({
  id: z.uuid('v4'),
  role: z.literal('user'),
  content: z.union([z.string(), z.array(userContentSchema)]),
  // A Regenerate names the group it re-asks (spec 2026-09-26).
  alternateOf: z.uuid().nullable().optional()
})

// For all messages (permissive — handles user, assistant, toolResult). Must be
// `looseObject`, not `object`: the chat route echoes the parsed history back to
// the renderer in the `done` SSE event, so a plain `object` (which drops
// unknown keys) would strip `details`/`toolCallId`/`toolName`/`isError` off
// every prior turn's messages — e.g. a webSearch turn would lose its citation
// sources the moment the next turn's `done` frame lands.
const messageSchema = z.looseObject({
  id: z.string(),
  // Stamped by the server (a user message's runId is its own id); a client
  // that sends it is echoing what it was given.
  runId: z.string().optional(),
  // On the new user message: the regenerate group it re-asks (spec
  // 2026-09-26). `attempt` may ride along on echoed history; the server's
  // stored state always wins over it.
  alternateOf: z.uuid().nullable().optional(),
  role: z.string(),
  content: z.any()
})

export const postRequestBodySchema = z
  .object({
    id: z.uuid('v4'),
    // The new question. The server reads the rest of the conversation from
    // the database (spec 2026-10-01 §C1).
    message: userMessageSchema.optional(),
    // An older client's whole conversation: only its last message — the new
    // question — is used.
    messages: z.array(messageSchema).optional(),
    advancedTools: z.array(z.enum(AdvancedTools)),
    reasoningEffort: EffortLevelSchema.optional(),
    // 2: `done` carries the run and the attempt states, for the client to
    // merge, instead of the whole conversation.
    protocol: z.literal(2).optional()
  })
  .refine((b) => b.message !== undefined || (b.messages?.length ?? 0) > 0, {
    message: 'A send carries the new message'
  })

export type PostRequestBody = z.infer<typeof postRequestBodySchema>
