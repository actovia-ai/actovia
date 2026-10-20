import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  NotFoundError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import { LOCAL_USER_ID, runMemoryInstruction } from '../../ai/memory/manager'
import { undoMemoryChanges } from '../../ai/memory/undo'
import { getModelFromProvider } from '../../ai/utils/model-util'
import {
  createMemory,
  getAllMemories,
  getMemoryById,
  getMemoryUsageByChat,
  hardDeleteMemory,
  softDeleteMemory,
  updateMemory,
  type MemorySection,
  type MemorySource
} from '../../db/memory-queries'
import { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  getRequiredQuery,
  handleDatabaseOperation,
  successResponse,
  updateSuccessResponse,
  validateSchema
} from '../utils'

const memorySnapshotSchema = z.object({
  section: z.enum(['profile', 'topic', 'person']),
  key: z.string(),
  summary: z.string(),
  details: z.array(z.string()),
  isActive: z.boolean()
})

// Each op carries exactly the snapshots its reversal reads: a create has no
// `before`, a delete no `after`, an update both. Ids are uuids — anything else
// is a 400 here rather than a Postgres "invalid input syntax" 500 later.
const memoryChangeSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    id: z.uuid(),
    before: z.null(),
    after: memorySnapshotSchema
  }),
  z.object({
    op: z.literal('update'),
    id: z.uuid(),
    before: memorySnapshotSchema,
    after: memorySnapshotSchema
  }),
  z.object({
    op: z.literal('delete'),
    id: z.uuid(),
    before: memorySnapshotSchema,
    after: z.null()
  })
])

const undoRequestSchema = z.object({
  changes: z.array(memoryChangeSchema)
})

const memoryRouter = new Hono<{ Variables: Variables }>()

// GET /api/v1/memory — list all memories (active + inactive)
memoryRouter.get('/', async (c) => {
  const section = c.req.query('section') as MemorySection | undefined
  const rows = await handleDatabaseOperation(
    () => getAllMemories(LOCAL_USER_ID),
    'Failed to load memories'
  )
  const filtered = section ? rows.filter((m) => m.section === section) : rows
  return successResponse(c, filtered)
})

// POST /api/v1/memory/undo — reverse a set of changes unless edited since.
// Registered ahead of the /:id routes below, same as every other non-:id path.
memoryRouter.post('/undo', async (c) => {
  const { changes } = validateSchema(
    undoRequestSchema,
    await c.req.json(),
    'changes is required'
  )
  const result = await handleDatabaseOperation(
    () => undoMemoryChanges(changes),
    'Failed to undo memory changes'
  )
  return successResponse(c, result)
})

// GET /api/v1/memory/usage?chatId= — which memories each run of a chat used.
// Registered ahead of the /:id routes below, same as every other non-:id path.
memoryRouter.get('/usage', async (c) => {
  const chatId = validateSchema(
    z.uuid(),
    getRequiredQuery(c, 'chatId'),
    'chatId must be a uuid'
  )
  const usage = await handleDatabaseOperation(
    () => getMemoryUsageByChat(chatId),
    'Failed to load memory usage'
  )
  return successResponse(c, usage)
})

// GET /api/v1/memory/:id
memoryRouter.get('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const row = await handleDatabaseOperation(
    () => getMemoryById(id),
    'Failed to load memory'
  )
  if (!row) {
    throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, undefined, { id })
  }
  return successResponse(c, row)
})

// POST /api/v1/memory/instruct — apply a free-text instruction via the LLM
memoryRouter.post('/instruct', async (c) => {
  const body = await c.req.json<{
    instruction?: string
    scopeMemoryId?: string
  }>()
  if (!body.instruction?.trim()) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'instruction is required'
    )
  }

  const { model, apiKey } = getModelFromProvider(c.get('settings'))
  const result = await handleDatabaseOperation(
    () =>
      runMemoryInstruction(
        body.instruction!,
        body.scopeMemoryId ?? null,
        model,
        apiKey
      ),
    'Failed to apply the instruction'
  )
  return successResponse(c, result)
})

// POST /api/v1/memory — create
memoryRouter.post('/', async (c) => {
  const body = await c.req.json<{
    section: MemorySection
    key: string
    summary: string
    details?: string[]
    confidence?: number
    source?: MemorySource
  }>()

  if (!body.section || !body.key) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'section and key are required'
    )
  }

  const row = await handleDatabaseOperation(
    () =>
      createMemory({
        userId: LOCAL_USER_ID,
        section: body.section,
        key: body.key,
        summary: body.summary ?? '',
        details: body.details,
        confidence: body.confidence,
        source: body.source ?? 'system'
      }),
    'Failed to create memory'
  )
  return successResponse(c, row, 201)
})

// PATCH /api/v1/memory/:id — update
memoryRouter.patch('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const body = await c.req.json<{
    section?: MemorySection
    key?: string
    summary?: string
    details?: string[]
    confidence?: number
    source?: MemorySource
    isActive?: boolean
  }>()

  const updated = await handleDatabaseOperation(
    () => updateMemory(id, body),
    'Failed to update memory'
  )
  if (!updated) {
    throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, undefined, { id })
  }
  return updateSuccessResponse(c, 'memory', id)
})

// DELETE /api/v1/memory/:id — soft delete (sets isActive=false)
memoryRouter.delete('/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const hard = c.req.query('hard') === 'true'
  await handleDatabaseOperation(
    () => (hard ? hardDeleteMemory(id) : softDeleteMemory(id)),
    'Failed to delete memory'
  )
  return deletionSuccessResponse(c, 'Memory')
})

export default memoryRouter
