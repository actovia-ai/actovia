// @vitest-environment happy-dom
// The header's context ring (ISSUE-235): how full, in its label; the warning
// colour once the next run compacts; nothing before a run; a click opens the
// panel on Context.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatContextSnapshot } from '@actovia/shared/types/chat-context'
import { createStore, Provider } from 'jotai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, o: Record<string, unknown> = {}) =>
  `${key}(${Object.values(o).join(',')})`
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { resolvedLanguage: 'en' } })
}))
let data: ChatContextSnapshot | null = null
vi.mock('@/hooks/use-chat-context', () => ({
  useChatContext: () => ({ data })
}))

const { ContextRing } = await import('@/components/chat/header/context-ring')
const { chatPanelAtom } = await import('@/stores/chat')

const snapshot = (messages: number, compactAt: number | null) =>
  ({
    takenAt: '2026-10-27T10:00:00.000Z',
    runId: 'r',
    model: 'm',
    contextWindow: 1_000_000,
    compactAt,
    total: messages + 10_000,
    estimated: false,
    parts: [
      { key: 'system', tokens: 10_000 },
      { key: 'messages', tokens: messages }
    ]
  }) as ChatContextSnapshot

const mounted: Array<() => void> = []
afterEach(() => mounted.splice(0).forEach((u) => u()))

function render() {
  const store = createStore()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(ContextRing, { chatId: 'c' })
      )
    )
  )
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const ring = host.querySelector<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.header.contextRing}"]`
  )
  return { store, ring }
}

describe('<ContextRing>', () => {
  it('is not there before the chat has run', () => {
    data = null
    expect(render().ring).toBeNull()
  })

  it('names the share used and opens the panel on Context', () => {
    data = snapshot(576_300, 750_000)
    const { ring, store } = render()
    expect(ring?.getAttribute('aria-label')).toBe(
      'header.contextRing(59,586.3K,1M)'
    )
    expect(ring?.hasAttribute('data-past-compaction')).toBe(false)
    expect(ring?.querySelector('svg')?.getAttribute('class')).toContain(
      'text-primary'
    )
    act(() => ring?.click())
    expect(store.get(chatPanelAtom)).toMatchObject({
      open: true,
      section: 'context'
    })
  })

  it('turns to the warning colour once the next run compacts', () => {
    data = snapshot(760_000, 750_000)
    const { ring } = render()
    expect(ring?.hasAttribute('data-past-compaction')).toBe(true)
    expect(ring?.querySelector('svg')?.getAttribute('class')).toContain(
      'text-warning'
    )
  })
})
