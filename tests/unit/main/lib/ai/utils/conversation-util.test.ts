import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it, vi } from 'vitest'

// Mock the modules that transitively import Electron/DB
vi.mock('@main/lib/db/db', () => ({ pglite: {} }))
vi.mock('@main/lib/db/queries', () => ({}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { extractConversationText } =
  await import('@main/lib/ai/utils/conversation-util')

describe('extractConversationText', () => {
  it('converts messages to role: text format', () => {
    const messages = [
      { role: 'user', content: 'Hi there' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help?' }]
      },
      { role: 'user', content: 'Tell me about cats' }
    ] as ChatMessage[]

    const result = extractConversationText(messages)
    expect(result).toBe(
      'user: Hi there\nassistant: Hello! How can I help?\nuser: Tell me about cats'
    )
  })

  it('returns empty string for empty messages array', () => {
    expect(extractConversationText([])).toBe('')
  })

  it('handles mixed content types', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this: ' },
          { type: 'image', url: 'http://example.com' },
          { type: 'text', text: 'What is it?' }
        ]
      }
    ] as ChatMessage[]

    const result = extractConversationText(messages)
    expect(result).toBe('user: Look at this: What is it?')
  })
})
