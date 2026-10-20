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

const RUN = '11111111-1111-4111-8111-111111111111'

const user: ChatMessage = {
  id: RUN,
  runId: RUN,
  role: 'user',
  content: 'q',
  timestamp: 1
}
const asst = (
  id: string,
  content: unknown[],
  stopReason: 'stop' | 'toolUse'
): ChatMessage =>
  ({
    id,
    runId: RUN,
    role: 'assistant',
    content,
    stopReason,
    timestamp: 2
  }) as unknown as ChatMessage
const call = (id: string, name: string) => ({
  type: 'toolCall',
  id,
  name,
  arguments: {}
})
const result = (callId: string, toolName: string): ChatMessage => ({
  id: `r-${callId}`,
  runId: RUN,
  role: 'toolResult',
  toolCallId: callId,
  toolName,
  content: [{ type: 'text', text: 'ok' }],
  details: null,
  isError: false,
  timestamp: 3
})

function turnOf(messages: ChatMessage[]) {
  const segment = groupIntoSegments(messages).find(
    (s) => s.type === 'assistantTurn'
  )
  if (segment?.type !== 'assistantTurn') throw new Error('no turn')
  return segment.turn
}

// "I'll pull the photos." before a web search is the model working, not the
// answer: it goes into the timeline, which folds when the run ends (owner,
// 2026-09-30). Text beside a tool that draws something, or that changes the
// memory, stays: that is often the answer itself, written before the card or
// the memory update.
describe('text the model writes while it works', () => {
  it('folds text beside a search into the timeline', () => {
    const turn = turnOf([
      user,
      asst(
        'a1',
        [
          { type: 'text', text: "I'll pull the photos." },
          call('c1', 'web_search')
        ],
        'toolUse'
      ),
      result('c1', 'web_search'),
      asst('a2', [{ type: 'text', text: 'Here they are.' }], 'stop')
    ])

    expect(turn.body).toBe('Here they are.')
    expect(
      turn.blocks.map((b) => (b.kind === 'text' ? b.text : b.kind))
    ).toEqual(['Here they are.'])
    expect(turn.steps.map((s) => [s.type, s.text])).toContainEqual([
      'narration',
      "I'll pull the photos."
    ])
  })

  it('keeps the steps in the order the run took them', () => {
    const turn = turnOf([
      user,
      asst(
        'a1',
        [{ type: 'text', text: 'Searching.' }, call('c1', 'web_search')],
        'toolUse'
      ),
      result('c1', 'web_search'),
      asst('a2', [{ type: 'text', text: 'Done.' }], 'stop')
    ])
    expect(turn.steps.map((s) => s.type).slice(0, 2)).toEqual([
      'narration',
      'toolCall'
    ])
  })

  it.each([
    ['a card', 'map_itinerary'],
    ['an image', 'image_generation'],
    ['a memory update', 'update_memory']
  ])('keeps text beside %s in the answer', (_label, tool) => {
    const turn = turnOf([
      user,
      asst(
        'a1',
        [{ type: 'text', text: 'The full answer.' }, call('c1', tool)],
        'toolUse'
      ),
      result('c1', tool),
      asst('a2', [{ type: 'text', text: 'Noted.' }], 'stop')
    ])
    expect(turn.body).toBe('The full answer.\n\nNoted.')
    expect(turn.steps.some((s) => s.type === 'narration')).toBe(false)
  })

  it('leaves a run without tools alone', () => {
    const turn = turnOf([
      user,
      asst('a1', [{ type: 'text', text: 'Just the answer.' }], 'stop')
    ])
    expect(turn.body).toBe('Just the answer.')
    expect(turn.steps).toEqual([])
  })
})
