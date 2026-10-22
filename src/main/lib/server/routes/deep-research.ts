import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { NotFoundError } from '@actovia/shared/errors/app-error'
import {
  DeepResearchProgress,
  ReportProgressPayload
} from '@actovia/shared/types/deep-research'
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js'
import { Hono } from 'hono'
import { v4 as uuidV4 } from 'uuid'

import { settleDeepResearchResult } from '../../ai/deep-research/chat-result'
import { deepResearch as deepResearchAgent } from '../../ai/deep-research/deep-research'
import { writeFinalReport } from '../../ai/deep-research/final-report'
import { getModelFromProvider } from '../../ai/utils/chat-message-util'
import {
  getDeepResearchById,
  getDeepResearchMessagesById,
  saveDeepResearchMessage,
  updateDeepResearch
} from '../../db/queries'
import type { DeepResearch, Settings } from '../../db/schema'
import { logger } from '../../logger'
import { stackFramesOf } from '../../logger/record'
import { bindTraceAttributes } from '../../logger/trace-context'
import { scrubSecrets } from '../../secrets/scrub'
import { createDeepResearchSchema } from '../schemas/deep-research'
import { Variables } from '../types'
import {
  getRequiredQuery,
  handleDatabaseOperation,
  successResponse,
  validateBraveApiKey,
  validateSchema
} from '../utils'
import { SSE_HEADERS, SseManager } from '../utils/sse-manager'

const deepResearch = new Hono<{ Variables: Variables }>()
const sseManager = new SseManager<string>()

/** A stored error message this long is already more than enough to diagnose. */
const MAX_ERROR_MESSAGE_LENGTH = 300

/**
 * The error a failed job stores: the thrown value's class and message only —
 * never a whole provider response, and scrubbed of any secret this request
 * held (a provider API key, the Brave key) in case the error text echoed it
 * back (e.g. a proxy or gateway quoting the failed request). Clipped so one
 * runaway message can't bloat the row.
 */
