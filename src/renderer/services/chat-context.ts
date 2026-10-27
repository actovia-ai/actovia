import type { ChatContextSnapshot } from '@actovia/shared/types/chat-context'
import { HttpError, fetcher } from '@actovia/shared/utils/http'

/** The chat's context as of its last run; null before it has run (404). */
export async function fetchChatContext(
  chatId: string
): Promise<ChatContextSnapshot | null> {
  try {
    return await fetcher<ChatContextSnapshot>(`/api/v1/chat/${chatId}/context`)
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404) return null
    throw error
  }
}
