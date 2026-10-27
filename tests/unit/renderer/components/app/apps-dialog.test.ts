// @vitest-environment happy-dom
// ISSUE-237: "Actovia everywhere" — the iPhone app, Health and the CLI, each
// with its docs; Pair an iPhone goes to Settings → Devices and closes.
import {
  ACTOVIA_CLI_DOCS,
  ACTOVIA_HEALTH_DOCS,
  ACTOVIA_IPHONE_DOCS
} from '@actovia/shared/constants/external-urls'
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

const { AppsDialog, CLI_INSTALL_COMMAND } =
  await import('@/components/app/apps-dialog')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let where = ''

function Where() {
  const l = useLocation()
  where = l.pathname + l.search
  return null
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

async function render(onOpenChange: (open: boolean) => void) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        createElement(AppsDialog, { open: true, onOpenChange }),
        createElement(
          Routes,
          null,
          createElement(Route, { path: '*', element: createElement(Where) })
        )
      )
    )
  })
}

describe('AppsDialog', () => {
  it('names the iPhone app, Health and the CLI, each with its docs', async () => {
    await render(() => {})
    const dialog = document.querySelector(
      `[data-testid="${TEST_IDS.chatLayout.appsDialog}"]`
    )!
    expect(dialog).toBeTruthy()
    const hrefs = [...dialog.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )
    expect(hrefs).toEqual([
      ACTOVIA_IPHONE_DOCS,
      ACTOVIA_HEALTH_DOCS,
      ACTOVIA_CLI_DOCS
    ])
    expect(dialog.textContent).toContain(CLI_INSTALL_COMMAND)
  })

  it('Pair an iPhone opens Settings → Devices and closes the dialog', async () => {
    const onOpenChange = vi.fn()
    await render(onOpenChange)
    const pair = document.querySelector<HTMLButtonElement>(
      `[data-testid="${TEST_IDS.chatLayout.appsPairIphone}"]`
    )!
    await act(async () => pair.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(where).toBe('/settings?tab=devices')
  })
})
