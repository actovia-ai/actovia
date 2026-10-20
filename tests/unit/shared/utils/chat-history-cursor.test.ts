// The chat list's cursor. actovia-ios reads and builds the same string — keep
// its tests' vectors in step.
import {
  chatHistoryCursor,
  parseChatHistoryCursor
} from '@actovia/shared/utils/chat-history-cursor'
import { describe, expect, it } from 'vitest'

const ID = '0b6f7c4e-6a39-4d3e-9a51-2f1f0c6f4a10'

describe('chatHistoryCursor', () => {
  it('is "<createdAt ISO>|<id>"', () => {
    expect(
      chatHistoryCursor({
        createdAt: new Date('2026-10-06T12:00:00Z'),
        id: ID
      })
    ).toBe(`2026-10-06T12:00:00.000Z|${ID}`)
  })

  it('takes an ISO string as the wire carries it', () => {
    expect(
      chatHistoryCursor({ createdAt: '2026-10-06T12:00:00.250Z', id: ID })
    ).toBe(`2026-10-06T12:00:00.250Z|${ID}`)
  })

  it('round-trips', () => {
    const createdAt = new Date('2026-10-06T12:00:00.123Z')
    expect(
      parseChatHistoryCursor(chatHistoryCursor({ createdAt, id: ID }))
    ).toEqual({
      createdAt,
      id: ID
    })
  })

  it('keeps an id that contains "|"', () => {
    const createdAt = new Date('2026-10-06T12:00:00.000Z')
    const cursor = chatHistoryCursor({ createdAt, id: 'a|b|c' })
    expect(parseChatHistoryCursor(cursor)).toEqual({ createdAt, id: 'a|b|c' })
  })
})

describe('parseChatHistoryCursor', () => {
  it.each([
    '',
    'nope',
    `|${ID}`,
    '2026-10-06T12:00:00.000Z|',
    `not-a-date|${ID}`
  ])('answers null for %j', (s) => {
    expect(parseChatHistoryCursor(s)).toBeNull()
  })
})
