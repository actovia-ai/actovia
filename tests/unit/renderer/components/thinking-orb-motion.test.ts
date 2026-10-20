// @vitest-environment happy-dom
// The orb in a turn's thinking header moves only while that turn is thinking.
// A finished turn's "Thought for 1m 11s" kept the animated `solving` orb, so a
// conversation that had ended looked like it was still loading (owner's report,
// 2026-10-02).
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
const i18n = { language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/components/markdown/markdown', () => ({
  default: () => null,
  Markdown: () => null
}))
vi.mock('thinking-orbs', () => ({
  MODE_FRAMES: { rubik: () => ({}) },
  resolvePreset: () => ({ mode: 'rubik', speed: 1, opts: {} }),
  ThinkingOrb: ({ state, paused }: { state: string; paused?: boolean }) =>
    createElement('canvas', {
      'data-orb': state,
      'data-moving': paused ? 'no' : 'yes'
    })
}))
// What the full transcript needs to render without the app around it.
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

const { ThinkingTimeline, headerIcon } =
  await import('@/components/chat/thinking-timeline')
const { default: Messages, groupIntoSegments } =
  await import('@/components/chat/messages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const user = (id: string) =>
  ({ id, runId: id, role: 'user', content: 'q', timestamp: 1 }) as ChatMessage
const assistant = (id: string, runId: string, content: unknown[]) =>
  ({
    id,
    runId,
    role: 'assistant',
    content,
    stopReason: 'stop',
    timestamp: 2
  }) as unknown as ChatMessage
const thought = { type: 'thinking', thinking: 'Let me weigh this.' }

let host: HTMLDivElement | null = null
afterEach(() => {
  host?.remove()
  host = null
})

async function render(element: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  return [...host.querySelectorAll<HTMLElement>('[data-orb]')].map((orb) => [
    orb.dataset.orb,
    orb.dataset.moving
  ])
}

describe('headerIcon', () => {
  it('moves only while the turn streams', () => {
    expect(headerIcon(true, true)).toBe('live')
    expect(headerIcon(true, false)).toBe('live')
    expect(headerIcon(false, true)).toBe('resting')
    expect(headerIcon(false, false)).toBe('done')
  })
})

describe('the thinking header orb', () => {
  const steps = [{ type: 'thinking' as const, text: 'Let me weigh this.' }]

  it('animates while the turn is thinking', async () => {
    const orbs = await render(
      createElement(ThinkingTimeline, {
        steps,
        durationMs: 0,
        isStreaming: true
      })
    )
    expect(orbs).toEqual([['working', 'yes']])
  })

  it('stands still once the turn is finished', async () => {
    const orbs = await render(
      createElement(ThinkingTimeline, {
        steps,
        durationMs: 71_000,
        isStreaming: false
      })
    )
    expect(orbs).toEqual([['solving', 'no']])
    expect(host?.textContent).toContain('thinkingTimeline.thoughtFor')
  })

  it('stands still for reasoning the <thinking>-tag splitter pulled out', async () => {
    const segment = groupIntoSegments([
      user('u1'),
      assistant('a1', 'u1', [
        { type: 'text', text: '<thinking>Plan it.</thinking>\n\nHere it is.' }
      ])
    ]).find((s) => s.type === 'assistantTurn')
    if (segment?.type !== 'assistantTurn') throw new Error('no turn')
    expect(segment.turn.steps.map((s) => s.type)).toEqual(['thinking'])

    const orbs = await render(
      createElement(ThinkingTimeline, {
        steps: segment.turn.steps,
        durationMs: segment.turn.durationMs,
        isStreaming: false
      })
    )
    expect(orbs).toEqual([['solving', 'no']])
  })

  it('stands still in an older turn while a newer one streams', async () => {
    const orbs = await render(
      createElement(Messages, {
        chatId: 'chat-1',
        status: 'streaming',
        messages: [
          user('u1'),
          assistant('a1', 'u1', [thought, { type: 'text', text: 'Done.' }]),
          user('u2'),
          assistant('a2', 'u2', [thought])
        ],
        regenerate: vi.fn()
      } as never)
    )
    expect(orbs).toEqual([
      ['solving', 'no'],
      ['working', 'yes']
    ])
  })

  it('stands still in every turn once the chat is idle', async () => {
    const orbs = await render(
      createElement(Messages, {
        chatId: 'chat-1',
        status: 'ready',
        messages: [
          user('u1'),
          assistant('a1', 'u1', [thought, { type: 'text', text: 'Done.' }])
        ],
        regenerate: vi.fn()
      } as never)
    )
    expect(orbs).toEqual([['solving', 'no']])
  })
})
