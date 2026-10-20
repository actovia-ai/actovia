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

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

const user = (id: string): ChatMessage => ({
  id,
  runId: id,
  role: 'user',
  content: 'q',
  timestamp: 1
})
const asst = (
  id: string,
  runId: string,
  text: string,
  stopReason: 'stop' | 'toolUse' = 'stop'
): ChatMessage =>
  ({
    id,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason,
    timestamp: 2
  }) as unknown as ChatMessage
const tool = (id: string, runId: string): ChatMessage => ({
  id,
  runId,
  role: 'toolResult',
  toolCallId: 'c',
  toolName: 'weather',
  content: [],
  details: null,
  isError: false,
  timestamp: 3
})

function turns(segments: ReturnType<typeof groupIntoSegments>) {
  return segments.map((s) =>
    s.type === 'assistantTurn' ? s.turn.runId : 'user'
  )
}

describe('groupIntoSegments by runId', () => {
  it('one run is one assistant segment whose body joins every text block in order', () => {
    const segs = groupIntoSegments([
      user(R1),
      asst('a1', R1, 'Looking that up.', 'toolUse'),
      tool('t1', R1),
      asst('a2', R1, 'It is sunny.')
    ])
    expect(turns(segs)).toEqual(['user', R1])
    const turn = segs[1].type === 'assistantTurn' ? segs[1].turn : null
    expect(turn?.body).toBe('Looking that up.\n\nIt is sunny.')
    expect(turn?.messages).toHaveLength(3)
  })

  it('two runs are two segments even with no user message between them', () => {
    // A send that failed before any reply, then a second send.
    const segs = groupIntoSegments([user(R1), user(R2), asst('a1', R2, 'hi')])
    expect(turns(segs)).toEqual(['user', 'user', R2])
  })

  it('rows of different runs never share a segment', () => {
    const segs = groupIntoSegments([
      user(R1),
      asst('a1', R1, 'one'),
      asst('a2', R2, 'two')
    ])
    expect(turns(segs)).toEqual(['user', R1, R2])
  })

  it('a message without a runId joins the run of the user message before it', () => {
    const legacy = { ...asst('a1', R1, 'hi') } as ChatMessage & {
      runId?: string
    }
    delete legacy.runId
    const segs = groupIntoSegments([user(R1), legacy])
    expect(turns(segs)).toEqual(['user', R1])
  })

  it('a run without a user message (an orphan) still renders', () => {
    const segs = groupIntoSegments([asst('a1', R1, 'hi')])
    expect(turns(segs)).toEqual([R1])
  })

  it('a cache hands back the same segment for a run a frame did not touch', () => {
    const cache = new Map()
    const first = [
      user(R1),
      asst('a1', R1, 'one'),
      user(R2),
      asst('a2', R2, 'tw')
    ]
    const before = groupIntoSegments(first, cache)
    const after = groupIntoSegments(
      [...first.slice(0, 3), asst('a2', R2, 'two')],
      cache
    )
    expect(after[1]).toBe(before[1])
    expect(after[3]).not.toBe(before[3])
  })
})

