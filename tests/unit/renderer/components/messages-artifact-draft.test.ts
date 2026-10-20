// @vitest-environment happy-dom
// While `create_artifact`'s arguments stream, the artifact's place in the
// answer shows the code being written (the draft card); the result replaces
// it in place, and a run stopped before the result leaves nothing.
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock('@/components/calling-tools/artifact/artifact-card', () => ({
  ArtifactDraft: ({ title, code }: { title: string; code: string }) =>
    createElement('div', { 'data-draft': title, 'data-code': code })
}))

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
  MessageCallingTools: ({ toolResult }: { toolResult: { toolName: string } }) =>
    createElement('div', { 'data-card': toolResult.toolName })
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
  content: 'make a dashboard',
  timestamp: 1
} as ChatMessage

// The call as a streamed frame carries it: pi keeps the partial arguments
// parsed, so the code is cut off mid-line.
const callWith = (args: Record<string, unknown>) =>
  ({
    id: 'a1',
    runId: 'u1',
    role: 'assistant',
    stopReason: 'toolUse',
    content: [
      {
        type: 'toolCall',
        id: 'call-art',
        name: 'create_artifact',
        arguments: args
      }
    ],
    timestamp: 2
  }) as unknown as ChatMessage

const result = {
  id: 't1',
  runId: 'u1',
  role: 'toolResult',
  toolCallId: 'call-art',
  toolName: 'create_artifact',
  content: [{ type: 'text', text: 'ok' }],
  details: { type: 'artifact', artifactId: 'x', title: 'Sales', code: '' },
  isError: false,
  timestamp: 3
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
  return { host, root }
}

describe('a create_artifact call whose arguments are still streaming', () => {
  it('holds its place with the code being written', async () => {
    const { host } = await render('streaming', [
      user,
      callWith({ title: 'Sales', code: 'const A = () => (\n  <div cl' })
    ])
    const draft = host.querySelector('[data-draft]')
    expect(draft?.dataset.draft).toBe('Sales')
    expect(draft?.dataset.code).toBe('const A = () => (\n  <div cl')
  })

  it('shows a draft before the title has arrived', async () => {
    const { host } = await render('streaming', [user, callWith({})])
    expect(host.querySelector('[data-draft]')?.dataset.code).toBe('')
  })

  it('is replaced in place by the card once the result lands', async () => {
    const { host } = await render('streaming', [
      user,
      callWith({ title: 'Sales', code: 'x' }),
      result
    ])
    expect(host.querySelector('[data-draft]')).toBeNull()
    expect(host.querySelector('[data-card="create_artifact"]')).not.toBeNull()
  })

  it('shows nothing once the run was stopped before the result', async () => {
    const { host } = await render('ready', [
      user,
      callWith({ title: 'Sales', code: 'x' })
    ])
    expect(host.querySelector('[data-draft]')).toBeNull()
  })
})
