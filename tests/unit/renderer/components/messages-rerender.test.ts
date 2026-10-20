// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// How many times each piece of markdown was rendered, by its text.
const markdownRenders = new Map<string, number>()
const sourcesSeen = new Map<string, unknown>()

vi.mock('@/components/markdown/markdown', () => ({
  default: ({
    src,
    webSearchResults
  }: {
    src: string
    webSearchResults?: unknown
  }) => {
    markdownRenders.set(src, (markdownRenders.get(src) ?? 0) + 1)
    sourcesSeen.set(src, webSearchResults)
    return null
  }
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

const {
  default: Messages,
  buildCitationSources,
  groupIntoSegments
} = await import('@/components/chat/messages')
const { useChat } = await import('@/hooks/use-chat')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const SOURCES: WebSearchResult[] = [
  {
    rank: 1,
    link: 'https://example.com/a',
    title: 'A',
    content: 'a',
    snippet: 'a'
  },
  {
    rank: 2,
    link: 'https://example.com/b',
    title: 'B',
    content: 'b',
    snippet: 'b'
  }
] as WebSearchResult[]

// Every message carries its run (the user message's id).
const user = (id: string, text: string) =>
  ({ id, runId: id, role: 'user', content: text, timestamp: 1 }) as ChatMessage
const assistant = (id: string, text: string, runId = `u${id.slice(1)}`) =>
  ({
    id,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2
  }) as unknown as ChatMessage
const webSearch = (id: string, runId = `u${id.slice(1)}`) =>
  ({
    id,
    runId,
    role: 'toolResult',
    toolCallId: `call-${id}`,
    toolName: 'web_search',
    content: [{ type: 'text', text: 'results' }],
    details: SOURCES,
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

// The second turn corrected a memory: its foot carries the memory strip.
const memoryCall = {
  id: 'm2call',
  runId: 'u2',
  role: 'assistant',
  stopReason: 'toolUse',
  content: [
    {
      type: 'toolCall',
      id: 'call-m2',
      name: 'update_memory',
      arguments: { instruction: 'I moved' }
    }
  ],
  timestamp: 2
} as unknown as ChatMessage
const memoryResult = {
  id: 'm2result',
  runId: 'u2',
  role: 'toolResult',
  toolCallId: 'call-m2',
  toolName: 'update_memory',
  content: [{ type: 'text', text: "Updated 'Home'." }],
  details: {
    changes: [
      {
        op: 'update',
        id: 'mem-1',
        before: {
          section: 'profile',
          key: 'Home',
          summary: 'Lives in Paris',
          details: [],
          isActive: true
        },
        after: {
          section: 'profile',
          key: 'Home',
          summary: 'Lives in Lyon',
          details: [],
          isActive: true
        }
      }
    ]
  },
  isError: false,
  timestamp: 2
} as unknown as ChatMessage

// Two finished turns — the first ran a web search, so every later turn carries
// citation sources; the second changed a memory — and a third that is streaming.
const HISTORY: ChatMessage[] = [
  user('u1', 'first question'),
  webSearch('t1'),
  assistant('a1', 'First answer 【1-source】'),
  user('u2', 'second question'),
  memoryCall,
  memoryResult,
  assistant('a2', 'Second answer'),
  user('u3', 'third question')
]

/** One streamed frame: same history objects, a fresh last message. */
const frame = (text: string) => [...HISTORY, assistant('a3', text)]

beforeEach(() => {
  markdownRenders.clear()
  sourcesSeen.clear()
  memoryReads.list = 0
  memoryReads.usage.clear()
  approvalReads.clear()
})

describe('groupIntoSegments with a cache', () => {
  it('hands back the same segment objects for everything a frame did not touch', () => {
    const cache = new Map()
    const before = groupIntoSegments(frame('Th'), cache)
    const after = groupIntoSegments(frame('Thi'), cache)

    expect(after).toHaveLength(before.length)
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1))
    after.slice(0, -1).forEach((segment, i) => expect(segment).toBe(before[i]))
    expect(after.at(-1)).not.toBe(before.at(-1))
  })

  it('gives the same result as without a cache', () => {
    const cache = new Map()
    groupIntoSegments(frame('Th'), cache)
    expect(groupIntoSegments(frame('Thi'), cache)).toEqual(
      groupIntoSegments(frame('Thi'))
    )
  })

  it('forgets segments that are no longer in the chat', () => {
    const cache = new Map()
    groupIntoSegments(frame('Th'), cache)
    groupIntoSegments([user('x1', 'a new chat')], cache)
    expect([...cache.keys()]).toEqual(['user:x1'])
  })
})

describe('buildCitationSources with a cache', () => {
  it('reuses the arrays of turns whose sources cannot have changed', () => {
    const segmentCache = new Map()
    const cache = { turns: [], sources: [] }
    const first = buildCitationSources(
      groupIntoSegments(frame('Th'), segmentCache),
      cache
    )
    const second = buildCitationSources(
      groupIntoSegments(frame('Thi'), segmentCache),
      cache
    )

    const [turn1, turn2] = [...second.keys()]
    expect(second.get(turn1)).toBe(first.get(turn1))
    expect(second.get(turn2)).toBe(first.get(turn2))
    expect(second.get(turn2)).toEqual(SOURCES)
  })

  // A chat opened on its newest page (spec 2026-10-01 §C4): the sources of
  // the runs not loaded come first, so a citation of one still resolves.
  it('lets every turn cite the sources of pages not loaded', () => {
    const older = [
      {
        rank: 9,
        link: 'https://old.example/',
        title: 'Old',
        content: '',
        snippet: ''
      }
    ]
    const sources = buildCitationSources(
      groupIntoSegments(HISTORY),
      undefined,
      older
    )
    const [turn1, turn2] = [...sources.keys()]
    expect(sources.get(turn1)?.[0]).toBe(older[0])
    expect(sources.get(turn2)).toEqual([...older, ...SOURCES])
  })

  it('rebuilds from the turn that changed onwards', () => {
    const segmentCache = new Map()
    const cache = { turns: [], sources: [] }
    const before = buildCitationSources(
      groupIntoSegments(HISTORY, segmentCache),
      cache
    )
    // A search lands in the third turn: its sources grow, earlier turns' do not.
    const withSearch = [...HISTORY, webSearch('t3'), assistant('a3', 'cited')]
    const after = buildCitationSources(
      groupIntoSegments(withSearch, segmentCache),
      cache
    )

    const turns = [...after.keys()]
    expect(after.get(turns[0])).toBe(before.get(turns[0]))
    expect(after.get(turns[1])).toBe(before.get(turns[1]))
    expect(after.get(turns[2])).toHaveLength(SOURCES.length * 2)
  })
})

// The real hook feeding the real list, as <Chat> wires them: the transcript's
// memoization only holds if what useChat hands down (`regenerate`) holds still
// too, and that is exactly what had silently stopped being true.
let send: ReturnType<typeof useChat>['sendMessage']

function ChatUnderTest() {
  const { messages, status, regenerate, sendMessage } = useChat({
    id: 'chat-1',
    chatTitle: 'Title',
    api: '/api/v1/chat',
    messages: HISTORY.slice(0, -1)
  })
  send = sendMessage
  return createElement(Messages, {
    chatId: 'chat-1',
    status,
    messages,
    regenerate
  })
}

describe('<Messages> while a reply streams', () => {
  it('re-renders the streaming turn only — not the transcript above it', async () => {
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(ChatUnderTest)))
    await act(async () => send({ text: 'third question' }))
    const { subscriber, initialMessages } = startStream.mock.calls[0][0]

    expect(markdownRenders.get('First answer 【1-source】')).toBeGreaterThan(0)
    const settled = new Map(markdownRenders)
    // The second turn's memory strip rendered (it reads the memory list);
    // snapshot every foot's reads before the frames arrive.
    expect(memoryReads.list).toBeGreaterThan(0)
    const settledMemoryReads = {
      list: memoryReads.list,
      usage: new Map(memoryReads.usage)
    }
    expect(approvalReads.get('u1')).toBeGreaterThan(0)
    const settledApprovalReads = new Map(approvalReads)
    const firstTurnSources = sourcesSeen.get('First answer 【1-source】')
    expect(firstTurnSources).toEqual(SOURCES)

    for (const text of ['Th', 'Thi', 'Thir', 'Third', 'Third answer']) {
      await act(async () =>
        subscriber.onMessages([...initialMessages, assistant('a3', text)])
      )
      expect(markdownRenders.get(text)).toBe(1)
    }

    // Finished turns: not rendered again, whatever streamed below them —
    // including the ones holding citation sources, whose array used to be
    // rebuilt (and so their markdown re-parsed) on every frame.
    expect(markdownRenders.get('First answer 【1-source】')).toBe(
      settled.get('First answer 【1-source】')
    )
    expect(markdownRenders.get('Second answer')).toBe(
      settled.get('Second answer')
    )
    expect(sourcesSeen.get('First answer 【1-source】')).toBe(firstTurnSources)
    // …and neither is the foot of a settled turn: the memory strip of the
    // turn that ran `update_memory`, or any finished turn's used-memories line.
    expect(memoryReads.list).toBe(settledMemoryReads.list)
    expect(memoryReads.usage.get('u1')).toBe(settledMemoryReads.usage.get('u1'))
    expect(memoryReads.usage.get('u2')).toBe(settledMemoryReads.usage.get('u2'))
    // …nor its approval card.
    expect(approvalReads.get('u1')).toBe(settledApprovalReads.get('u1'))
    expect(approvalReads.get('u2')).toBe(settledApprovalReads.get('u2'))
  })
})

// A regenerate group above the run that streams: settled or still being
// compared, its answers are not rendered again by the frames below them.
describe('<Messages> with a regenerate group above a streaming run', () => {
  const asked = (id: string, text: string, extra: object) =>
    ({ ...user(id, text), ...extra }) as ChatMessage
  const GROUP: ChatMessage[] = [
    asked('g1', 'why is the sky blue', { attempt: 'folded' }),
    webSearch('tg', 'g1'),
    assistant('ag', 'First attempt 【1-source】', 'g1'),
    asked('g2', 'why is the sky blue', {
      alternateOf: 'g1',
      attempt: 'chosen'
    }),
    assistant('ah', 'Second attempt', 'g2'),
    user('u9', 'and at sunset?')
  ]
  const choose = vi.fn()
  const regenerate = vi.fn()

  it('renders the chosen answer once, whatever streams after it', async () => {
    const root = createRoot(document.createElement('div'))
    const show = (messages: ChatMessage[]) =>
      act(async () =>
        root.render(
          createElement(Messages, {
            chatId: 'chat-1',
            status: 'streaming',
            messages,
            regenerate,
            chooseAttempt: choose
          })
        )
      )

    await show(GROUP)
    expect(markdownRenders.get('Second attempt')).toBe(1)
    // The folded answer is behind its link: not drawn until it is opened.
    expect(markdownRenders.get('First attempt 【1-source】')).toBeUndefined()

    for (const text of ['Re', 'Redder', 'Redder, for the same reason.']) {
      await show([...GROUP, assistant('a9', text, 'u9')])
      expect(markdownRenders.get(text)).toBe(1)
    }

    expect(markdownRenders.get('Second attempt')).toBe(1)
  })

  it('gives the run after the group the sources of the answer that was kept', async () => {
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        createElement(Messages, {
          chatId: 'chat-1',
          status: 'ready',
          messages: [...GROUP, assistant('a9', 'Redder.', 'u9')],
          regenerate,
          chooseAttempt: choose
        } as never)
      )
    )

    // The folded attempt's search is not something a later answer can cite.
    expect(sourcesSeen.get('Second attempt')).toBeUndefined()
    expect(sourcesSeen.get('Redder.')).toBeUndefined()
  })
})