// What the turn shows, top to bottom: the model's text and the cards of the
// tools it called, in the order the run produced them.
describe("a turn's blocks follow the run's order", () => {
  type Block = { type: string; [key: string]: unknown }
  const step = (id: string, content: Block[]): ChatMessage =>
    ({
      id,
      runId: R1,
      role: 'assistant',
      content,
      stopReason: content.some((b) => b.type === 'toolCall')
        ? 'toolUse'
        : 'stop',
      timestamp: 2
    }) as unknown as ChatMessage
  const text = (value: string): Block => ({ type: 'text', text: value })
  const call = (id: string, name: string, args: object = {}): Block => ({
    type: 'toolCall',
    id,
    name,
    arguments: args
  })
  const result = (
    toolCallId: string,
    toolName: string,
    over: Partial<ChatMessage> = {}
  ): ChatMessage =>
    ({
      id: `r-${toolCallId}`,
      runId: R1,
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [],
      details: null,
      isError: false,
      timestamp: 3,
      ...over
    }) as ChatMessage

  const blocksOf = (messages: ChatMessage[]) => {
    const [segment] = groupIntoSegments(messages)
    if (segment?.type !== 'assistantTurn') throw new Error('no turn')
    return segment.turn.blocks.map((b) =>
      b.kind === 'text'
        ? `text:${b.text}`
        : `${b.kind}:${b.key}${b.result ? '' : ':pending'}`
    )
  }

  it('text, a card, text — a card sits where its call was made', () => {
    expect(
      blocksOf([
        step('a1', [text('Checking.'), call('c1', 'weather')]),
        result('c1', 'weather'),
        step('a2', [text('It is sunny.')])
      ])
    ).toEqual(['text:Checking.', 'tool:c1', 'text:It is sunny.'])
  })

  // The text beside a search is the model at work — it is in the timeline
  // (messages-narration.test.ts), and the answer is what follows.
  it('a tool with no card leaves only the answer after it', () => {
    expect(
      blocksOf([
        step('a1', [text('Looking that up.'), call('c1', 'web_search')]),
        result('c1', 'web_search'),
        step('a2', [text('Here it is.')])
      ])
    ).toEqual(['text:Here it is.'])
  })

  it('calls made in one step are neighbours, in call order, whichever answers first', () => {
    expect(
      blocksOf([
        step('a1', [
          text('Two things.'),
          call('c1', 'weather'),
          call('c2', 'create_artifact')
        ]),
        result('c2', 'create_artifact'),
        result('c1', 'weather'),
        step('a2', [text('Done.')])
      ])
    ).toEqual(['text:Two things.', 'tool:c1', 'tool:c2', 'text:Done.'])
  })

  it('a card whose call comes before the text of its step comes first', () => {
    // weather: a card that is the answer. A terminal's folds into the
    // timeline instead (messages-folded-cards.test.ts).
    expect(
      blocksOf([
        step('a1', [call('c1', 'weather'), text('Looking it up.')]),
        result('c1', 'weather')
      ])
    ).toEqual(['tool:c1', 'text:Looking it up.'])
  })

  it('an image holds its place from the call on', () => {
    const forming = [
      step('a1', [
        text('Drawing.'),
        call('g1', 'image_generation', { prompt: 'a fox' })
      ])
    ]
    expect(blocksOf(forming)).toEqual(['text:Drawing.', 'image:g1:pending'])
    expect(
      blocksOf([
        ...forming,
        result('g1', 'image_generation'),
        step('a2', [text('There.')])
      ])
    ).toEqual(['text:Drawing.', 'image:g1', 'text:There.'])
  })

  it('a tool that failed leaves no card, and the text reads on', () => {
    expect(
      blocksOf([
        step('a1', [text('Checking.'), call('c1', 'weather')]),
        result('c1', 'weather', { isError: true }),
        step('a2', [text('That did not work.')])
      ])
    ).toEqual(['text:Checking.\n\nThat did not work.'])
  })

  it('a tool that is not built in gets a card too', () => {
    expect(
      blocksOf([
        step('a1', [call('c1', 'drawio_render')]),
        result('c1', 'drawio_render')
      ])
    ).toEqual(['tool:c1'])
  })

  it('a result whose call is not in the run still gets its card, where it arrived', () => {
    expect(
      blocksOf([
        step('a1', [text('Checking.')]),
        result('c9', 'weather'),
        step('a2', [text('It is sunny.')])
      ])
    ).toEqual(['text:Checking.', 'tool:c9', 'text:It is sunny.'])
  })

  it('keeps every text block in the body, whatever stands between them', () => {
    const [segment] = groupIntoSegments([
      step('a1', [text('Checking.'), call('c1', 'weather')]),
      result('c1', 'weather'),
      step('a2', [text('It is sunny.')])
    ])
    expect(segment.type === 'assistantTurn' && segment.turn.body).toBe(
      'Checking.\n\nIt is sunny.'
    )
  })
})

