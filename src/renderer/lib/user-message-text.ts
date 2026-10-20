import type { ChatMessage, TextContent } from '@actovia/shared/types/chat'

/**
 * Flatten a message's content down to its plain text — a `string` body is
 * returned verbatim, an array of parts is reduced to its concatenated `text`
 * parts (images and other non-text parts dropped). Trimmed.
 */
export function userMessageText(message: ChatMessage): string {
  const { content } = message
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part.type === 'text' ? [(part as TextContent).text] : []
    )
    .join('')
    .trim()
}
