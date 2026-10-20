import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import type { ChatHistoryPage } from '@actovia/shared/types/chat-history'
import { parseChatHistoryCursor } from '@actovia/shared/utils/chat-history-cursor'
import { Hono } from 'hono'

import { getAllChats, getChatsPage, getFavoriteChats } from '../../db/queries'
import type { Chat } from '../../db/schema'
import { Variables } from '../types'
import { handleDatabaseOperation, successResponse } from '../utils'

const history = new Hono<{ Variables: Variables }>()

const MAX_LIMIT = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

// Without `limit`: the whole list, newest first — the desktop renderer's
// contract. With it: a page (`ChatHistoryPage`), the favourites on the first.
history.get('/', async (c) => {
  const limitParam = c.req.query('limit')
  if (limitParam === undefined) {
    const chats = await handleDatabaseOperation(
      () => getAllChats(),
      'Failed to get chat history'
    )
    return successResponse(c, chats)
  }

  const limit = Number(limitParam)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      `limit must be an integer from 1 to ${MAX_LIMIT}`
    )
  }
  const beforeParam = c.req.query('before')
  let before: { createdAt: Date; id: string } | undefined
  if (beforeParam !== undefined) {
    const parsed = parseChatHistoryCursor(beforeParam)
    // A chat id is a UUID; anything else would fail in the query, not here.
    if (!parsed || !UUID.test(parsed.id)) {
      throw new ValidationError(
        ErrorCode.VALIDATION_FAILED,
        'before must be a cursor: "<createdAt ISO>|<chat id>"'
      )
    }
    before = parsed
  }

  const page = await handleDatabaseOperation(
    () => getChatsPage({ limit, before }),
    'Failed to get a page of chat history'
  )
  if (before) return successResponse(c, page satisfies ChatHistoryPage<Chat>)
  const favorites = await handleDatabaseOperation(
    () => getFavoriteChats(),
    'Failed to get favourite chats'
  )
  return successResponse(c, {
    ...page,
    favorites
  } satisfies ChatHistoryPage<Chat>)
})

export default history
