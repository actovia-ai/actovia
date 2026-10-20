// @vitest-environment happy-dom
// A turn shows the model's text and its tools' cards in the order the run
// produced them — not every card above all of the text — and doing so costs
// the streaming path nothing: text that is settled is not rendered again
// while the text after a card streams.
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const markdownRenders = new Map<string, number>()
vi.mock('@/components/markdown/markdown', async () => {
  const { memo } = await import('react')
  return {
    // Memoized on its props, as the real one is.
    default: memo(function Markdown({ src }: { src: string }) {
      markdownRenders.set(src, (markdownRenders.get(src) ?? 0) + 1)
      return createElement('div', { 'data-piece': `text:${src}` })
    })
  }
})
vi.mock('@/components/chat/messages-calling-tools', () => ({
  MessageCallingTools: ({
    toolResult
  }: {
    toolResult: { toolCallId: string }
  }) => createElement('div', { 'data-piece': `card:${toolResult.toolCallId}` })
}))
vi.mock(
  '@/components/calling-tools/image-generation/image-generation-card',
  () => ({
    ImageGenerationCard: ({ prompt }: { prompt: string }) =>
      createElement('div', { 'data-piece': `image:${prompt}` })
  })
)
vi.mock('@/components/chat/message-action', () => ({
  MessageAction: () => createElement('div', { 'data-piece': 'actions' })
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

const RUN = 'u1'
const user = {
  id: RUN,
  runId: RUN,
  role: 'user',
  content: 'weather, then a picture',
  timestamp: 1
} as ChatMessage
const step = (id: string, content: object[]) =>
  ({
    id,
    runId: RUN,
    role: 'assistant',
    content,
    stopReason: 'toolUse',
    timestamp: 2
  }) as unknown as ChatMessage
const text = (value: string) => ({ type: 'text', text: value })
const call = (id: string, name: string, args: object = {}) => ({
  type: 'toolCall',
  id,
  name,
  arguments: args
})
const result = (toolCallId: string, toolName: string) =>
  ({
    id: `r-${toolCallId}`,
    runId: RUN,
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [],
    details: {},
    isError: false,
    timestamp: 3
  }) as unknown as ChatMessage

// text → weather card → text → image → text
const SETTLED: ChatMessage[] = [
  user,
  step('a1', [text('Checking the weather.'), call('c1', 'weather')]),
  result('c1', 'weather'),
  step('a2', [
    text('Sunny. Drawing it.'),
    call('g1', 'image_generation', { prompt: 'a sunny day' })
  ]),
  result('g1', 'image_generation')
]

let root: ReturnType<typeof createRoot>
let host: HTMLDivElement

async function show(status: string, messages: ChatMessage[]) {
  await act(async () =>
    root.render(
      createElement(Messages, {
        chatId: 'chat-1',
        status,
        messages,
        regenerate
      } as never)
    )
  )
}
const regenerate = vi.fn()

// The turn's pieces: the question's bubble (Markdown too) is not one.
const pieces = () =>
  [...host.querySelectorAll('[data-piece]')]
    .filter((el) => !el.closest('.bg-bubble'))
    .map((el) => el.dataset.piece)

beforeEach(() => {
  markdownRenders.clear()
  host = document.createElement('div')
  root = createRoot(host)
})

describe('<Messages>: a turn in the order the run produced it', () => {
  it('draws text and cards where the model put them, above one action bar', async () => {
    await show('ready', [...SETTLED, step('a3', [text('There you go.')])])

    expect(pieces()).toEqual([
      'text:Checking the weather.',
      'card:c1',
      'text:Sunny. Drawing it.',
      'image:a sunny day',
      'text:There you go.',
      'actions'
    ])
  })

  it('does not render the text above a card again while the text below it streams', async () => {
    await show('streaming', SETTLED)
    const before = new Map(markdownRenders)

    for (const frame of ['Th', 'There', 'There you go.']) {
      await show('streaming', [...SETTLED, step('a3', [text(frame)])])
      expect(markdownRenders.get(frame)).toBe(1)
    }

    expect(markdownRenders.get('Checking the weather.')).toBe(
      before.get('Checking the weather.')
    )
    expect(markdownRenders.get('Sunny. Drawing it.')).toBe(
      before.get('Sunny. Drawing it.')
    )
    expect(pieces().slice(0, 4)).toEqual([
      'text:Checking the weather.',
      'card:c1',
      'text:Sunny. Drawing it.',
      'image:a sunny day'
    ])
  })
})

describe('<Messages>: files a turn wrote fold into the timeline', () => {
  const failed = (toolCallId: string, toolName: string) =>
    ({
      ...(result(toolCallId, toolName) as object),
      isError: true,
      content: [{ type: 'text', text: 'EACCES' }]
    }) as unknown as ChatMessage
  const file = { path: '/w/chat-1/rules.md' }

  it('draws no card in the answer for a file written or edited — each hangs under its timeline row — so the text around them is one', async () => {
    await show('ready', [
      user,
      step('a1', [text('Writing the rules.'), call('w1', 'write_file', file)]),
      result('w1', 'write_file'),
      step('a2', [call('e1', 'edit_file', file)]),
      result('e1', 'edit_file'),
      step('a3', [call('e2', 'edit_file', { path: '/w/chat-1/other.md' })]),
      result('e2', 'edit_file'),
      step('a4', [text('Saved.')])
    ])

    expect(pieces()).toEqual(['text:Writing the rules.\n\nSaved.', 'actions'])
  })

  it('a failed write and the one after it are rows of the timeline, never a card', async () => {
    await show('ready', [
      user,
      step('a1', [call('w1', 'write_file', file)]),
      failed('w1', 'write_file'),
      step('a2', [call('w2', 'write_file', file)]),
      result('w2', 'write_file'),
      step('a3', [text('Done.')])
    ])

    expect(pieces()).toEqual(['text:Done.', 'actions'])
  })
})
