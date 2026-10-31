import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import {
  NotFoundError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import { AdvancedTools } from '@actovia/shared/types/ai'
import type {
  ChatMessage,
  ChatUserMessage,
  ToolNotice
} from '@actovia/shared/types/chat'
import { runAttemptInfos, runsForContext } from '@actovia/shared/utils/attempts'
import type { Message } from '@earendil-works/pi-ai'
import { Hono } from 'hono'
import { z } from 'zod'

import { mcpDirectory } from '../../ai/calling-tools/mcp-toolbox'
import { LcmManager, freshTailRuns } from '../../ai/context-management'
import { ageToolOutput } from '../../ai/context-management/aging'
import type { ContextMessageKind } from '../../ai/context-management/context-assembler'
import { decideApproval } from '../../ai/kernel/pending-approvals'
import { RunRecorder } from '../../ai/kernel/record'
import { runAgent } from '../../ai/kernel/run'
import { getMcpTools } from '../../ai/mcp'
import {
  loadRelevantMemories,
  loadRunMemoryBlocks
} from '../../ai/memory/manager'
import { formatRunMemory, withRunMemory } from '../../ai/memory/run-memory'
import {
  buildPersonalityPrompt,
  deepResearchBootPrompt,
  getSystemPrompt
} from '../../ai/prompts'
import { trustedContextWindow } from '../../ai/providers/resolve-model'
import { getActiveSkillsIndex } from '../../ai/skills/skills-manager'
import {
  bindCallingTools,
  generateTitleFromUserMessage,
  getModelFromProvider,
  getTextFromMessage
} from '../../ai/utils/chat-message-util'
import { withFittedImages } from '../../ai/utils/image-fit'
import {
  chooseAttempt,
  getChatAttempts,
  recordRegenerate,
  resolveRegenerateGroup,
  settleOpenComparison
} from '../../chat/attempts'
import { settingsForChat } from '../../chat/chat-model'
import { measureContext } from '../../chat/context-snapshot'
import { loadChatHistory } from '../../chat/history'
import { loadChatPage, loadChatRow } from '../../chat/page'
import { highestSourceRank } from '../../chat/sources'
import type { MemoryRow } from '../../db/memory-queries'
import {
  deleteChatById,
  getChatById,
  getChatContextSnapshot,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  searchChats,
  updateChat,
  updateChatTitleById
} from '../../db/queries'
import { logger } from '../../logger'
import { stackFramesOf } from '../../logger/record'
import { bindTraceAttributes } from '../../logger/trace-context'
import { removeChatMedia } from '../../media/store'
import { getChatWorkspaceDir } from '../../paths'
import {
  approvalDecisionSchema,
  chatPageQuerySchema,
  chooseAttemptSchema,
  postRequestBodySchema,
  updateChatSchema
} from '../schemas/chat'
import { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  updateSuccessResponse,
  validateSchema
} from '../utils'
import { toFriendlyChatError } from './chat-errors'
import { stripId, toDbRow, withRunId } from './chat-persistence'
import { createSseWriter } from './chat-sse'

const chat = new Hono<{ Variables: Variables }>()

/** A tool's opt-in notice on its `details`, if it is well-formed. */
function noticeOf(details: unknown): ToolNotice | null {
  const n =
    details && typeof details === 'object' && 'notice' in details
      ? (details as { notice?: unknown }).notice
      : null
  return n &&
    typeof n === 'object' &&
    typeof (n as ToolNotice).message === 'string'
    ? (n as ToolNotice)
    : null
}

chat.get('/search', async (c) => {
  const query = c.req.query('query') ?? ''
  const result = await handleDatabaseOperation(
    () => searchChats(query),
    'Failed to search messages'
  )
  return successResponse(c, result)
})

/**
 * The user's answer to a paused tool call (`approval_required`). Behind the
 * presence gate: on loopback only the app's own window can answer, on the
 * LAN only a paired device — never a process the model started. Idempotent:
 * a repeat gets the outcome already recorded. 404 once nothing waits under
 * that id (unknown, timed out, or the run stopped).
 */
chat.post('/approval', async (c) => {
  const { runId, toolCallId, decision } = validateSchema(
    approvalDecisionSchema,
    await c.req.json(),
    'Invalid request body'
  )
  const outcome = decideApproval(runId, toolCallId, decision)
  if (!outcome) {
    throw new NotFoundError(
      ErrorCode.APPROVAL_NOT_FOUND,
      'Nothing is waiting for that approval.'
    )
  }
  logger.info('chat', 'Tool approval answered', {
    runId,
    toolCallId,
    outcome,
    via: c.get('deviceId') ? 'device' : 'app'
  })
  return successResponse(c, { outcome })
})

/**
 * Keep one answer of a regenerate group: `runId` → `chosen`, the other shown
 * answer → `folded` (`lib/chat/attempts.ts`). 404 `RUN_NOT_FOUND`, 409
 * `ATTEMPT_LOCKED` once a later run exists. Not behind the presence gate
 * (`PRESENCE_PATHS`): it only picks which of the user's own answers the model
 * sees next — no secret, no approval — and actovia-ios calls it over the LAN.
 */
chat.post('/:chatId/choose', async (c) => {
  const chatId = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'chatId'),
    'Invalid chat id'
  )
  const { runId } = validateSchema(
    chooseAttemptSchema,
    await c.req.json(),
    'Invalid request body'
  )
  const result = await chooseAttempt(chatId, runId)
  logger.info('chat', 'Regenerate attempt chosen', { chatId, runId })
  return successResponse(c, result)
})

