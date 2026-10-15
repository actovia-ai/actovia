// @vitest-environment happy-dom
// Search chats: one row per chat with the query's words marked, the newest
// chats before anything is typed, "no results" only once the search answered,
// and ↓ / Enter opening a chat (cmdk, for real).
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const search = vi.hoisted(() => ({
  value: { data: [] as unknown[], term: '', isSearching: false }
}))
vi.mock('@/hooks/use-chat-search', () => ({
  useChatSearch: () => search.value
}))
const history = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('@/hooks/use-chat-history', () => ({
  useChatHistory: () => ({ data: history.value, isLoading: false })
}))

// The dialog's own behaviour (portal, focus trap, animation) is Base UI's.
const pass = ({ children }: { children?: ReactNode }) =>
  createElement('div', null, children)
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? createElement('div', null, children) : null,
  DialogContent: pass,
  DialogDescription: pass,
  DialogHeader: pass,
  DialogTitle: pass
}))

const { Provider, createStore } = await import('jotai')
const { isSearchChatsVisibleAtom } = await import('@/stores/chat')
const { SearchDialog } = await import('@/layouts/chat-layout/search-dialog')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let path = ''

function Where() {
  path = useLocation().pathname
  return null
}

function mount() {
  const store = createStore()
  store.set(isSearchChatsVisibleAtom, true)
  act(() => {
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          MemoryRouter,
          { initialEntries: ['/'] },
          createElement(SearchDialog),
          createElement(
            Routes,
            null,
            createElement(Route, { path: '*', element: createElement(Where) })
          )
        )
      )
    )
  })
  return store
}

const input = () => host.querySelector('input')!
function type(value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!
    setter.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function press(name: string) {
  act(() => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true })
    )
  })
}

const result = (chatId: string, title: string, snippet?: string) => ({
  chatId,
  title,
  matchedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  snippets: snippet
    ? [
        {
          messageId: `${chatId}-m`,
          role: 'assistant',
          text: snippet,
          createdAt: new Date().toISOString()
        }
      ]
    : []
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  search.value = { data: [], term: '', isSearching: false }
  history.value = []
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('SearchDialog', () => {
  it('draws one row per chat: the title, the snippet with the words marked, and the age', () => {
    search.value = {
      data: [result('c1', 'Duck recipes', '…roast the Duck at 200°C…')],
      term: 'duck',
      isSearching: false
    }
    mount()
    type('duck')

    const rows = host.querySelectorAll('[cmdk-item]')
    expect(rows).toHaveLength(1)
    const marks = [...rows[0].querySelectorAll('mark')].map(
      (m) => m.textContent
    )
    expect(marks).toEqual(['Duck', 'Duck'])
    expect(rows[0].textContent).toContain('…roast the Duck at 200°C…')
    expect(rows[0].textContent).toContain('2d')
  })

  it('lists the newest chats before anything is typed', () => {
    history.value = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      title: `Chat ${i}`,
      createdAt: new Date().toISOString(),
      favorite: false
    }))
    mount()

    expect(host.textContent).toContain('sidebar.search.recent')
    expect(host.querySelectorAll('[cmdk-item]')).toHaveLength(8)
    expect(host.querySelectorAll('mark')).toHaveLength(0)
  })

  it('says there are no results only once the search has answered', () => {
    search.value = { data: [], term: 'du', isSearching: true }
    mount()
    type('duck')
    expect(host.textContent).not.toContain('sidebar.search.noResults')

    search.value = { data: [], term: 'duck', isSearching: false }
    type('duck ')
    expect(host.textContent).toContain(
      'sidebar.search.noResults {"query":"duck"}'
    )
  })

  it('moves with ↓ and opens the selected chat with Enter, closing and clearing', () => {
    search.value = {
      data: [result('c1', 'One'), result('c2', 'Two')],
      term: 'o',
      isSearching: false
    }
    const store = mount()
    type('o')

    press('ArrowDown')
    press('Enter')

    expect(path).toBe('/chat/c2')
    expect(store.get(isSearchChatsVisibleAtom)).toBe(false)
  })
})
