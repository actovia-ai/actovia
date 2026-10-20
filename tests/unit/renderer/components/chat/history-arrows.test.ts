// @vitest-environment happy-dom
// The `←` `→` beside the sidebar toggle: enabled by the app's own page
// history, each going to the entry's own path.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    render
      ? createElement(
          (render as { type: string }).type,
          {
            ...(render as { props: object }).props,
            ...Object.fromEntries(
              Object.entries(props).filter(([k]) => k.startsWith('data-'))
            )
          },
          children as ReactNode
        )
      : createElement(tag, {}, children as ReactNode)
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: pass('span'),
  TooltipTrigger: pass('span'),
  TooltipContent: () => null,
  TooltipProvider: pass('div')
}))

const { HistoryArrows } =
  await import('@/components/chat/header/history-arrows')
const { historyAtom } = await import('@/stores/history')
const { EMPTY_HISTORY, pushed } = await import('@/lib/route-history')

const visit = (...paths: string[]) => paths.reduce(pushed, EMPTY_HISTORY)

const mounted: Array<() => void> = []
afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount())
})

function mount(path: string, history = visit(path)) {
  const store = createStore()
  store.set(historyAtom, history)
  const router = createMemoryRouter(
    [{ path: '*', element: createElement(HistoryArrows) }],
    { initialEntries: [path] }
  )
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(RouterProvider, { router })
      )
    )
  )
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const button = (id: string) =>
    host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
  return { store, router, button }
}

describe('<HistoryArrows>', () => {
  it('both arrows are off on the first page', () => {
    const { button } = mount('/')
    expect(button(TEST_IDS.chat.header.back).disabled).toBe(true)
    expect(button(TEST_IDS.chat.header.forward).disabled).toBe(true)
  })

  it('back goes to the page before and enables forward; forward returns', () => {
    const { button, store, router } = mount('/chat/c1', visit('/', '/chat/c1'))
    expect(button(TEST_IDS.chat.header.back).disabled).toBe(false)
    expect(button(TEST_IDS.chat.header.forward).disabled).toBe(true)

    act(() => button(TEST_IDS.chat.header.back).click())
    expect(router.state.location.pathname).toBe('/')
    expect(store.get(historyAtom).index).toBe(0)
    expect(button(TEST_IDS.chat.header.back).disabled).toBe(true)
    expect(button(TEST_IDS.chat.header.forward).disabled).toBe(false)

    act(() => button(TEST_IDS.chat.header.forward).click())
    expect(router.state.location.pathname).toBe('/chat/c1')
    expect(store.get(historyAtom).index).toBe(1)
  })
})
