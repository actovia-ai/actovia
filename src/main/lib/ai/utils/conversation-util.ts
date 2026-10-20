import type { ChatMessage } from '@actovia/shared/types/chat'

import { getTextFromMessage } from './chat-message-util'

/**
 * Extract conversation text from messages into a "role: text" format.
 */
export function extractConversationText(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${getTextFromMessage(m)}`).join('\n')
}