export function summarizeDeepResearchError(
  error: unknown,
  secrets: readonly string[]
): string {
  const err = error instanceof Error ? error : new Error(String(error))
  const raw = `${err.constructor.name}: ${err.message || 'unknown error'}`
  const scrubbed = scrubSecrets(raw, secrets)
  return scrubbed.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${scrubbed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : scrubbed
}

async function notifyClients(
  deepResearchId: string,
  data: ReportProgressPayload
) {
  const message: JSONRPCNotification = {
    jsonrpc: '2.0',
    method: 'message/deep-research',
    params: { data }
  }

  const deepResearchMessage = {
    id: uuidV4(),
    deepResearchId,
    message,
    createdAt: new Date()
  }

  await saveDeepResearchMessage(deepResearchMessage)

  if (!sseManager.hasClients(deepResearchId)) return

  const payload = sseManager.encodeEvent(
    deepResearchMessage as unknown as Record<string, unknown>
  )
  sseManager.emitRaw(deepResearchId, payload)
}

/**
 * Runs one deep research job to its end and returns the row as it ends:
 * `archived` with the report, or `failed` with a short, scrubbed message —
 * whatever step threw, a missing key or model included. Rejects only when the
 * failure itself could not be saved. The `deep_research` tool calls it in
 * process (an HTTP request to our own port could fail before the job began,
 * leaving it `streaming` with nothing to end it); `POST /` is the same job.
 */
/** The outcome into the chat's tool result; a failure here is only logged. */
async function settleChatResult(deepResearchId: string) {
  await settleDeepResearchResult(deepResearchId).catch((error: unknown) => {
    logger.error('deep-research', 'Failed to write the outcome into the chat', {
      deepResearchId,
      error
    })
  })
}

export async function runDeepResearchJob(
  deepResearchId: string,
  query: string,
  setting: Settings
): Promise<DeepResearch> {
  let secrets: string[] = []
  try {
    const braveApiKey = validateBraveApiKey(setting)
    const { model, apiKey } = getModelFromProvider(setting)
    secrets = [apiKey, braveApiKey]

    await notifyClients(deepResearchId, {
      type: DeepResearchProgress.StartDeepResearch
    })
    const { learnings, webSources } = await deepResearchAgent(
      {
        query,
        breadth: setting.deepResearch?.breadth ?? 4,
        depth: setting.deepResearch?.depth ?? 2
      },
      {
        braveApiKey,
        model,
        apiKey,
        notify: (data) => notifyClients(deepResearchId, data)
      }
    )

    await notifyClients(deepResearchId, {
      type: DeepResearchProgress.StartWritingFinalReport
    })
    const report = await writeFinalReport(
      {
        prompt: query,
        learnings
      },
      { model, apiKey }
    )

    const deepResearchById = await getDeepResearchById({ id: deepResearchId })
    const finalDeepResearch: DeepResearch = {
      ...deepResearchById,
      finalReport: report,
      webSources: [...webSources.values()],
      jobStatus: 'archived',
      endTime: new Date()
    }
    await updateDeepResearch(finalDeepResearch)
    await settleChatResult(deepResearchId)
    await notifyClients(deepResearchId, {
      type: DeepResearchProgress.CompleteDeepResearch,
      query
    })

    return finalDeepResearch
  } catch (error) {
    // Whatever step threw — search, the LLM calls, a dropped connection, or
    // the run being aborted (the chat it was launched from was stopped) —
    // the job must not stay 'streaming' forever (the desktop card, and
    // actovia-ios's 15-minute stall check, both key off jobStatus).
    const errorMessage = summarizeDeepResearchError(error, secrets)
    // The summary stands in for the message; the frames say where.
    logger.error('deep-research', 'Deep research job failed', {
      deepResearchId,
      error: errorMessage,
      'exception.stacktrace': stackFramesOf(error)
    })

    try {
      const deepResearchById = await getDeepResearchById({
        id: deepResearchId
      })
      const failedDeepResearch: DeepResearch = {
        ...deepResearchById,
        jobStatus: 'failed',
        errorMessage,
        endTime: new Date()
      }
      await updateDeepResearch(failedDeepResearch)
      await settleChatResult(deepResearchId)
      await notifyClients(deepResearchId, {
        type: DeepResearchProgress.FailDeepResearch,
        error: errorMessage
      })
      return failedDeepResearch
    } catch (persistError) {
      // The job row itself couldn't be updated — log and fall through to the
      // generic error response rather than leaving this silent.
      logger.error('deep-research', 'Failed to persist deep research failure', {
        deepResearchId,
        error: persistError
      })
      throw error
    }
  }
}

deepResearch.post('/', async (c) => {
  const { deepResearchId, query } = validateSchema<{
    deepResearchId: string
    query: string
  }>(createDeepResearchSchema, await c.req.json(), 'Invalid request body')
  bindTraceAttributes({ researchId: deepResearchId })

  const setting = c.get('settings')

  if (!setting || !('id' in setting)) {
    throw new NotFoundError(
      ErrorCode.SETTING_NOT_FOUND,
      'Failed to retrieve setting'
    )
  }

  // A request without a key or a model is refused before the job starts.
  validateBraveApiKey(setting)
  getModelFromProvider(setting)

  return successResponse(
    c,
    await runDeepResearchJob(deepResearchId, query, setting)
  )
})

deepResearch.get('/sse', async (c) => {
  const deepResearchId = getRequiredQuery(c, 'deepResearchId')

  const stream = new ReadableStream({
    start(controller) {
      sseManager.register(deepResearchId, controller, c.req.raw.signal)
    }
  })

  return new Response(stream, { headers: SSE_HEADERS })
})

deepResearch.get('/messages/:id', async (c) => {
  const { id } = c.req.param()

  const messages = await handleDatabaseOperation(
    () => getDeepResearchMessagesById({ id }),
    'Failed to get deep research messages'
  )

  return successResponse(c, messages)
})

deepResearch.get('/result/:id', async (c) => {
  const { id } = c.req.param()

  const result = await handleDatabaseOperation(
    () => getDeepResearchById({ id }),
    'Failed to get deep research result'
  )

  if (!result) {
    throw new NotFoundError(ErrorCode.DEEP_RESEARCH_NOT_FOUND, undefined, {
      id
    })
  }

  return successResponse(c, result)
})

export default deepResearch
