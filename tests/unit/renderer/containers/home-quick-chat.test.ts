// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The hand-off under test is the wiring — the bridge, the router, `Home`,
// `Chat`'s send-on-mount — so the chat's own machinery is stood in for:
// `useChat` records which chat was asked to send what.
const chat = vi.hoisted(() => ({
  sent: [] as { chatId: string; text: string }[]
}))
vi.mock('@/hooks/use-chat', () => ({
  useChat: ({ id }: { id: string }) => ({
    messages: [],
    status: 'ready',
    runError: undefined,
    stop: () => {},
    regenerate: () => {},
    sendMessage: ({ text }: { text: string }) =>
      chat.sent.push({ chatId: id, text })
  })
}))
vi.mock('@/hooks/use-attempts', () => ({
  useChooseAttempt: () => ({ choose: () => {}, isPending: false })
}))
vi.mock('@/hooks/use-older-pages', () => ({
  useOlderPages: () => ({
    hasOlder: false,
    loadingOlder: false,
    loadOlder: () => Promise.resolve(),
    olderSources: [],
    olderQuestions: [],
    historyIds: new Set()
  })
}))
vi.mock('@/components/chat/messages', () => ({ default: () => null }))
vi.mock('@/components/chat/composer/composer', () => ({ default: () => null }))
vi.mock('@/components/chat/lcm-status-card', () => ({
  LcmStatusCard: () => null
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = { error: vi.fn() }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

// The bridge navigates the app's one router; each test gets its own.
let router: ReturnType<typeof createMemoryRouter>
vi.mock('@/routes', () => ({
  router: { navigate: (...args: [string]) => router.navigate(...args) }
}))

const listeners: Record<string, (event: unknown, text: string) => void> = {}
Object.assign(window, {
  electron: {
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, text: string) => void) => {
        listeners[channel] = cb
      },
      removeListener: () => {}
    }
  }
})

const { Home } = await import('@/containers/home')
const { installQuickChatBridge } = await import('@/lib/quick-chat-bridge')
installQuickChatBridge()

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function open(path: string) {
  router = createMemoryRouter(
    [
      { path: '/', Component: Home },
      { path: '/chat/:id', Component: () => null },
      { path: '/settings', Component: () => null }
    ],
    { initialEntries: [path] }
  )
  await act(async () => {
    root.render(createElement(RouterProvider, { router }))
  })
}

const quickChat = (text: string) =>
  act(async () => {
    listeners['quick-chat-input']({}, text)
  })

beforeEach(() => {
  chat.sent.length = 0
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('quick chat hand-off to the main window', () => {
  it('sends the text in a new chat when the window already shows Home', async () => {
    await open('/')

    await quickChat('hello from the tray')

    expect(chat.sent.map((m) => m.text)).toEqual(['hello from the tray'])
  })

  it('sends the text in a new chat when the window shows a conversation', async () => {
    await open('/chat/0b0f7a3e-1f0c-4c6e-9d57-6a3f2f4f8f10')

    await quickChat('hello from the tray')

    expect(router.state.location.pathname).toBe('/')
    expect(chat.sent.map((m) => m.text)).toEqual(['hello from the tray'])
  })

  it('sends the text when the window shows a page outside the chat layout', async () => {
    await open('/settings')

    await quickChat('hello from the tray')

    expect(router.state.location.pathname).toBe('/')
    expect(chat.sent.map((m) => m.text)).toEqual(['hello from the tray'])
  })

  it('starts a chat of its own for each quick chat', async () => {
    await open('/')

    await quickChat('first')
    await quickChat('second')

    expect(chat.sent.map((m) => m.text)).toEqual(['first', 'second'])
    expect(chat.sent[0].chatId).not.toBe(chat.sent[1].chatId)
  })

  it('sends the text once, however often Home renders again', async () => {
    await open('/')
    await quickChat('only once')

    await act(async () => {
      root.render(createElement(RouterProvider, { router }))
    })

    expect(chat.sent.map((m) => m.text)).toEqual(['only once'])
  })
})
