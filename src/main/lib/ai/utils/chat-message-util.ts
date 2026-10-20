import type { ChatMessage } from '@actovia/shared/types/chat'
import type { Model, TextContent } from '@earendil-works/pi-ai'

import { logger } from '../../logger'
import { titleGenerationPrompt } from '../prompts'
import { completeSimple } from './complete'

// Re-exports for backwards compatibility
export {
  getApiKeyFromSetting,
  getModelFromProvider,
  PROVIDER_API_KEY_LABELS
} from './model-util'
export { bindCallingTools } from './tool-binding-util'

const TITLE_FALLBACK_CHARS = 60
/** Longer than this, what came back is not a title — the model answered. */
const TITLE_MAX_CHARS = 80
/** The opening of the message is enough to name it. */
const TITLE_INPUT_CHARS = 4000

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

export function getTextFromMessage(message: ChatMessage): string {
  if (message.role === 'user') {
    if (typeof message.content === 'string') return message.content
    return extractText(message.content)
  }
  return extractText(message.content)
}

export async function generateTitleFromUserMessage({
  message,
  model,
  apiKey
}: {
  message: ChatMessage
  model: Model<string>
  apiKey: string
}) {
  const userText = getTextFromMessage(message)
  // Never rejects: the chat route awaits this inside the turn's `try`, where a
  // throw would report an error for a turn that in fact succeeded. A failed
  // (or empty) title request falls back to the opening of the message — a
  // blank title is what the sidebar used to get.
  const fallback = userText
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_FALLBACK_CHARS)
  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: titleGenerationPrompt,
        messages: [
          {
            role: 'user',
            // In tags, so a question reads as something to name, not to answer
            content: [
              {
                type: 'text',
                text: `<message>\n${userText.slice(0, TITLE_INPUT_CHARS)}\n</message>`
              }
            ],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey }
    )

    const title = cleanTitle(extractText(result.content))
    if (title === null) {
      logger.warn(
        'chat',
        'Title request answered the message; using its opening',
        {
          length: extractText(result.content).length
        }
      )
      return fallback
    }
    return title || fallback
  } catch {
    return fallback
  }
}

/**
 * The title in what the model sent back, or `null` when it is not one: more
 * than one line, or longer than `TITLE_MAX_CHARS` — the model answered the
 * message instead of naming it (a question in the first message invites that).
 */
export function cleanTitle(raw: string): string | null {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > 1) return null
  const title = (lines[0] ?? '')
    .replace(/^[#*"'“”「『\s]+/, '')
    .replace(/[*"'“”」』\s]+$/, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
  return title.length > TITLE_MAX_CHARS ? null : title
}
