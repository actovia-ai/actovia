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

const user = (): ChatMessage => ({
  id: 'u',
  runId: RUN,
  role: 'user',
  content: 'q',
  timestamp: 1
})
const call = (
  id: string,
  name: string,
  args: Record<string, unknown>
): ChatMessage =>
  ({
    id: `a-${id}`,
    runId: RUN,
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    stopReason: 'toolUse',
    timestamp: 2
  }) as unknown as ChatMessage
const result = (
  id: string,
  name: string,
  details: unknown,
  isError = false
): ChatMessage =>
  ({
    id: `r-${id}`,
    runId: RUN,
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
    isError,
    timestamp: 3
  }) as unknown as ChatMessage
const answer = (): ChatMessage =>
  ({
    id: 'a-end',
    runId: RUN,
    role: 'assistant',
    content: [{ type: 'text', text: 'Done.' }],
    stopReason: 'stop',
    timestamp: 4
  }) as unknown as ChatMessage

function turnOf(messages: ChatMessage[]) {
  const seg = groupIntoSegments(messages).find(
    (s) => s.type === 'assistantTurn'
  )
  if (!seg || seg.type !== 'assistantTurn') throw new Error('no turn')
  return seg.turn
}

const ran = { command: 'ls', cwd: '/w', exitCode: 0, stdout: 'a\n', stderr: '' }

describe('a tool whose card folds into the timeline', () => {
  it('a terminal result is no block of the answer; it hangs under its call in the timeline', () => {
    const turn = turnOf([
      user(),
      call('c1', 'terminal', { command: 'ls' }),
      result('c1', 'terminal', ran),
      answer()
    ])
    expect(turn.blocks.map((b) => b.kind)).toEqual(['text'])
    const step = turn.steps.find(
      (s) => s.type === 'toolCall' && s.toolName === 'terminal'
    )
    expect(step?.toolCallId).toBe('c1')
    expect(step?.toolResult?.toolCallId).toBe('c1')
    expect(step?.toolResult?.details).toEqual(ran)
  })

  it('a file written folds the same way', () => {
    const turn = turnOf([
      user(),
      call('c2', 'write_file', { path: 'notes/a.md', content: 'x' }),
      result('c2', 'write_file', {
        path: 'notes/a.md',
        bytes: 1,
        created: true
      }),
      answer()
    ])
    expect(turn.blocks.map((b) => b.kind)).toEqual(['text'])
    const step = turn.steps.find((s) => s.toolCallId === 'c2')
    expect(step?.toolResult?.toolName).toBe('write_file')
  })

  it('a failed command stays a line of the timeline, with no card under its call', () => {
    const turn = turnOf([
      user(),
      call('c3', 'terminal', { command: 'false' }),
      result('c3', 'terminal', { ...ran, exitCode: 1 }, true),
      answer()
    ])
    expect(turn.blocks.map((b) => b.kind)).toEqual(['text'])
    const step = turn.steps.find((s) => s.toolCallId === 'c3')
    expect(step?.toolResult).toBeUndefined()
    expect(turn.steps.some((s) => s.type === 'toolResult' && s.isError)).toBe(
      true
    )
  })

  it('a card tool that is the answer (weather) is still a block', () => {
    const turn = turnOf([
      user(),
      call('c4', 'weather', { city: 'Kyoto' }),
      result('c4', 'weather', { city: 'Kyoto', temp: 21 }),
      answer()
    ])
    expect(turn.blocks.map((b) => b.kind)).toEqual(['tool', 'text'])
    const step = turn.steps.find((s) => s.toolCallId === 'c4')
    expect(step?.toolResult).toBeUndefined()
  })
})
