import type { ChatMessage } from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { postRequestBodySchema } from '@main/lib/server/schemas/chat'
import { describe, expect, it } from 'vitest'

import { groupIntoSegments } from '@/components/chat/messages'
import { parseCitations } from '@/components/markdown/markdown-citations'

// Regression: a follow-up turn used to wipe the citations off every earlier
// turn. `POST /api/v1/chat` validated history messages with a strict `z.object`,
// which dropped `details`/`toolName`; the route then echoed that stripped
// history back in the `done` SSE frame, so turn 1's webSearch sources vanished.

const CHAT_ID = '11111111-1111-4111-8111-111111111111'

const SOURCES: WebSearchResult[] = [
  {
    rank: 1,
    link: 'https://example.com/a',
    title: 'Source A',
    content: 'full a',
    snippet: 'snippet a',
    siteName: 'Example A'
  },
  {
    rank: 2,
    link: 'https://example.com/b',
    title: 'Source B',
    content: 'full b',
    snippet: 'snippet b',
    siteName: 'Example B'
  }
]

// Turn 1: user asks, model runs webSearch, answers citing 【1-source】.
const turn1: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'what happened?', timestamp: 1 },
  {
    id: 't1',
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'web_search',
    content: [{ type: 'text', text: 'formatted citations prompt' }],
    details: SOURCES,
    isError: false,
    timestamp: 2
  } as ChatMessage,
  {
    id: 'a1',
    role: 'assistant',
    content: [
      { type: 'text', text: 'It rained 【1-source】 and cleared 【2-source】.' }
    ],
    timestamp: 3
  } as ChatMessage
]

const turn2User: ChatMessage = {
  id: 'u2',
  role: 'user',
  content: 'expand on that',
  timestamp: 4
}

/** Cross-turn source accumulation, mirrored from Messages' citationSourcesByTurn. */
function sourcesForFirstTurn(messages: ChatMessage[]): WebSearchResult[] {
  const segments = groupIntoSegments(messages)
  const acc: WebSearchResult[] = []
  for (const seg of segments) {
    if (seg.type !== 'assistantTurn') continue
    acc.push(...seg.turn.webSearchResults)
    return acc.slice() // snapshot at the first assistant turn
  }
  return acc
}

describe('citations survive a follow-up turn', () => {
  it('round-trips turn-1 webSearch sources through the request schema', () => {
    const parsed = postRequestBodySchema.parse({
      id: CHAT_ID,
      advancedTools: [],
      messages: [...turn1, turn2User]
    })

    // The done-frame payload the renderer receives: parsed history + the fresh turn.
    const donePayload = [
      ...(parsed.messages as unknown as ChatMessage[]),
      {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Sure — more detail here.' }],
        timestamp: 5
      } as ChatMessage
    ]

    const firstTurnSources = sourcesForFirstTurn(donePayload)
    expect(firstTurnSources).toHaveLength(2)
    expect(firstTurnSources.map((s) => s.rank)).toEqual([1, 2])

    // 【1-source】 / 【2-source】 in turn 1's text resolve against those sources.
    const rankMap = new Map(firstTurnSources.map((r) => [r.rank, r]))
    const cited = parseCitations(
      'It rained 【1-source】 and cleared 【2-source】.'
    )
    expect(cited).toEqual([1, 2])
    expect(rankMap.get(1)?.link).toBe('https://example.com/a')
    expect(rankMap.get(2)?.siteName).toBe('Example B')
  })

  it('collects a webFetch page as a citeable source', () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', content: 'analyze this', timestamp: 1 },
      {
        id: 'tf',
        role: 'toolResult',
        toolCallId: 'call_f',
        toolName: 'web_fetch',
        content: [
          { type: 'text', text: '[1] BLS PPI\nURL: https://bls.gov/x' }
        ],
        details: {
          rank: 1,
          link: 'https://bls.gov/x',
          title: 'BLS PPI',
          content: 'preview',
          snippet: 'preview'
        },
        isError: false,
        timestamp: 2
      } as ChatMessage,
      {
        id: 'af',
        role: 'assistant',
        content: [{ type: 'text', text: 'PPI rose 0.4% 【1-source】.' }],
        timestamp: 3
      } as ChatMessage
    ]
    const sources = sourcesForFirstTurn(messages)
    expect(sources.map((s) => s.link)).toEqual(['https://bls.gov/x'])
    expect(parseCitations('PPI rose 0.4% 【1-source】.')).toEqual([1])
  })

  it('confirms the pre-fix strip is what broke it (contrast)', () => {
    // Simulate the old strict-object behaviour: keep only id/role/content.
    const stripped = [...turn1, turn2User].map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content
    })) as unknown as ChatMessage[]

    expect(sourcesForFirstTurn(stripped)).toHaveLength(0)
  })
})