// Regenerate groups (spec 2026-09-26): the question once, the answers on show
// under it.
describe('a regenerate group is one compare segment', () => {
  const G = '33333333-3333-4333-8333-333333333333'
  const A1 = '44444444-4444-4444-8444-444444444444'
  const A2 = '55555555-5555-4555-8555-555555555555'
  const Z = '66666666-6666-4666-8666-666666666666'

  const asked = (
    id: string,
    attempt?: string,
    alternateOf?: string
  ): ChatMessage =>
    ({
      ...user(id),
      ...(attempt ? { attempt } : {}),
      ...(alternateOf ? { alternateOf } : {})
    }) as ChatMessage
  const run = (id: string, attempt?: string, alternateOf?: string) => [
    asked(id, attempt, alternateOf),
    asst(`${id}-answer`, id, `answer of ${id}`)
  ]

  const shape = (segments: ReturnType<typeof groupIntoSegments>) =>
    segments.map((s) => {
      if (s.type === 'user') return `user:${s.message.id}`
      if (s.type === 'assistantTurn') return `turn:${s.turn.runId}`
      const columns = s.columns.map((c) => c.runId).join('|')
      const folded = s.folded ? ` folded:${s.folded.runId}` : ''
      return `compare:${s.groupId} ask:${s.question.id} [${columns}]${folded}${s.locked ? ' locked' : ''}`
    })

  it('two answers being compared: the question once, the earlier answer first', () => {
    expect(
      shape(
        groupIntoSegments([
          ...run(R1),
          ...run(G, 'comparing'),
          ...run(A1, 'comparing', G)
        ])
      )
    ).toEqual([
      `user:${R1}`,
      `turn:${R1}`,
      `compare:${G} ask:${G} [${G}|${A1}]`
    ])
  })

  it('a settled group shows the chosen answer and keeps the other folded', () => {
    expect(
      shape(groupIntoSegments([...run(G, 'folded'), ...run(A1, 'chosen', G)]))
    ).toEqual([`compare:${G} ask:${A1} [${A1}] folded:${G}`])
  })

  it('a hidden attempt is on show nowhere', () => {
    expect(
      shape(
        groupIntoSegments([
          ...run(G, 'hidden'),
          ...run(A1, 'comparing', G),
          ...run(A2, 'comparing', G)
        ])
      )
    ).toEqual([`compare:${G} ask:${A1} [${A1}|${A2}]`])
  })

  it('is locked once a later run exists', () => {
    expect(
      shape(
        groupIntoSegments([
          ...run(G, 'chosen'),
          ...run(A1, 'folded', G),
          ...run(Z)
        ])
      )
    ).toEqual([
      `compare:${G} ask:${G} [${G}] folded:${A1} locked`,
      `user:${Z}`,
      `turn:${Z}`
    ])
  })

  it('holds a column for an attempt that has not answered yet', () => {
    const segments = groupIntoSegments([
      ...run(G, 'comparing'),
      asked(A1, 'comparing', G)
    ])
    expect(shape(segments)).toEqual([`compare:${G} ask:${G} [${G}|${A1}]`])
    const [compare] = segments
    expect(compare.type === 'compare' && compare.columns[1].hasContent).toBe(
      false
    )
  })

  it('an ordinary run is never a compare segment', () => {
    expect(shape(groupIntoSegments([...run(R1), ...run(R2)]))).toEqual([
      `user:${R1}`,
      `turn:${R1}`,
      `user:${R2}`,
      `turn:${R2}`
    ])
  })

  it('a cache hands back the same compare segment while a later run streams', () => {
    const cache = new Map()
    const settled = [...run(G, 'chosen'), ...run(A1, 'folded', G), user(Z)]
    const before = groupIntoSegments(
      [...settled, asst('z-answer', Z, 'an')],
      cache
    )
    const after = groupIntoSegments(
      [...settled, asst('z-answer', Z, 'answer')],
      cache
    )
    expect(after[0]).toBe(before[0])
    expect(after[2]).not.toBe(before[2])
  })

  it('a cache keeps the settled column while the new attempt streams', () => {
    const cache = new Map()
    const open = [...run(G, 'comparing'), asked(A1, 'comparing', G)]
    const [before] = groupIntoSegments(
      [...open, asst('a1-answer', A1, 'an')],
      cache
    )
    const [after] = groupIntoSegments(
      [...open, asst('a1-answer', A1, 'answer')],
      cache
    )
    if (before.type !== 'compare' || after.type !== 'compare') {
      throw new Error('no compare segment')
    }
    expect(after.columns[0]).toBe(before.columns[0])
    expect(after.columns[1]).not.toBe(before.columns[1])
    expect(after.columns[1].body).toBe('answer')
  })

  it('a choice gives the segment a new identity', () => {
    const cache = new Map()
    const [before] = groupIntoSegments(
      [...run(G, 'comparing'), ...run(A1, 'comparing', G)],
      cache
    )
    const [after] = groupIntoSegments(
      [...run(G, 'folded'), ...run(A1, 'chosen', G)],
      cache
    )
    expect(after).not.toBe(before)
  })
})