/**
 * The history a page at a time (spec 2026-10-01 §C3, `chat/page.ts`): the
 * newest `runs` runs before `before` (a page's `olderCursor`), reaching back
 * through `through` when given, compacted; with every source and question of
 * the chat. `GET /:id` below stays: every row, whole.
 */
chat.get('/:id/page', async (c) => {
  const id = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'id'),
    'Invalid chat id'
  )
  const query = validateSchema(
    chatPageQuerySchema,
    c.req.query(),
    'Invalid page query'
  )
  return successResponse(c, await loadChatPage(id, query))
})

/** One row whole — what a page's `truncated` row stands for. */
chat.get('/:id/messages/:messageId', async (c) => {
  const id = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'id'),
    'Invalid chat id'
  )
  const messageId = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'messageId'),
    'Invalid message id'
  )
  return successResponse(c, await loadChatRow(id, messageId))
})

/**
 * What filled the chat's context on its last run that answered (ISSUE-235):
 * `ChatContextSnapshot`, or 404 `CONTEXT_NOT_FOUND` before any.
 */
chat.get('/:id/context', async (c) => {
  const id = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'id'),
    'Invalid chat id'
  )
  const snapshot = await handleDatabaseOperation(
    () => getChatContextSnapshot(id),
    'Failed to get the context snapshot'
  )
  if (!snapshot) {
    throw new NotFoundError(
      ErrorCode.CONTEXT_NOT_FOUND,
      'This chat has run nothing yet.'
    )
  }
  return successResponse(c, snapshot)
})

chat.get('/:id', async (c) => {
  const id = validateSchema(
    z.uuid(),
    getRequiredParam(c, 'id'),
    'Invalid chat id'
  )
  const messages = await handleDatabaseOperation(
    () => getMessagesByChatId({ id }),
    'Failed to get messages'
  )
  return successResponse(c, messages)
})

