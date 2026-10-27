import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { NotFoundError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'

import { getArtifact, listArtifacts } from '../../ai/artifacts'
import {
  listAllArtifacts,
  updateArtifactCodeByArtifactId
} from '../../db/queries'
import { Variables } from '../types'
import { successResponse } from '../utils'

const artifactsRouter = new Hono<{ Variables: Variables }>()

// Every artifact the chats made, newest first: the Artifacts page.
artifactsRouter.get('/', async (c) => {
  return successResponse(c, await listAllArtifacts())
})

artifactsRouter.get('/:chatId', async (c) => {
  const chatId = c.req.param('chatId')
  return successResponse(c, listArtifacts(chatId))
})

artifactsRouter.get('/:chatId/:artifactId', async (c) => {
  const chatId = c.req.param('chatId')
  const artifactId = c.req.param('artifactId')
  const result = getArtifact(chatId, artifactId)
  if (!result)
    throw new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'Artifact not found')
  return successResponse(c, result)
})

// Re-sync a hand-edited .tsx file on disk back into the DB row the card
// actually renders from. Useful after manually fixing an artifact (e.g.
// converting hardcoded colors to theme tokens) without regenerating it.
artifactsRouter.post('/:chatId/:artifactId/resync', async (c) => {
  const chatId = c.req.param('chatId')
  const artifactId = c.req.param('artifactId')
  const onDisk = getArtifact(chatId, artifactId)
  if (!onDisk)
    throw new NotFoundError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Artifact file not found'
    )
  const updated = await updateArtifactCodeByArtifactId({
    artifactId,
    code: onDisk.code
  })
  if (updated === 0) {
    throw new NotFoundError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'No matching artifact message in DB'
    )
  }
  return successResponse(c, { updated, bytes: onDisk.code.length })
})

export default artifactsRouter
