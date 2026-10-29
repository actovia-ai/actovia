// @vitest-environment happy-dom
// src/renderer/components/calling-tools/computer-use/computer-use-card.tsx
// — a call left without a result once its run stopped (Stop, or the stream
// otherwise closing) must read as stopped, not as running forever.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = { error: vi.fn() }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})
vi.mock('@/services/computer-use', () => ({
  abortComputerUse: vi.fn(),
  answerComputerUse: vi.fn()
}))

const { ComputerUseCard } =
  await import('@/components/calling-tools/computer-use/computer-use-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

function render(props: {
  toolResult: Record<string, unknown> | null | undefined
  isStreaming: boolean
}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(ComputerUseCard, props)))
  return host
}

describe('ComputerUseCard', () => {
  it('shows running (a step badge), with the Stop control, while its run streams', () => {
    const el = render({
      toolResult: { step: 2, action: 'click' },
      isStreaming: true
    })
    expect(el.textContent).toContain('computerUseCard.stepBadge(2)')
    expect(
      el.querySelector(`[data-testid="${TEST_IDS.computerUse.stopButton}"]`)
    ).not.toBeNull()
  })

  it('shows running (no step yet), with the Stop control, while its run streams', () => {
    const el = render({ toolResult: {}, isStreaming: true })
    expect(el.textContent).toContain('computerUseCard.running')
    expect(
      el.querySelector(`[data-testid="${TEST_IDS.computerUse.stopButton}"]`)
    ).not.toBeNull()
  })

  it('shows stopped, with no Stop control, once the run ends with no result', () => {
    const el = render({
      toolResult: { step: 2, action: 'click' },
      isStreaming: false
    })
    expect(el.textContent).toContain('approval.stopped')
    expect(el.textContent).not.toContain('computerUseCard.stepBadge')
    expect(
      el.querySelector(`[data-testid="${TEST_IDS.computerUse.stopButton}"]`)
    ).toBeNull()
  })

  it('does not show stopped once the call actually finished with an outcome', () => {
    const el = render({
      toolResult: { outcome: 'success', summary: 'done', sessionId: 's1' },
      isStreaming: false
    })
    expect(el.textContent).toContain('computerUseCard.outcome.success')
    expect(el.textContent).not.toContain('approval.stopped')
  })

  it('does not show stopped for a call that ended in its own error', () => {
    const el = render({
      toolResult: { error: 'window closed' },
      isStreaming: false
    })
    expect(el.textContent).toContain('computerUseCard.error')
    expect(el.textContent).not.toContain('approval.stopped')
  })

  it('hides the askHuman reply controls once stopped — replying would do nothing', () => {
    const el = render({
      toolResult: {
        step: 3,
        awaitingHuman: { question: 'Continue?' },
        sessionId: 's1'
      },
      isStreaming: false
    })
    expect(el.textContent).not.toContain('Continue?')
    expect(
      el.querySelector(`[data-testid="${TEST_IDS.computerUse.continueButton}"]`)
    ).toBeNull()
  })

  it('still shows the askHuman reply controls while running', () => {
    const el = render({
      toolResult: {
        step: 3,
        awaitingHuman: { question: 'Continue?' },
        sessionId: 's1'
      },
      isStreaming: true
    })
    expect(el.textContent).toContain('Continue?')
    expect(
      el.querySelector(`[data-testid="${TEST_IDS.computerUse.continueButton}"]`)
    ).not.toBeNull()
  })
})
