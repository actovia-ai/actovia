// src/main/lib/server/routes/knowledge-base.ts
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getAllKnowledgeDocs,
  getKnowledgeDocById,
  setIndexStatus,
  updateKnowledgeDoc
} from '../../db/knowledge-queries'
import { enqueueAndProcess, logEnqueueFailure } from '../../jobs/worker'
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import { Variables } from '../types'
import {
  deletionSuccessResponse,
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const router = new Hono<{ Variables: Variables }>()

const enqueueUpsert = (docId: string) =>
  enqueueAndProcess('kb-sync', { op: 'upsert', docId }).catch((e) =>
    logEnqueueFailure('kb-sync', e)
  )

router.post('/test-connection', async (c) => {
  const kb = resolveKnowledgeBase(c.get('settings'))
  if (!kb) {
    throw new ValidationError(
      ErrorCode.KNOWLEDGE_BASE_NOT_CONFIGURED,
      'Knowledge base is not configured'
    )
  }
  try {
    return successResponse(c, await kb.health())
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error
        ? `Failed to connect to the knowledge base: ${error.message}`
        : 'Failed to connect to the knowledge base'
    )
  }
})

router.get('/documents', async (c) =>
  successResponse(
    c,
    await handleDatabaseOperation(
      () => getAllKnowledgeDocs(),
      'Failed to load knowledge documents'
    )
  )
)

router.post('/documents', async (c) => {
  const data = validateSchema(
    z.object({ title: z.string().min(1), content: z.string().min(1) }),
    await c.req.json(),
    'Invalid knowledge document'
  )
  const row = await handleDatabaseOperation(
    () => createKnowledgeDoc(data),
    'Failed to create knowledge document'
  )
  await enqueueUpsert(row.id)
  return successResponse(c, row, 201)
})

router.put('/documents/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const data = validateSchema(
    z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional()
    }),
    await c.req.json(),
    'Invalid knowledge document'
  )
  const row = await handleDatabaseOperation(
    () => updateKnowledgeDoc(id, data),
    'Failed to update knowledge document'
  )
  if (data.title !== undefined || data.content !== undefined) {
    await setIndexStatus(id, { indexStatus: 'pending' })
    await enqueueUpsert(id)
  }
  return successResponse(c, row)
})

router.delete('/documents/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const row = await getKnowledgeDocById(id)
  await handleDatabaseOperation(
    () => deleteKnowledgeDoc(id),
    'Failed to delete knowledge document'
  )
  if (row?.lightragDocId) {
    await enqueueAndProcess('kb-sync', {
      op: 'delete',
      lightragDocId: row.lightragDocId
    }).catch((e) => logEnqueueFailure('kb-sync', e))
  }
  return deletionSuccessResponse(c, 'Document')
})

router.post('/documents/reindex-all', async (c) => {
  const docs = await handleDatabaseOperation(
    () => getAllKnowledgeDocs(),
    'Failed to load knowledge documents'
  )
  for (const d of docs) {
    await setIndexStatus(d.id, { indexStatus: 'pending' })
    await enqueueUpsert(d.id)
  }
  return successResponse(c, { count: docs.length })
})

export default router
