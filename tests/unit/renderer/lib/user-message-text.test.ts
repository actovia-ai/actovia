import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import { userMessageText } from '@/lib/user-message-text'

const msg = (content: unknown): ChatMessage =>
  ({ id: 'm1', role: 'user', content }) as ChatMessage

describe('userMessageText', () => {
  it('returns a string body, trimmed', () => {
    expect(userMessageText(msg('  hello world  '))).toBe('hello world')
  })

  it('concatenates text parts and drops images', () => {
    expect(
      userMessageText(
        msg([
          { type: 'text', text: 'a' },
          { type: 'image', data: 'x' },
          { type: 'text', text: 'b' }
        ])
      )
    ).toBe('ab')
  })

  it('is empty for an empty or non-array/non-string content', () => {
    expect(userMessageText(msg([]))).toBe('')
    expect(userMessageText(msg())).toBe('')
  })
})
