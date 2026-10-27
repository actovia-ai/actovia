// @vitest-environment happy-dom
// ISSUE-132: the Costs page shows the PM's own rounds, and a CLI employee's
// API-price estimate apart from what was spent.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { resolvedLanguage: 'en', language: 'en' }
  })
}))
// The header slot portals into the layout's bar; here, inline.
vi.mock('@/layouts/philharmonic-layout/philharmonic-content-header', () => ({
  PhilharmonicHeaderSlot: ({ children }: { children: unknown }) => children
}))
vi.mock('@/services/philharmonic', () => ({
  getAgents: async () => [
    { id: 'kai', name: 'Kai', avatarSeed: 'k', avatarStyle: 'notionists' }
  ]
}))
vi.mock('@/services/philharmonic-chat', () => ({
  getConversations: async () => [],
  getPhilharmonicCosts: async () => ({
    totalCost: 0.3,
    estimatedCost: 1.25,
    totalTokens: 5000,
    byConversation: [],
    byAgent: [{ agentId: 'kai', cost: 0, estimatedCost: 1.25, tokens: 4600 }],
    pm: { cost: 0.3, tokens: 400 },
    daily: [
      { date: '2026-10-27', cost: 0.3, estimatedCost: 1.25, tokens: 5000 }
    ]
  })
}))

const { CostAnalysis } = await import('@/components/philharmonic/cost-analysis')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('CostAnalysis', () => {
  it('lists the PM, and a CLI employee by its estimate', async () => {
    await act(async () => {
      root.render(
        createElement(MemoryRouter, null, createElement(CostAnalysis))
      )
    })
    await act(async () => {})
    const text = host.textContent ?? ''

    expect(text).toContain('costAnalysis.agentCostList.pm')
    expect(text).toContain('costAnalysis.kpi.totalCostEstimatedHint')
    expect(text).toContain('costAnalysis.estimated {"cost":"$1.25"}')
    // The total is what was spent: the PM, not the estimate.
    expect(text).toContain('$0.30')
  })

  it('fills the period on show', async () => {
    await act(async () => {
      root.render(
        createElement(MemoryRouter, null, createElement(CostAnalysis))
      )
    })
    await act(async () => {})
    const pressed = host.querySelector('[aria-pressed="true"]')!
    expect(pressed.className).toContain('aria-pressed:bg-primary')
  })
})
