// @vitest-environment happy-dom
// An `image_generation` call left without a result — the run was stopped
// while the image was being made — stops showing "Generating" once the run
// is over: the card shows only while the run streams, or once a result is in
// (CLAUDE.md, the image_generation note; from the iOS C3 review).
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock(
  '@/components/calling-tools/image-generation/image-generation-card',
  () => ({
    ImageGenerationCard: ({ result }: { result?: unknown }) =>
      createElement('div', {
        'data-image-card': result ? 'with-result' : 'pending'
      })
  })
)

// `t` must be one function, as it is in react-i18next: Messages resets its
// segment caches whenever it changes (turn labels are translated when built).
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

// The foot of each turn reads memory through these; counted, so a test can
// see a settled turn's foot is not rendered again by a later turn's frames.
const memoryReads = { list: 0, usage: new Map<string, number>() }
const NO_USAGE: never[] = []
vi.mock('@/hooks/use-memory', () => ({
  useMemories: () => {
    memoryReads.list += 1
    return { data: undefined, isLoading: false }
  },
  useRunMemoryUsage: (_chatId: string, runId: string) => {
    memoryReads.usage.set(runId, (memoryReads.usage.get(runId) ?? 0) + 1)
    return NO_USAGE
  },
  useUndoMemoryChanges: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateMemory: () => vi.fn()
}))

// The approval card at each turn's foot, counted the same way.
const approvalReads = new Map<string, number>()
const NO_APPROVALS: never[] = []
vi.mock('@/hooks/use-approvals', () => ({
  useRunApprovals: (_chatId: string, runId: string) => {
    approvalReads.set(runId, (approvalReads.get(runId) ?? 0) + 1)
    return NO_APPROVALS
  },
  useDecideApproval: () => ({ mutate: vi.fn(), isPending: false })
}))

const startStream = vi.fn()
vi.mock('@/lib/stream-manager', () => ({
  startStream: (...args: unknown[]) => startStream(...args),
  stopStream: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  isStreaming: () => false
}))

const { default: Messages } = await import('@/components/chat/messages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const user = {
  id: 'u1',
  runId: 'u1',
  role: 'user',
  content: 'draw a cat',
  timestamp: 1
} as ChatMessage
const call = {
  id: 'a1',
  runId: 'u1',
  role: 'assistant',
  stopReason: 'toolUse',
  content: [
    {
      type: 'toolCall',
      id: 'call-img',
      name: 'image_generation',
      arguments: { prompt: 'a cat' }
    }
  ],
  timestamp: 2
} as unknown as ChatMessage

async function render(status: string, messages: ChatMessage[]) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      createElement(Messages, {
        chatId: 'chat-1',
        status,
        messages,
        regenerate: vi.fn()
      } as never)
    )
  )
  return host
}

describe('an image_generation call without a result', () => {
  it('shows the forming card while the run streams', async () => {
    const host = await render('streaming', [user, call])
    expect(host.querySelector('[data-image-card="pending"]')).not.toBeNull()
  })

  it('shows nothing once the run was stopped before the result', async () => {
    const host = await render('ready', [user, call])
    expect(host.querySelector('[data-image-card]')).toBeNull()
  })

  it('a call with its result shows it whether or not the run streams', async () => {
    const result = {
      id: 't1',
      runId: 'u1',
      role: 'toolResult',
      toolCallId: 'call-img',
      toolName: 'image_generation',
      content: [{ type: 'text', text: '1 image' }],
      details: { images: [] },
      isError: false,
      timestamp: 3
    } as unknown as ChatMessage
    const host = await render('ready', [user, call, result])
    expect(host.querySelector('[data-image-card="with-result"]')).not.toBeNull()
  })
})
