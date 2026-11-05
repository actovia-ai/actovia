// @vitest-environment happy-dom
// ISSUE-237: the Library page lists every artifact, filters by title or
// chat, and a card opens its chat at the run that made it.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../helpers/query-test-utils'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@/lib/format', () => ({
  useFormat: () => ({ relativeTime: () => 'just now' })
}))
const items = [
  {
    artifactId: 'a2',
    title: 'Q3 revenue',
    chatId: 'chat-b',
    chatTitle: 'Sales',
    runId: 'run-2',
    createdAt: '2026-10-14T00:05:00.000Z'
  },
  {
    artifactId: 'a1',
    title: 'Kyoto itinerary',
    chatId: 'chat-a',
    chatTitle: 'Trip planning',
    runId: 'run-1',
    createdAt: '2026-10-14T00:01:00.000Z'
  }
]
vi.mock('@/services/library', () => ({
  getLibraryItems: vi.fn(async () => items)
}))

const { Library } = await import('@/containers/library')

let seen: { pathname: string; state: unknown } | null = null
function Where() {
  const l = useLocation()
  seen = { pathname: l.pathname, state: l.state }
  return null
}

async function render() {
  const { host } = await renderWithQueryClient(
    createElement(
      MemoryRouter,
      { initialEntries: ['/library'] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/library',
          element: createElement(Library)
        }),
        createElement(Route, { path: '*', element: createElement(Where) })
      )
    )
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return host
}

const cards = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>(
    `[data-testid="${TEST_IDS.library.card}"]`
  )
]

describe('Library page', () => {
  it('lists them newest first', async () => {
    const host = await render()
    expect(cards(host).map((c) => c.textContent)).toEqual([
      expect.stringContaining('Q3 revenue'),
      expect.stringContaining('Kyoto itinerary')
    ])
  })

  it('filters by the chat’s title too', async () => {
    const host = await render()
    const input = host.querySelector<HTMLInputElement>(
      `[data-testid="${TEST_IDS.library.search}"]`
    )!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!
      set.call(input, 'trip')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards(host).map((c) => c.textContent)).toEqual([
      expect.stringContaining('Kyoto itinerary')
    ])
  })

  it('opens the chat at the run that made it', async () => {
    const host = await render()
    await act(async () => cards(host)[1].click())
    expect(seen).toEqual({
      pathname: '/chat/chat-a',
      state: { runId: 'run-1', role: 'assistant', words: [] }
    })
  })
})
