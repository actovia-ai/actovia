import type { WorkspaceFileFailure } from '@actovia/shared/types/workspace-files'
import { Hono } from 'hono'

import { getChatWorkspaceDir } from '../../paths'
import { readWorkspaceFile } from '../../workspace-files'
import { Variables } from '../types'

/**
 * `GET /api/v1/workspace/:chatId/file?path=…` — a file the chat's tools wrote,
 * as text, for the phone's read-only "View" sheet: `{ path, name, size,
 * modifiedAt, kind: 'markdown' | 'text', content }`.
 *
 * `path` is absolute, `~/`, or relative to the chat's workspace, and must be a
 * regular file whose real path (symlinks resolved) lies inside THAT chat's
 * workspace (`readWorkspaceFile`). Text only, at most
 * `WORKSPACE_FILE_MAX_BYTES`. Refusals: `400 INVALID_PATH` (no or bad chat id
 * / path), `403 OUTSIDE_WORKSPACE`, `404 FILE_NOT_FOUND` (also a directory),
 * `413 FILE_TOO_LARGE`, `415 FILE_NOT_TEXT` — the usual error envelope.
 *
 * Mounted under `/api/v1`, so the origin gate, the LAN `authGate` (a paired
 * device's token) and the lock gate apply as to every route. On loopback it is
 * open like the rest of the API: the model can read its own workspace anyway.
 */
const workspace = new Hono<{ Variables: Variables }>()

const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/u

const REFUSALS: Record<
  WorkspaceFileFailure,
  { status: 400 | 403 | 404 | 413 | 415 | 500; code: string; message: string }
> = {
  'invalid-path': {
    status: 400,
    code: 'INVALID_PATH',
    message: 'Not a usable file path.'
  },
  'outside-workspace': {
    status: 403,
    code: 'OUTSIDE_WORKSPACE',
    message: "The file is not in this chat's workspace."
  },
  'not-found': {
    status: 404,
    code: 'FILE_NOT_FOUND',
    message: 'The file is not there.'
  },
  'not-a-file': {
    status: 404,
    code: 'FILE_NOT_FOUND',
    message: 'The path is not a file.'
  },
  'too-large': {
    status: 413,
    code: 'FILE_TOO_LARGE',
    message: 'The file is too large to show.'
  },
  binary: {
    status: 415,
    code: 'FILE_NOT_TEXT',
    message: 'The file is not text.'
  },
  'unsafe-to-open': {
    status: 400,
    code: 'INVALID_PATH',
    message: 'Not a usable file path.'
  },
  failed: {
    status: 500,
    code: 'FILE_READ_FAILED',
    message: 'The file could not be read.'
  }
}

workspace.get('/:chatId/file', async (c) => {
  const chatId = c.req.param('chatId')
  const path = c.req.query('path')
  const result =
    CHAT_ID.test(chatId) && path
      ? await readWorkspaceFile(path, {
          root: getChatWorkspaceDir(chatId),
          base: getChatWorkspaceDir(chatId)
        })
      : ({ ok: false, reason: 'invalid-path' } as const)
  if (!result.ok) {
    const refusal = REFUSALS[result.reason]
    return c.json(
      {
        type: 'error',
        error: {
          code: refusal.code,
          message: refusal.message,
          hasCustomMessage: true
        }
      },
      refusal.status
    )
  }
  c.header('Cache-Control', 'no-store')
  return c.json({ ...result.file, kind: result.kind, content: result.content })
})

export default workspace
