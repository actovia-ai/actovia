// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it, vi } from 'vitest'

const t = (key: string, o?: { query?: string }) =>
  o?.query ? `${key}:${o.query}` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: undefined })
}))
vi.mock('@/hooks/use-discover-feed', () => ({
  useDiscoverFeed: () => ({ feed: undefined })
}))
vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/chat/chat-toc', () => ({ ChatToc: () => null }))
vi.mock('@/components/home/discover-feed', () => ({ DiscoverFeed: () => null }))
vi.mock('@/components/chat/message-action', () => ({
  MessageAction: () => null
}))
vi.mock('@/components/chat/message-spinner', () => ({
  MessageSpinner: () => null,
  shouldShowMessageSpinner: () => false
}))
vi.mock('@/components/chat/messages-calling-tools', () => ({
  MessageCallingTools: () => null
}))
vi.mock('@/components/chat/thinking-timeline', () => ({
  ThinkingTimeline: () => null
}))
vi.mock('@/components/web-search/image-gallery', () => ({
  ImageGallery: () => null
}))
vi.mock('@/components/web-search/video-cards', () => ({
  VideoCards: () => null
}))
vi.mock('react-medium-image-zoom', () => ({
  default: ({ children }: { children: unknown }) => children
}))

const { groupIntoSegments } = await import('@/components/chat/messages')

const RUN = '11111111-1111-4111-8111-111111111111'

const user: ChatMessage = {
  id: RUN,
  runId: RUN,
  role: 'user',
  content: 'q',
  timestamp: 1
}
const search = (id: string, query: string) => ({
  type: 'toolCall',
  id,
  name: 'web_search',
  arguments: { query }
})
const asst = (id: string, content: unknown[]): ChatMessage =>
  ({
    id,
    runId: RUN,
    role: 'assistant',
    content,
    stopReason: 'toolUse',
    timestamp: 2
  }) as unknown as ChatMessage
const result = (callId: string): ChatMessage =>
  ({
    id: `r-${callId}`,
    runId: RUN,
    role: 'toolResult',
    toolCallId: callId,
    toolName: 'web_search',
    content: [{ type: 'text', text: 'ok' }],
    details: [{ title: 't', link: `https://example.com/${callId}`, rank: 1 }],
    isError: false,
    timestamp: 3
  }) as unknown as ChatMessage

const resultRows = (messages: ChatMessage[]) => {
  const segment = groupIntoSegments(messages).find(
    (s) => s.type === 'assistantTurn'
  )
  if (segment?.type !== 'assistantTurn') throw new Error('no turn')
  return segment.turn.steps
    .filter((s) => s.type === 'toolResult')
    .map((s) => s.text)
}

describe('search result rows', () => {
  it('name their query when the run searched more than once', () => {
    expect(
      resultRows([
        user,
        asst('a1', [search('c1', 'sprout pricing'), search('c2', 'greg app')]),
        result('c2'),
        result('c1')
      ])
    ).toEqual([
      'chat:toolPreview.webSearchResultCountFor:greg app',
      'chat:toolPreview.webSearchResultCountFor:sprout pricing'
    ])
  })

  it('stay a plain count after a single search', () => {
    expect(
      resultRows([user, asst('a1', [search('c1', 'sprout')]), result('c1')])
    ).toEqual(['chat:toolPreview.webSearchResultCount'])
  })
})
