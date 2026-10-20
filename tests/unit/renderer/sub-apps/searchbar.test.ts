// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ipc = vi.hoisted(() => ({
  closeSearchbar: vi.fn(async () => {}),
  findInPage: vi.fn(async () => {}),
  findNext: vi.fn(async () => {}),
  findPrevious: vi.fn(async () => {}),
  subscribeFindInPageResult: vi.fn(),
  unsubscribeFindInPageResult: vi.fn(),
  subscribeFocusSearchBar: vi.fn(),
  unsubscribeFocusSearchBar: vi.fn()
}))
vi.mock('@/lib/ipc', () => ipc)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { SearchBar } = await import('@/sub-apps/searchbar/app')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const byId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init
      })
    )
  })
}

/** Deliver a find-in-page result the way the main process does. */
function report(result: { matches: number; activeMatchOrdinal: number }) {
  const [handler] = ipc.subscribeFindInPageResult.mock.calls.at(-1)!
  act(() => handler({}, { finalUpdate: true, ...result }))
}

beforeEach(() => {
  for (const fn of Object.values(ipc)) fn.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(createElement(SearchBar)))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('find bar', () => {
  it('searches as the user types, with the query trimmed', () => {
    type(byId(TEST_IDS.findInPage.input) as HTMLInputElement, '  hello ')
    expect(ipc.findInPage).toHaveBeenLastCalledWith('hello')
  })

  it('clears the highlights when the query is emptied', () => {
    const input = byId(TEST_IDS.findInPage.input) as HTMLInputElement
    type(input, 'hello')
    type(input, '')
    expect(ipc.findInPage).toHaveBeenLastCalledWith('')
  })

  it('starts with the input focused', () => {
    expect(document.activeElement).toBe(byId(TEST_IDS.findInPage.input))
  })

  it('shows the position among the matches and enables stepping', () => {
    const input = byId(TEST_IDS.findInPage.input) as HTMLInputElement
    expect(
      (byId(TEST_IDS.findInPage.nextButton) as HTMLButtonElement).disabled
    ).toBe(true)

    type(input, 'hello')
    report({ matches: 5, activeMatchOrdinal: 2 })

    expect(host.textContent).toContain('2/5')
    expect(
      (byId(TEST_IDS.findInPage.nextButton) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('says so when nothing matches, and keeps stepping disabled', () => {
    type(byId(TEST_IDS.findInPage.input) as HTMLInputElement, 'zzz')
    report({ matches: 0, activeMatchOrdinal: 0 })

    expect(host.textContent).toContain('findInPage.noResults')
    expect(
      (byId(TEST_IDS.findInPage.nextButton) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('Enter goes to the next match and Shift+Enter to the previous, from the input', () => {
    const input = byId(TEST_IDS.findInPage.input) as HTMLInputElement
    type(input, 'hello')
    report({ matches: 3, activeMatchOrdinal: 1 })

    press(input, 'Enter')
    expect(ipc.findNext).toHaveBeenCalledWith('hello')

    press(input, 'Enter', { shiftKey: true })
    expect(ipc.findPrevious).toHaveBeenCalledWith('hello')
  })

  it('an Enter that confirms an IME composition is not a "next match"', () => {
    const input = byId(TEST_IDS.findInPage.input) as HTMLInputElement
    type(input, '你好')
    press(input, 'Enter', { isComposing: true })
    expect(ipc.findNext).not.toHaveBeenCalled()
  })

  it('the arrow buttons step through matches', () => {
    type(byId(TEST_IDS.findInPage.input) as HTMLInputElement, 'hello')
    report({ matches: 3, activeMatchOrdinal: 1 })

    act(() => byId(TEST_IDS.findInPage.nextButton).click())
    expect(ipc.findNext).toHaveBeenCalledWith('hello')
    act(() => byId(TEST_IDS.findInPage.previousButton).click())
    expect(ipc.findPrevious).toHaveBeenCalledWith('hello')
  })

  it('Escape and the close button both close the bar', () => {
    press(byId(TEST_IDS.findInPage.input), 'Escape')
    expect(ipc.closeSearchbar).toHaveBeenCalledTimes(1)

    act(() => byId(TEST_IDS.findInPage.closeButton).click())
    expect(ipc.closeSearchbar).toHaveBeenCalledTimes(2)
  })

  it('a fresh re-open starts empty; pressing Cmd+F while open keeps the query', () => {
    const input = byId(TEST_IDS.findInPage.input) as HTMLInputElement
    type(input, 'hello')
    const [onFocus] = ipc.subscribeFocusSearchBar.mock.calls.at(-1)!

    act(() => onFocus({}, false))
    expect(input.value).toBe('hello')

    act(() => onFocus({}, true))
    expect(input.value).toBe('')
  })

  it('stops listening for results and focus requests when it goes away', () => {
    act(() => root.unmount())
    expect(ipc.unsubscribeFindInPageResult).toHaveBeenCalled()
    expect(ipc.unsubscribeFocusSearchBar).toHaveBeenCalled()
    root = createRoot(host)
  })
})
