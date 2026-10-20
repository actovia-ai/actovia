// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
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

const RUN = '33333333-3333-4333-8333-333333333333'

const user: ChatMessage = {
  id: RUN,
  runId: RUN,
  role: 'user',
  content: 'q',
  timestamp: 1
}
const asst = (id: string, content: unknown[]): ChatMessage =>
  ({
    id,
    runId: RUN,
    role: 'assistant',
    content,
    stopReason: 'stop',
    timestamp: 2
  }) as unknown as ChatMessage

function turnOf(messages: ChatMessage[], cache?: Map<string, unknown>) {
  const segment = groupIntoSegments(
    messages,
    cache as Parameters<typeof groupIntoSegments>[1]
  ).find((s) => s.type === 'assistantTurn')
  if (segment?.type !== 'assistantTurn') throw new Error('no turn')
  return segment.turn
}

// A message saved before the kernel split `<thinking>` spans out still holds
// one in its text: the transcript shows it in the timeline, not the answer.
describe('a stored <thinking> span', () => {
  it('goes into the timeline as thinking, out of the answer', () => {
    const turn = turnOf([
      user,
      asst('a1', [
        {
          type: 'text',
          text: '<thinking>国庆假期，北京。用 map_itinerary 展示。</thinking>\n\n好的，行程如下。'
        }
      ])
    ])
    expect(turn.body).toBe('好的，行程如下。')
    expect(turn.steps.map((s) => [s.type, s.text])).toEqual([
      ['thinking', '国庆假期，北京。用 map_itinerary 展示。']
    ])
  })

  it('leaves a span inside a code fence in the answer', () => {
    const text = '```xml\n<think>x</think>\n```'
    const turn = turnOf([user, asst('a1', [{ type: 'text', text }])])
    expect(turn.body).toBe(text)
    expect(turn.steps).toEqual([])
  })

  it('keeps the cached segment for the same messages', () => {
    const cache = new Map()
    const messages = [
      user,
      asst('a1', [{ type: 'text', text: '<think>p</think>\nAnswer.' }])
    ]
    const first = turnOf(messages, cache)
    const second = turnOf([...messages], cache)
    expect(second).toBe(first)
  })
})
