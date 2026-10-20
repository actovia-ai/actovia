// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

// Which answers' action bars were handed a Regenerate, by their text.
const offered = new Map<string, boolean>()

vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock('@/components/chat/message-action', () => ({
  MessageAction: ({
    content,
    regenerate
  }: {
    content: string
    regenerate?: () => void
  }) => {
    offered.set(content, !!regenerate)
    return null
  }
}))
const t = (key: string) => key
const i18n = { language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: undefined })
}))
vi.mock('@/hooks/use-discover-feed', () => ({
  useDiscoverFeed: () => ({ feed: undefined })
}))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/chat/chat-toc', () => ({ ChatToc: () => null }))
vi.mock('@/components/home/discover-feed', () => ({ DiscoverFeed: () => null }))
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
vi.mock('@/hooks/use-memory', () => ({
  useMemories: () => ({ data: undefined, isLoading: false }),
  useRunMemoryUsage: () => [],
  useUndoMemoryChanges: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateMemory: () => vi.fn()
}))
vi.mock('@/hooks/use-approvals', () => ({
  useRunApprovals: () => [],
  useDecideApproval: () => ({ mutate: vi.fn(), isPending: false })
}))

const { default: Messages } = await import('@/components/chat/messages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const user = (id: string, text: string) =>
  ({ id, runId: id, role: 'user', content: text, timestamp: 1 }) as ChatMessage
const assistant = (id: string, runId: string, text: string) =>
  ({
    id,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2
  }) as unknown as ChatMessage

describe('<Messages> Regenerate', () => {
  it('is offered under the last answer only: it re-asks the last question', async () => {
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        createElement(Messages, {
          chatId: 'chat-1',
          status: 'ready',
          messages: [
            user('u1', 'first'),
            assistant('a1', 'u1', 'First answer'),
            user('u2', 'second'),
            assistant('a2', 'u2', 'Second answer')
          ],
          regenerate: vi.fn()
        })
      )
    )
    expect(offered.get('First answer')).toBe(false)
    expect(offered.get('Second answer')).toBe(true)
  })
})
