// @vitest-environment happy-dom
// A search's pictures and videos are drawn where the search was made in the
// run, between the paragraphs around it — not all at the answer's foot
// (ISSUE-294).
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/markdown/markdown', () => ({
  default: ({ src }: { src: string }) =>
    createElement('p', { 'data-text': src }, src)
}))
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
  ImageGallery: ({ images }: { images: Array<{ url: string }> }) =>
    createElement('div', {
      'data-gallery': images.map((i) => i.url).join(',')
    })
}))
vi.mock('@/components/web-search/video-cards', () => ({
  VideoCards: ({ videos }: { videos: Array<{ url: string }> }) =>
    createElement('div', { 'data-videos': videos.map((v) => v.url).join(',') })
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

const { default: Messages } = await import('@/components/chat/messages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let ts = 0
const user = {
  id: 'u1',
  runId: 'u1',
  role: 'user',
  content: 'show me cats and dogs',
  timestamp: ts++
} as ChatMessage

const assistant = (id: string, content: unknown[]) =>
  ({
    id,
    runId: 'u1',
    role: 'assistant',
    stopReason: 'toolUse',
    content,
    timestamp: ts++
  }) as unknown as ChatMessage

const search = (id: string, query: string) =>
  assistant(`a-${id}`, [
    { type: 'toolCall', id, name: 'web_search', arguments: { query } }
  ])

const searchResult = (id: string, media: unknown[]) =>
  ({
    id: `t-${id}`,
    runId: 'u1',
    role: 'toolResult',
    toolCallId: id,
    toolName: 'web_search',
    content: [{ type: 'text', text: 'results' }],
    details: [
      { title: 'A page', link: `https://example.com/${id}`, rank: 1, media }
    ],
    isError: false,
    timestamp: ts++
  }) as unknown as ChatMessage

const image = (url: string) => ({
  kind: 'image',
  url,
  thumbnailUrl: `${url}?thumb`,
  title: 'pic'
})

async function render(messages: ChatMessage[]) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      createElement(Messages, {
        chatId: 'chat-1',
        status: 'ready',
        messages,
        regenerate: vi.fn()
      } as never)
    )
  )
  return host
}

/** The answer's pieces top to bottom, as markers. */
const order = (host: HTMLElement) =>
  [
    ...host.querySelectorAll<HTMLElement>(
      '[data-text], [data-gallery], [data-videos]'
    )
  ]
    // The question's bubble is drawn through Markdown too.
    .filter((el) => el.dataset.text !== user.content)
    .map(
      (el) =>
        el.dataset.text ??
        (el.dataset.gallery !== undefined
          ? `gallery:${el.dataset.gallery}`
          : `videos:${el.dataset.videos}`)
    )

describe('search media in the run', () => {
  it('each search draws its pictures where it was made', async () => {
    const host = await render([
      user,
      search('s1', 'cats'),
      searchResult('s1', [image('https://img/cat.jpg')]),
      assistant('a2', [{ type: 'text', text: 'Cats first.' }]),
      search('s2', 'dogs'),
      searchResult('s2', [
        image('https://img/dog.jpg'),
        {
          kind: 'video',
          url: 'https://video/dog',
          thumbnailUrl: 'https://video/dog.jpg',
          title: 'dog'
        }
      ]),
      assistant('a3', [{ type: 'text', text: 'Then dogs.' }])
    ])
    expect(order(host)).toEqual([
      'gallery:https://img/cat.jpg',
      'Cats first.',
      'gallery:https://img/dog.jpg',
      'videos:https://video/dog',
      'Then dogs.'
    ])
  })

  it('a search without pictures adds nothing to the answer', async () => {
    const host = await render([
      user,
      search('s1', 'cats'),
      searchResult('s1', []),
      assistant('a2', [{ type: 'text', text: 'No pictures.' }])
    ])
    expect(order(host)).toEqual(['No pictures.'])
  })

  it('a picture shown by an earlier search of the run is not shown again', async () => {
    const host = await render([
      user,
      search('s1', 'cats'),
      searchResult('s1', [image('https://img/cat.jpg')]),
      search('s2', 'more cats'),
      searchResult('s2', [
        image('https://img/cat.jpg'),
        image('https://img/cat2.jpg')
      ]),
      assistant('a2', [{ type: 'text', text: 'Cats.' }])
    ])
    expect(order(host)).toEqual([
      'gallery:https://img/cat.jpg',
      'gallery:https://img/cat2.jpg',
      'Cats.'
    ])
  })
})
