// @vitest-environment happy-dom
// src/renderer/components/philharmonic/chat/plan-card.tsx — the plan as AI
// Elements' Queue draws one (ISSUE-293): a step's state is an outlined glyph
// in the theme's colours, never a palette colour or an emoji, and the header
// folds the list.
import type { PlanDto, StepDto } from '@actovia/shared/types/philharmonic'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/components/philharmonic/employees/employee-avatar', () => ({
  EmployeeAvatar: () => null
}))

const { PlanCard } = await import('@/components/philharmonic/chat/plan-card')

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

const step = (id: string, status: StepDto['status'], note?: string) => ({
  id,
  planId: 'p',
  ordinal: 0,
  title: `Step ${id}`,
  intent: null,
  assignedAgentId: null,
  status,
  output: null,
  note: note ?? null,
  taskId: null,
  startedAt: null,
  completedAt: null
})

const plan = (status: PlanDto['status'], steps: StepDto[]): PlanDto => ({
  id: 'p',
  conversationId: 'c',
  summary: 'Ship the report',
  status,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  steps
})

function render(p: PlanDto) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(PlanCard, { plan: p, agentsById: {} })))
  return host
}

const trigger = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')!

describe('PlanCard', () => {
  it('draws each step with a glyph and no palette colour or emoji', () => {
    const el = render(
      plan('active', [
        step('a', 'done'),
        step('b', 'running'),
        step('c', 'failed', 'quota reached')
      ])
    )
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    expect(el.querySelectorAll('li svg')).toHaveLength(3)
    expect(el.textContent).not.toMatch(/[⏳✓✗●○]/u)
    expect(el.innerHTML).not.toMatch(/emerald|amber|#[0-9a-f]{6}/i)
    expect(
      el.querySelector('[data-status="failed"] svg')?.getAttribute('class')
    ).toContain('text-destructive')
    expect(el.textContent).toContain('1/3')
    const note = [...el.querySelectorAll('div')].find(
      (d) => d.textContent === 'quota reached'
    )
    expect(note?.className).toContain('text-warning')
  })

  it('a finished plan starts folded and the header opens it', () => {
    const el = render(plan('completed', [step('a', 'done')]))
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
    act(() => trigger(el).click())
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('Step a')
  })
})
