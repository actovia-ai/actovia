// @vitest-environment happy-dom
// ISSUE-237: Chat / Philharmonic at the sidebar's top right — the current one
// selected, the other a click away. ISSUE-266: shadcn's Tabs, so it is a
// tablist of two tabs (arrow keys move between them).
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { WorkspaceSwitcher } =
  await import('@/components/app/workspace-switcher')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let path = ''

function Where() {
  path = useLocation().pathname
  return null
}

async function render(at: string) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [at] },
        createElement(WorkspaceSwitcher),
        createElement(
          Routes,
          null,
          createElement(Route, { path: '*', element: createElement(Where) })
        )
      )
    )
  })
}

const button = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('WorkspaceSwitcher', () => {
  it('selects Chat on a chat page, and goes to Philharmonic on a click', async () => {
    await render('/chat/abc')
    expect(
      button(TEST_IDS.chatLayout.workspaceSwitcher).getAttribute('role')
    ).toBe('tablist')
    expect(button(TEST_IDS.chatLayout.workspaceChat).getAttribute('role')).toBe(
      'tab'
    )
    expect(
      button(TEST_IDS.chatLayout.workspaceChat).getAttribute('aria-selected')
    ).toBe('true')
    expect(
      button(TEST_IDS.chatLayout.workspacePhilharmonic).getAttribute(
        'aria-selected'
      )
    ).toBe('false')
    await act(async () =>
      button(TEST_IDS.chatLayout.workspacePhilharmonic).click()
    )
    expect(path).toBe('/philharmonic')
  })

  it('selects Philharmonic inside it', async () => {
    await render('/philharmonic/groups/g1')
    expect(
      button(TEST_IDS.chatLayout.workspacePhilharmonic).getAttribute(
        'aria-selected'
      )
    ).toBe('true')
    await act(async () => button(TEST_IDS.chatLayout.workspaceChat).click())
    expect(path).toBe('/')
  })
})
