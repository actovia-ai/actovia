// @vitest-environment happy-dom
// src/renderer/components/app/update-ready.tsx — the card above the account
// menu while a downloaded update waits, and the dot on the header's toggle.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const updater = vi.hoisted(() => ({
  payload: {
    state: 'ready',
    availableVersion: '2.5.2',
    downloadProgress: 100,
    errorMessage: null,
    mode: 'auto'
  } as Record<string, unknown>,
  install: vi.fn()
}))
vi.mock('@/hooks/use-updater', () => ({
  useUpdater: () => ({ payload: updater.payload, install: updater.install })
}))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: (props: Record<string, unknown>) =>
    createElement('button', props)
}))

const { UpdateReadyCard, HeaderSidebarTrigger } =
  await import('@/components/app/update-ready')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
beforeEach(() => {
  updater.payload = { ...updater.payload, state: 'ready', mode: 'auto' }
  updater.install.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

function render(element: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(element))
  return host
}

const byId = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('UpdateReadyCard', () => {
  it('names the version and restarts on the click, once', () => {
    const el = render(createElement(UpdateReadyCard))
    expect(byId(el, TEST_IDS.chatLayout.updateReady)?.textContent).toContain(
      'sidebar.update.ready(2.5.2)'
    )
    const button = byId(el, TEST_IDS.chatLayout.updateRestart)!
    act(() => button.click())
    expect(updater.install).toHaveBeenCalledOnce()
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('is absent until an update is ready, and for a build that cannot install one', () => {
    updater.payload = { ...updater.payload, state: 'downloading' }
    expect(
      byId(
        render(createElement(UpdateReadyCard)),
        TEST_IDS.chatLayout.updateReady
      )
    ).toBeNull()
    act(() => root?.unmount())
    updater.payload = { ...updater.payload, state: 'ready', mode: 'manual' }
    expect(
      byId(
        render(createElement(UpdateReadyCard)),
        TEST_IDS.chatLayout.updateReady
      )
    ).toBeNull()
  })
})

describe('HeaderSidebarTrigger', () => {
  it('carries a dot only while an update waits', () => {
    expect(
      byId(
        render(createElement(HeaderSidebarTrigger)),
        TEST_IDS.chatLayout.updateDot
      )
    ).not.toBeNull()
    act(() => root?.unmount())
    updater.payload = { ...updater.payload, state: 'idle' }
    expect(
      byId(
        render(createElement(HeaderSidebarTrigger)),
        TEST_IDS.chatLayout.updateDot
      )
    ).toBeNull()
  })
})