chat.post('/', async (c) => {
  const { id, message, messages, advancedTools, reasoningEffort, protocol } =
    validateSchema(
      postRequestBodySchema,
      await c.req.json(),
      'Invalid request body'
    )
  bindTraceAttributes({ chatId: id })
  // The chat answers with its own model (`chat.provider` / `chat.model`);
  // one older than those columns, or a new one, with the default.
  const existingChat = await getChatById({ id })
  const setting = settingsForChat(c.get('settings'), existingChat)
  const { model, apiKey } = getModelFromProvider(setting)

  // The new question: `message`, or the last of an older client's whole
  // conversation (the rest of which is not used — the server reads its own,
  // below). Its id names the run every message it produces belongs to.
  const last = (message ?? messages?.at(-1)) as unknown as ChatMessage
  if (last.role !== 'user') {
    throw new ValidationError(
      ErrorCode.VALIDATION_NO_USER_MESSAGE,
      'The last message must be the user prompt'
    )
  }
  // A Regenerate names the group it re-asks (`alternateOf`); any `attempt`
  // the client sent is dropped — only lib/chat/attempts.ts sets one.
  const {
    alternateOf: requestedGroup,
    attempt: _clientAttempt,
    ...prompt
  } = last as ChatUserMessage
  // Resolved to the group's first run (404 before anything is written).
  const regenerateOf = requestedGroup
    ? await resolveRegenerateGroup(id, requestedGroup)
    : null
  // Stamped here, not by the client: every read orders by `createdAt`, and a
  // phone whose clock was off sorted its question before earlier answers.
  // Pictures past the shared limits are fitted before the row is saved
  // (`withFittedImages`): the clients prepare their own, this catches the rest.
  const userMessage: ChatUserMessage = withRunId(
    withFittedImages({
      ...(regenerateOf ? { ...prompt, alternateOf: regenerateOf } : prompt),
      timestamp: Date.now()
    }),
    last.id
  )

  // Create chat record if new, keeping the model it starts with: a later
  // change of the default in Settings leaves this chat as it is.
  let titlePromise: Promise<string> | null = null
  if (!existingChat) {
    await saveChat({
      id,
      title: 'New chat',
      provider: setting.providerConfig?.provider ?? null,
      model: setting.providerConfig?.model ?? null
    })
    titlePromise = generateTitleFromUserMessage({
      message: userMessage,
      model,
      apiKey
    })
  }

  const memoryConfig = setting.memory
  const lcmEnabled = memoryConfig?.lcmEnabled !== false
  // Two independent switches: capture new memories vs. surface them into chats.
  const memoryCapture = memoryConfig?.autoCapture !== false
  const memoryUseInChat = memoryConfig?.useInChat !== false

  // ── PRE-CHAT: run independent tasks in parallel ─────────────────────────
  // 1. Save user message (fire-and-forget — ID already generated)
  // 2. Assemble LCM context (or fallback to client messages)
  // 3. Load relevant memories (LLM call to filter)
  // 4. Fetch MCP tools
  // All four are independent and can run concurrently.

  // Single LcmManager instance — reused for post-chat compaction
  const lcm = lcmEnabled
    ? new LcmManager(id, model, apiKey, {
        freshTailRuns: freshTailRuns(memoryConfig),
        contextWindowPercent:
          memoryConfig?.contextWindowPercent ??
          SETTING_DEFAULTS.memory.contextWindowPercent,
        contextWindow: trustedContextWindow(model)
      })
    : null

  // Regenerate groups settle before any context is assembled, so the model
  // never sees the answer a Regenerate replaces nor both sides of an open
  // comparison. A Regenerate needs its own row saved first (the transition
  // writes it); an ordinary run's row is saved alongside the rest below.
  let saveUserMsgPromise: Promise<unknown>
  if (regenerateOf) {
    await saveMessages({ messages: [toDbRow(userMessage, id)] })
    await recordRegenerate(id, userMessage.id, regenerateOf)
    userMessage.attempt = 'comparing'
    saveUserMsgPromise = Promise.resolve()
  } else {
    await settleOpenComparison(id)
    saveUserMsgPromise = saveMessages({
      messages: [toDbRow(userMessage, id)]
    })
  }
  /** The conversation as stored — every regenerate group's state settled
   *  above — then the prompt, stamped. Read from the database, never from
   *  what a client posts (spec 2026-10-01 §C1). A Regenerate's own row is
   *  already saved; it is the prompt here, not history. */
  const history: ChatMessage[] = [
    ...(await loadChatHistory(id)).filter((m) => m.id !== userMessage.id),
    userMessage
  ]
  // What the model is sent leaves out the runs a regenerate group keeps
  // from it: the answers not kept and, for a Regenerate, every other attempt
  // at its question (`excludedRuns`). With LCM the assembler reads the states
  // from the database; without, they are the ones just put on `history`.
  const currentRun = { runId: userMessage.id, alternateOf: regenerateOf }
  // Each path also says which message is which run's question (`heads`),
  // where that run's memory block goes (`withRunMemory` below).
  const lcmPromise: Promise<{
    messages: Message[]
    heads: (string | null)[]
    kinds: ContextMessageKind[]
  }> = lcm
    ? lcm
        .trackNewMessages([
          { id: userMessage.id, content: userMessage.content }
        ])
        .then(() => lcm.assembleContext(currentRun))
        .then((assembled) => ({
          messages: assembled.messages.slice(0, -1),
          heads: (assembled.runHeads ?? []).slice(0, -1),
          kinds: (assembled.kinds ?? []).slice(0, -1)
        }))
    : Promise.resolve(
        runsForContext(
          history.slice(0, -1),
          runAttemptInfos(history),
          currentRun
        )
      ).then((runs) => ({
        messages: runs.map(stripId),
        heads: runs.map((m) =>
          m.role === 'user' && m.id === m.runId ? m.runId : null
        ),
        kinds: runs.map((): ContextMessageKind => 'message')
      }))

  // Deep Research runs on its own boot prompt, which carries no
  // `<user_memory>` block — so it gets no read filter either: no LLM call,
  // no usage-log rows, no `lastUsedAt` bump and no `memories_used` claiming
  // memories the reply never saw.
  const isDeepResearch =
    advancedTools?.includes(AdvancedTools.DeepResearch) ?? false
  const memoryPromise: Promise<MemoryRow[]> =
    memoryUseInChat && !isDeepResearch
      ? loadRelevantMemories(
          getTextFromMessage(userMessage),
          model,
          apiKey,
          id,
          userMessage.id
        ).catch((err) => {
          logger.warn('chat', 'Memory loading failed, continuing without', {
            error: err
          })
          return []
        })
      : Promise.resolve([])

  // The memory blocks of the runs before this one, as the entries read now.
  const runMemoryPromise: Promise<Map<string, string>> =
    memoryUseInChat && !isDeepResearch
      ? loadRunMemoryBlocks(id).catch((err) => {
          logger.warn('chat', 'Run memory loading failed, continuing without', {
            error: err
          })
          return new Map<string, string>()
        })
      : Promise.resolve(new Map<string, string>())

  const mcpPromise = getMcpTools()
  // Sources are numbered through the chat, not per run.
  const sourceRankPromise = highestSourceRank(id)

  const [assembledContext, memoryRows, , mcpTools, runMemory, sourceRankBase] =
    await Promise.all([
      lcmPromise,
      memoryPromise,
      saveUserMsgPromise,
      mcpPromise,
      runMemoryPromise,
      sourceRankPromise
    ])
  // Each run's memory goes before its question, never into the system prompt:
  // chosen afresh for every message, it changed the system prompt every time,
  // and with it the whole cached prefix (`run-memory.ts`).
  const thisRunMemory = formatRunMemory(memoryRows)
  const promptWithMemory = withRunMemory(userMessage, thisRunMemory)

  const tools = bindCallingTools({
    advancedTools,
    setting,
    chatModel: model,
    apiKey,
    mcpTools,
    chatId: id,
    sourceRankBase,
    interactive: !c.get('scheduled')
  })
  // The runs before this one carry a digest of each tool's output instead
  // of all of it (`aging.ts`) — only while `recall`, which every digest
  // names as the way back to the full form, is there to call.
  const { heads } = assembledContext
  const aged = tools.some((t) => t.name === TOOL_NAMES.recall)
    ? ageToolOutput(assembledContext.messages, heads)
    : assembledContext.messages
  const contextMessages = aged.map((m, i) => {
    const head = heads[i]
    return head ? withRunMemory(m, runMemory.get(head) ?? '') : m
  })
  const personalityPrompt = buildPersonalityPrompt(setting)
  const skillsIndex = await getActiveSkillsIndex()
  logger.info('chat', 'skill injection', {
    deepResearch: isDeepResearch,
    skills: skillsIndex ? skillsIndex.split('\n').length : 0
  })
  const directory = mcpDirectory(mcpTools)
  const systemContent = isDeepResearch
    ? deepResearchBootPrompt
    : getSystemPrompt({
        mcpDirectory: directory,
        workspaceDir: getChatWorkspaceDir(id),
        skillsIndex
      }) + personalityPrompt

  // What fills this request, part by part (ISSUE-235): the recorder scales
  // it to the provider's input and saves it as the chat's context snapshot.
  // Under LCM, the window and mark it compacts against (its fallback when
  // the model's window is unknown or a guess); without it, the known window.
  const contextWindow = lcm ? lcm.contextWindow : trustedContextWindow(model)
  const contextParts = measureContext({
    systemPrompt: systemContent,
    skillsIndex: isDeepResearch ? '' : skillsIndex,
    mcpDirectory: isDeepResearch ? '' : directory,
    tools,
    memoryTexts: [
      thisRunMemory,
      ...heads.map((head) => (head ? (runMemory.get(head) ?? '') : ''))
    ],
    messages: [...contextMessages, promptWithMemory],
    kinds: [...assembledContext.kinds, 'message']
  })

  // Deep Research forces a strong reasoning effort regardless of what the
  // composer's picker requested. pi's ThinkingLevel has every tier of the
  // app's EffortLevel but 'off', which is "no reasoning option".
  const effectiveReasoning = isDeepResearch
    ? 'high'
    : reasoningEffort && reasoningEffort !== 'off'
      ? reasoningEffort
      : undefined

  // Tools a call to which the kernel blocks before it runs — the binder
  // does not bind them either; this covers a setting changed mid-run and
  // the model naming a tool it was not given.
  const disabledTools = new Set(setting.tools?.disabledTools ?? [])
  if (!setting.computerUse?.enabled) disabledTools.add(TOOL_NAMES.computerUse)

  const recorder = new RunRecorder({
    chatId: id,
    model,
    lcm: lcm
      ? {
          freshTailRuns: freshTailRuns(memoryConfig),
          contextWindowPercent:
            memoryConfig?.contextWindowPercent ??
            SETTING_DEFAULTS.memory.contextWindowPercent
        }
      : null,
    memoryCapture,
    context: {
      parts: contextParts,
      contextWindow,
      compactAt: lcm ? lcm.tokenBudget : null,
      model: model.id,
      runId: userMessage.id
    }
  })

  // The run streams as SSE: every kernel event maps onto one wire event
  // (shapes unchanged; every message carries `runId`).
  const stream = new ReadableStream({
    async start(controller) {
      const sse = createSseWriter(controller)
      // Sent once, before any kernel event, and only when the read filter
      // actually selected something — a chat with memory off or nothing
      // relevant sends no event at all.
      if (memoryRows.length > 0) {
        sse.send({
          type: 'memories_used',
          runId: userMessage.id,
          memories: memoryRows.map(({ id, key, section }) => ({
            id,
            key,
            section
          }))
        })
      }
      try {
        const events = runAgent({
          chatId: id,
          // The kernel's copy carries this run's memory; the row saved and the
          // history echoed in `done` are the question alone.
          userMessage: promptWithMemory,
          systemPrompt: systemContent,
          contextMessages,
          tools,
          model,
          apiKey,
          reasoning: effectiveReasoning,
          signal: c.req.raw.signal,
          approvalTimeoutMs: c.get('scheduled') ? 0 : undefined,
          disabledTools,
          workspaceDir: getChatWorkspaceDir(id)
        })
        for await (const event of events) {
          recorder.observe(event)
          switch (event.type) {
            case 'message_update':
              // Coalesced, not sent per delta — see STREAM_FLUSH_INTERVAL_MS.
              sse.queueUpdate(event.message)
              break
            case 'message_end':
              // The last deltas may still be waiting on the flush interval.
              sse.flush()
              break
            case 'tool_start':
              sse.send({
                type: 'tool_call_start',
                toolCallId: event.toolCallId,
                toolName: event.toolName
              })
              break
            case 'tool_update':
              sse.send({ type: 'message_update', message: event.message })
              break
            case 'tool_end': {
              sse.send({ type: 'message_update', message: event.message })
              // A non-fatal tool notice (e.g. an expired API key that only
              // degraded enrichment — the tool still succeeded), so the
              // renderer can toast it. Tools opt in via `details.notice`.
              const notice = noticeOf(event.message.details)
              if (notice) {
                sse.send({
                  type: 'notice',
                  level: notice.level === 'info' ? 'info' : 'warning',
                  message: notice.message
                })
              }
              sse.send({
                type: 'tool_call_end',
                toolCallId: event.message.toolCallId,
                toolName: event.message.toolName,
                isError: event.message.isError
              })
              break
            }
            case 'run_end':
              if (titlePromise) {
                const title = await titlePromise
                sse.send({ type: 'title', title })
                updateChatTitleById({ id, title }).catch((err) => {
                  logger.error('chat', 'Failed to persist chat title', {
                    chatId: id,
                    error: err
                  })
                })
              }
              // Protocol 2: the run (its question as stored, then its
              // answer) and every regenerate group's state, which the client
              // merges. Otherwise the whole conversation, as before.
              sse.send(
                protocol === 2
                  ? {
                      type: 'done',
                      messages: [userMessage, ...event.messages],
                      attempts: await getChatAttempts(id)
                    }
                  : {
                      type: 'done',
                      messages: [...history, ...event.messages]
                    }
              )
              break
            case 'approval_required':
              // The path or command only — never contents. The run waits;
              // any client may answer (the window, or a paired phone).
              sse.send({
                type: 'approval_required',
                runId: event.runId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                summary: event.summary,
                ...(event.truncated
                  ? { truncated: true, hiddenChars: event.hiddenChars }
                  : {}),
                expiresAt: event.expiresAt
              })
              break
            case 'approval_resolved':
              sse.send({
                type: 'approval_resolved',
                runId: event.runId,
                toolCallId: event.toolCallId,
                outcome: event.outcome
              })
              break
            case 'error':
              logger.error('chat', 'Chat stream error', { error: event.error })
              sse.send({
                type: 'error',
                error: toFriendlyChatError(event.error)
              })
              break
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        // The Error itself: its stack is what says which line threw.
        logger.error('chat', 'Chat stream error', { error: err })
        sse.send({ type: 'error', error: toFriendlyChatError(raw) })
      } finally {
        // Runs however the run ended — done, a provider error midway, or Stop
        // (the client hung up, and the next write threw): the steps that
        // completed are saved. The stream stays open until the rows are
        // written.
        await recorder.persist().catch((error) => {
          logger.error('chat', 'Failed to persist chat run', {
            chatId: id,
            errorName: error instanceof Error ? error.name : typeof error,
            'exception.stacktrace': stackFramesOf(error)
          })
        })
        sse.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  })
})

chat.delete('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')

  await handleDatabaseOperation(
    () => deleteChatById({ id }),
    'Failed to delete chat'
  )

  // Best-effort: the chat is gone either way.
  await removeChatMedia(id)

  return deletionSuccessResponse(c, 'Chat')
})

chat.put('/', async (c) => {
  const payload = validateSchema(
    updateChatSchema,
    await c.req.json(),
    'Invalid request body'
  )

  if (!payload.id) {
    throw new NotFoundError(ErrorCode.CHAT_NOT_FOUND, 'Chat ID is required')
  }

  await handleDatabaseOperation(
    () => updateChat(payload),
    'Failed to update chat'
  )

  return updateSuccessResponse(c, 'chat', payload.id)
})

export default chat
