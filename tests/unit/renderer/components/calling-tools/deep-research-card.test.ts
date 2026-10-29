// @vitest-environment happy-dom
// src/renderer/components/calling-tools/deep-research/deep-research-card.tsx
// — a job that ended 'failed' server-side must render as failed, with its
// stored message, instead of hanging on an empty button forever.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = { error: vi.fn() }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

let current: Record<string, unknown> | undefined
vi.mock('@/hooks/use-deep-research', () => ({
  useDeepResearchResult: () => ({ data: current, refetch: vi.fn() })
}))

const { DeepResearchCard } =
  await import('@/components/calling-tools/deep-research/deep-research-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  current = undefined
})

function render() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      createElement(DeepResearchCard, {
        toolResult: { id: 'dr-1', toolCallId: 'c-1' }
      })
    )
  )
  return host
}

describe('DeepResearchCard', () => {
  it('shows the failed state with its stored message', () => {
    current = {
      id: 'dr-1',
      toolCallId: 'c-1',
      title: 'A subject',
      jobStatus: 'failed',
      finalReport: null,
      webSources: null,
      errorMessage: 'TypeError: search backend unreachable',
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:01:00Z')
    }
    const el = render()
    expect(el.textContent).toContain('deepResearchCard.failed')
    expect(el.textContent).toContain('TypeError: search backend unreachable')
    // No download button — there is no report to export.
    expect(el.querySelector('[aria-label]')).toBeNull()
  })

  it('a failed job with no stored message still shows the failed label alone', () => {
    current = {
      id: 'dr-1',
      toolCallId: 'c-1',
      title: 'A subject',
      jobStatus: 'failed',
      finalReport: null,
      webSources: null,
      errorMessage: null,
      startTime: new Date(),
      endTime: new Date()
    }
    const el = render()
    expect(el.textContent).toContain('deepResearchCard.failed')
  })

  it('an archived (completed) job still renders its summary, unaffected', () => {
    current = {
      id: 'dr-1',
      toolCallId: 'c-1',
      title: 'A subject',
      jobStatus: 'archived',
      finalReport: null,
      webSources: [{ link: 'https://a.example', title: 'A', rank: 1 }],
      errorMessage: null,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:05:00Z')
    }
    const el = render()
    expect(el.textContent).toContain('deepResearchCard.completedSummary')
    expect(el.textContent).not.toContain('deepResearchCard.failed')
  })
})
