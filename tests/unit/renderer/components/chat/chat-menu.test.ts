// @vitest-environment happy-dom
// The ▾ beside the title: the sidebar row's actions for the chat on screen,
// and the two exports.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '@/types/db'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join('|')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('sileo', () => ({ sileo: toast }))

const mutate = vi.fn()
vi.mock('@/hooks/use-chat-history', () => ({
  useUpdateChat: () => ({ mutate })
}))

const downloadFile = vi.fn()
vi.mock('@/lib/utils', async (original) => ({
  ...(await original<typeof import('@/lib/utils')>()),
  downloadFile: (blob: Blob, name: string) => downloadFile(blob, name)
}))

const markdownToPdf = vi.fn()
vi.mock('@/services/tools', () => ({
  markdownToPdf: (markdown: string) => markdownToPdf(markdown)
}))

const fetchChatMessages = vi.fn()
vi.mock('@/services/chat', () => ({
  fetchChatMessages: (chatId: string) => fetchChatMessages(chatId)
}))

// The menu is always open here; what is tested is what its items do.
const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    render
      ? (render as ReactNode)
      : createElement(
          tag,
          Object.fromEntries(
            Object.entries(props).filter(
              ([key]) =>
                key.startsWith('data-') ||
                key === 'onClick' ||
                key === 'disabled'
            )
          ),
          children as ReactNode
        )
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: pass('div'),
  DropdownMenuContent: pass('div'),
  DropdownMenuItem: pass('button'),
  DropdownMenuSeparator: pass('hr'),
  DropdownMenuTrigger: pass('div')
}))

const { ChatMenu } = await import('@/components/chat/header/chat-menu')
const { chatMessagesAtom, renamedChatTitleAtom, toBeDeletedChatAtom } =
  await import('@/stores/chat')

const chat = {
  id: '5b30d978-ebe8-4da6-9e73-02c6fc42b771',
  title: 'Trip planning',
  createdAt: new Date('2026-09-29T08:00:00.000Z'),
  favorite: false
} as Chat

const messages = [
  {
    id: 'r1',
    runId: 'r1',
    role: 'user',
    content: [{ type: 'text', text: 'Hi' }],
    timestamp: 1
  },
  {
    id: 'r1-a',
    runId: 'r1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello.' }],
    timestamp: 2
  }
] as unknown as ChatMessage[]

// The whole chat as `GET /api/v1/chat/:id` answers it: what an export is
// written from, not the loaded page above (whose answer reads differently).
const rows = [
  {
    id: 'r1',
    chatId: chat.id,
    runId: 'r1',
    role: 'user',
    content: [{ type: 'text', text: 'Hi' }],
    createdAt: '2026-09-29T08:00:00.000Z'
  },
  {
    id: 'r1-a',
    chatId: chat.id,
    runId: 'r1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from the whole chat.' }],
    createdAt: '2026-09-29T08:00:01.000Z'
  }
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>

beforeEach(() => {
  mutate.mockClear()
  downloadFile.mockClear()
  markdownToPdf.mockReset()
  toast.error.mockClear()
  fetchChatMessages.mockReset()
  fetchChatMessages.mockResolvedValue(rows)
  store = createStore()
  store.set(chatMessagesAtom, messages)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// No argument renders `chat`; an explicit `undefined` renders no chat.
const render = (...args: [Chat | undefined] | []) =>
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(ChatMenu, { chat: args.length > 0 ? args[0] : chat })
      )
    )
  )
const item = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label
  )

describe('<ChatMenu>', () => {
  it('lists rename, favourite, the two exports and delete', () => {
    render()
    expect(
      host.querySelector(`[data-testid="${TEST_IDS.chat.header.menu}"]`)
    ).not.toBeNull()
    expect(
      [...host.querySelectorAll('button')].map((b) => b.textContent)
    ).toEqual([
      '',
      'chat:sidebar.history.rename',
      'chat:sidebar.history.favoriteAction',
      'chat:header.exportMarkdown',
      'chat:header.exportPdf',
      'action.delete'
    ])
  })

  it('rename opens the rename dialog on this chat', () => {
    render()
    act(() => item('chat:sidebar.history.rename')!.click())
    expect(store.get(renamedChatTitleAtom)).toEqual({
      id: chat.id,
      title: chat.title,
      open: true
    })
  })

  it('favourite toggles the flag; a favourite reads Unfavourite', () => {
    render()
    act(() => item('chat:sidebar.history.favoriteAction')!.click())
    expect(mutate).toHaveBeenCalledWith({ id: chat.id, favorite: true })
    render({ ...chat, favorite: true })
    expect(item('chat:sidebar.history.unfavorite')).toBeDefined()
  })

  it('export as Markdown saves the whole chat, fetched, as <title>.md', async () => {
    render()
    await act(async () => item('chat:header.exportMarkdown')!.click())
    expect(fetchChatMessages).toHaveBeenCalledWith(chat.id)
    expect(downloadFile).toHaveBeenCalledTimes(1)
    const [blob, name] = downloadFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('Trip planning.md')
    expect(await blob.text()).toBe(
      '# Trip planning\n\n**chat:export.you:**\n\nHi\n\n**chat:export.assistant:**\n\nHello from the whole chat.\n'
    )
  })

  it('a chat that cannot be fetched is toasted and nothing is saved', async () => {
    fetchChatMessages.mockRejectedValue(new Error('server away'))
    render()
    await act(async () => item('chat:header.exportMarkdown')!.click())
    expect(toast.error).toHaveBeenCalledWith({
      title: 'chat:header.exportFailed',
      description: 'server away'
    })
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('the exports are off while one runs', async () => {
    let settle!: (value: unknown) => void
    fetchChatMessages.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    render()
    await act(async () => item('chat:header.exportMarkdown')!.click())
    expect(item('chat:header.exportMarkdown')?.disabled).toBe(true)
    expect(item('chat:header.exportPdf')?.disabled).toBe(true)
    await act(async () => settle(rows))
    expect(downloadFile).toHaveBeenCalledTimes(1)
    expect(item('chat:header.exportMarkdown')?.disabled).toBe(false)
    expect(item('chat:header.exportPdf')?.disabled).toBe(false)
  })

  it('export as PDF posts that Markdown and saves <title>.pdf; a failure is toasted', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    markdownToPdf.mockResolvedValue(pdf)
    render()
    await act(async () => item('chat:header.exportPdf')!.click())
    expect(fetchChatMessages).toHaveBeenCalledWith(chat.id)
    expect(markdownToPdf).toHaveBeenCalledWith(
      expect.stringContaining('Hello from the whole chat.')
    )
    expect(downloadFile).toHaveBeenCalledWith(pdf, 'Trip planning.pdf')

    markdownToPdf.mockRejectedValue(new Error('printer on fire'))
    await act(async () => item('chat:header.exportPdf')!.click())
    expect(toast.error).toHaveBeenCalledWith({
      title: 'chat:header.exportFailed',
      description: 'printer on fire'
    })
  })

  it('the exports are off for an empty chat', () => {
    store.set(chatMessagesAtom, [])
    render()
    expect(item('chat:header.exportMarkdown')?.disabled).toBe(true)
    expect(item('chat:header.exportPdf')?.disabled).toBe(true)
  })

  it('delete asks through the deletion dialog', () => {
    render()
    act(() => item('action.delete')!.click())
    expect(store.get(toBeDeletedChatAtom)).toEqual(chat)
  })

  it('is nothing until the history list has the chat', () => {
    render(undefined)
    expect(host.querySelector('button')).toBeNull()
  })
})
