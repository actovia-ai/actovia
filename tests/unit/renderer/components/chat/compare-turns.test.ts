// @vitest-environment happy-dom
// A regenerate group on screen (spec 2026-09-26): two answers side by side —
// tabs in a narrow window — each with "Use this one"; once settled, the
// chosen answer with a link to the other.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  AssistantTurn,
  ChatMessage,
  CompareSegment
} from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The answers themselves are `AssistantTurnSegment`'s business; here it
// stands for "this run, drawn", with what it was told.
vi.mock('@/components/chat/assistant-turn-segment', () => ({
  AssistantTurnSegment: ({
    turn,
    isStreaming,
    regenerate,
    foot,
    answerable
  }: {
    turn: AssistantTurn
    isStreaming: boolean
    regenerate?: () => void
    foot?: unknown
    answerable?: boolean
  }) =>
    createElement(
      'div',
      {
        'data-turn': turn.runId,
        'data-streaming': String(isStreaming),
        'data-can-regenerate': String(regenerate !== undefined),
        'data-answerable': String(answerable ?? true)
      },
      foot as never
    )
}))

let wide = true
vi.mock('@/hooks/use-min-width', () => ({ useMinWidth: () => wide }))

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const { CompareTurns } = await import('@/components/chat/compare-turns')

const turn = (runId: string): AssistantTurn =>
  ({
    runId,
    messages: [],
    steps: [],
    blocks: [],
    body: `answer of ${runId}`,
    timestamp: 1,
    pendingToolCalls: [],
    toolCards: [],
    durationMs: 0,
    hasContent: true,
    webSearchResults: []
  }) as AssistantTurn

const segment = (over: Partial<CompareSegment>): CompareSegment => ({
  type: 'compare',
  groupId: 'g',
  question: { id: 'g', runId: 'g', role: 'user', content: 'q' } as ChatMessage,
  columns: [turn('g'), turn('r1')],
  folded: null,
  locked: false,
  messages: [],
  ...over
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const choose = vi.fn()
const regenerate = vi.fn()

async function show(
  compare: CompareSegment,
  over: { streaming?: boolean; showsOtherVersion?: boolean } = {}
) {
  await act(async () =>
    root.render(
      createElement(CompareTurns, {
        chatId: 'chat-1',
        segment: compare,
        citationSources: new Map(),
        streaming: over.streaming ?? false,
        regenerate,
        choose,
        runError: null,
        opened: new Set<string>(),
        showsOtherVersion: over.showsOtherVersion
      })
    )
  )
}

const all = (testId: string, within: ParentNode = document.body) => [
  ...within.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)
]
const turnsShown = (within: ParentNode = host) =>
  [...within.querySelectorAll('[data-turn]')].map((el) => el.dataset.turn)
const click = (el: HTMLElement) =>
  act(async () => {
    el.click()
  })

beforeEach(() => {
  wide = true
  choose.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('<CompareTurns> while two answers are compared', () => {
  it('draws them side by side, the earlier first, each with Use this one', async () => {
    await show(segment({}))

    expect(turnsShown()).toEqual(['g', 'r1'])
    const buttons = all(TEST_IDS.chat.compare.useThis)
    expect(buttons).toHaveLength(2)
    expect(all(TEST_IDS.chat.compare.tab)).toHaveLength(0)

    await click(buttons[1])
    expect(choose).toHaveBeenCalledWith('r1')
  })

  it('only the newer answer streams', async () => {
    await show(segment({}), { streaming: true })

    const streaming = [...host.querySelectorAll('[data-turn]')].map(
      (el) => el.dataset.streaming
    )
    expect(streaming).toEqual(['false', 'true'])
  })

  it("gives neither answer's questionnaire or confirmation an answer path", async () => {
    await show(segment({}))
    expect(
      [...host.querySelectorAll('[data-turn]')].map(
        (el) => el.dataset.answerable
      )
    ).toEqual(['false', 'false'])

    wide = false
    await show(segment({}))
    expect(host.querySelector('[data-turn]')?.dataset.answerable).toBe('false')
  })

  it('in a narrow window shows one answer at a time, behind tabs, the newer first', async () => {
    wide = false
    await show(segment({}))

    const tabs = all(TEST_IDS.chat.compare.tab)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'compare.answerTab {"n":1}',
      'compare.answerTab {"n":2}'
    ])
    expect(turnsShown()).toEqual(['r1'])

    await click(all(TEST_IDS.chat.compare.useThis)[0])
    expect(choose).toHaveBeenLastCalledWith('r1')

    await click(tabs[0])
    expect(turnsShown()).toEqual(['g'])
    await click(all(TEST_IDS.chat.compare.useThis)[0])
    expect(choose).toHaveBeenLastCalledWith('g')
  })
})

describe('<CompareTurns> once an answer was chosen', () => {
  const settled = (over: Partial<CompareSegment> = {}) =>
    segment({ columns: [turn('r1')], folded: turn('g'), ...over })

  it('draws no link to the other version for now', async () => {
    // Hidden on both platforms (owner, 2026-09-30); the tests below turn
    // it on to keep what it does covered.
    await show(settled())

    expect(turnsShown()).toEqual(['r1'])
    expect(all(TEST_IDS.chat.compare.otherVersionLink)).toHaveLength(0)
  })

  it('draws the chosen answer with a link to the other', async () => {
    await show(settled(), { showsOtherVersion: true })

    expect(turnsShown()).toEqual(['r1'])
    // The kept answer is the conversation's: its block can be answered.
    expect(host.querySelector('[data-turn]')?.dataset.answerable).toBe('true')
    expect(all(TEST_IDS.chat.compare.useThis)).toHaveLength(0)
    const [link] = all(TEST_IDS.chat.compare.otherVersionLink)
    expect(link.textContent).toBe('compare.otherVersion {"count":1}')
  })

  it('draws no link when there is no other version on record', async () => {
    await show(settled({ folded: null }), { showsOtherVersion: true })

    expect(all(TEST_IDS.chat.compare.otherVersionLink)).toHaveLength(0)
  })

  it('opens the other answer, to read and to use instead', async () => {
    await show(settled(), { showsOtherVersion: true })
    await click(all(TEST_IDS.chat.compare.otherVersionLink)[0])

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(turnsShown(dialog)).toEqual(['g'])
    // An answer that is not in the conversation is not one to regenerate.
    expect(dialog.querySelector('[data-turn]')?.dataset.canRegenerate).toBe(
      'false'
    )
    // Nor one whose questionnaire or confirmation could be answered.
    expect(dialog.querySelector('[data-turn]')?.dataset.answerable).toBe(
      'false'
    )

    await click(all(TEST_IDS.chat.compare.useInstead, dialog)[0])
    expect(choose).toHaveBeenCalledWith('g')
  })

  it('offers no swap once the conversation has moved on', async () => {
    await show(settled({ locked: true }), { showsOtherVersion: true })
    await click(all(TEST_IDS.chat.compare.otherVersionLink)[0])

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(turnsShown(dialog)).toEqual(['g'])
    expect(all(TEST_IDS.chat.compare.useInstead, dialog)).toHaveLength(0)
    expect(dialog.textContent).toContain('compare.locked')
  })
})
