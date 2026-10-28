// @vitest-environment happy-dom
// Chat / Philharmonic as the sidebar's title (owner, 2026-10-28, back from
// ISSUE-237's icon switch): the surface on show names the trigger, and its
// menu lists both, the one on show checked.
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

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

async function openMenu() {
  await act(async () => byId(TEST_IDS.chatLayout.workspaceSwitcher)!.click())
}

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
  it('names Chat on a chat page, and goes to Philharmonic from its menu', async () => {
    await render('/chat/abc')
    const trigger = byId(TEST_IDS.chatLayout.workspaceSwitcher)!
    expect(trigger.textContent).toContain('sidebar.workspace.chat')
    expect(byId(TEST_IDS.chatLayout.workspacePhilharmonic)).toBeNull()

    await openMenu()
    expect(
      byId(TEST_IDS.chatLayout.workspaceChat)!.getAttribute('aria-current')
    ).toBe('page')
    expect(
      byId(TEST_IDS.chatLayout.workspacePhilharmonic)!.textContent
    ).toContain('sidebar.workspace.philharmonicDescription')
    await act(async () =>
      byId(TEST_IDS.chatLayout.workspacePhilharmonic)!.click()
    )
    expect(path).toBe('/philharmonic')
  })

  it('names Philharmonic inside it, and goes back to Chat', async () => {
    await render('/philharmonic/groups/g1')
    expect(byId(TEST_IDS.chatLayout.workspaceSwitcher)!.textContent).toContain(
      'sidebar.workspace.philharmonic'
    )
    await openMenu()
    expect(
      byId(TEST_IDS.chatLayout.workspacePhilharmonic)!.getAttribute(
        'aria-current'
      )
    ).toBe('page')
    await act(async () => byId(TEST_IDS.chatLayout.workspaceChat)!.click())
    expect(path).toBe('/')
  })
})
