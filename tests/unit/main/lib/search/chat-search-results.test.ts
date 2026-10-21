import {
  buildChatSearchResults,
  type MessageHit
} from '@main/lib/search/chat-search-results'
import { describe, expect, it } from 'vitest'

const message = (
  id: string,
  chatId: string,
  createdAt: string,
  extra: Partial<MessageHit> = {}
): MessageHit => ({
  id,
  chatId,
  role: 'assistant',
  searchText: `**${id}** mentions the needle`,
  createdAt,
  ...extra
})

describe('buildChatSearchResults', () => {
  it('answers one row per chat with its three newest matching messages as snippets', () => {
    const results = buildChatSearchResults(
      [{ chatId: 'c1', title: 'One', activityAt: '2026-01-01T00:00:00.000Z' }],
      [
        message('m1', 'c1', '2026-01-01T00:00:01.000Z'),
        message('m4', 'c1', '2026-01-01T00:00:04.000Z'),
        message('m2', 'c1', '2026-01-01T00:00:02.000Z'),
        message('m3', 'c1', '2026-01-01T00:00:03.000Z', { role: 'user' })
      ],
      ['needle']
    )

    expect(results).toEqual([
      {
        chatId: 'c1',
        title: 'One',
        matchedAt: '2026-01-01T00:00:04.000Z',
        snippets: [
          {
            messageId: 'm4',
            role: 'assistant',
            text: 'm4 mentions the needle',
            createdAt: '2026-01-01T00:00:04.000Z'
          },
          {
            messageId: 'm3',
            role: 'user',
            text: 'm3 mentions the needle',
            createdAt: '2026-01-01T00:00:03.000Z'
          },
          {
            messageId: 'm2',
            role: 'assistant',
            text: 'm2 mentions the needle',
            createdAt: '2026-01-01T00:00:02.000Z'
          }
        ]
      }
    ])
  })

  it("dates a title-only match by the chat's activity and gives it no snippets", () => {
    const [result] = buildChatSearchResults(
      [
        {
          chatId: 'c1',
          title: 'Needle',
          activityAt: new Date('2026-02-01T00:00:00.000Z')
        }
      ],
      [],
      ['needle']
    )
    expect(result).toEqual({
      chatId: 'c1',
      title: 'Needle',
      matchedAt: '2026-02-01T00:00:00.000Z',
      snippets: []
    })
  })

  it('orders chats newest match first and keeps 30', () => {
    const chats = Array.from({ length: 35 }, (_, i) => ({
      chatId: `c${i}`,
      title: `Chat ${i}`,
      activityAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    }))
    const results = buildChatSearchResults(chats, [], ['chat'])
    expect(results).toHaveLength(30)
    expect(results[0].chatId).toBe('c34')
    expect(results[29].chatId).toBe('c5')
  })

  it('lets a newer message outrank a title match, and ignores repeated chats and tool rows', () => {
    const results = buildChatSearchResults(
      [
        { chatId: 'a', title: 'A', activityAt: '2026-01-02T00:00:00.000Z' },
        { chatId: 'b', title: 'B', activityAt: '2026-01-01T00:00:00.000Z' },
        { chatId: 'b', title: 'B', activityAt: '2026-01-01T00:00:00.000Z' }
      ],
      [
        message('m1', 'b', '2026-01-03T00:00:00.000Z'),
        message('t1', 'a', '2026-01-04T00:00:00.000Z', { role: 'toolResult' })
      ],
      ['needle']
    )
    expect(
      results.map((r) => [r.chatId, r.matchedAt, r.snippets.length])
    ).toEqual([
      ['b', '2026-01-03T00:00:00.000Z', 1],
      ['a', '2026-01-02T00:00:00.000Z', 0]
    ])
  })

  it('carries the run a snippet is from, so the chat can open there', () => {
    const [result] = buildChatSearchResults(
      [{ chatId: 'c1', title: 'One', activityAt: '2026-01-01T00:00:00.000Z' }],
      [
        message('m2', 'c1', '2026-01-01T00:00:02.000Z', { runId: 'r1' }),
        message('m1', 'c1', '2026-01-01T00:00:01.000Z', { runId: null })
      ],
      ['needle']
    )
    expect(result.snippets[0].runId).toBe('r1')
    expect(result.snippets[1]).not.toHaveProperty('runId')
  })
})
