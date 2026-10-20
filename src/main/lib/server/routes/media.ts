import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'

import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  NotFoundError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'

import { mediaContentType, resolveMediaFile } from '../../media/store'
import { Variables } from '../types'

/**
 * `GET /api/v1/media/:chatId/:file` — a generated image, straight off disk.
 *
 * The path is the storage layout itself (`~/.actovia/media/<chatId>/<file>`),
 * so there is no index to keep in step with the files and a row's `details`
 * is all a client needs to build the URL. Both segments must match exactly
 * what `saveMedia` writes, and the resolved path must stay inside the media
 * dir (`resolveMediaFile`); anything else is a 400 before the disk is touched.
 *
 * Mounted under `/api/v1`, so the origin gate, the LAN `authGate` (a paired
 * device's token) and the lock gate apply as to every route.
 */
const media = new Hono<{ Variables: Variables }>()

media.get('/:chatId/:file', async (c) => {
  const file = resolveMediaFile(c.req.param('chatId'), c.req.param('file'))
  if (!file) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid media id')
  }
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    throw new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'Media not found')
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream
  return new Response(body, {
    headers: {
      'Content-Type': mediaContentType(file),
      'Content-Length': String(info.size),
      // A file is written once under a fresh uuid and never changed.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})

export default media
