// @vitest-environment happy-dom
// The header's panel: what the chat produced and used, in three sections,
// each row a way back to its run.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join('|')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const scrollToRun = vi.fn(() => true)
vi.mock('@/lib/scroll-to-run', () => ({
  scrollToRun: (id: string) => scrollToRun(id)
}))

// The tabs' own behaviour is Base UI's; here each trigger is a plain button.
const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    render
      ? (render as ReactNode)
      : createElement(
          tag,
          Object.fromEntries(
            Object.entries(props).filter(
              ([key]) => key.startsWith('data-') || key === 'onClick'
            )
          ),
          children as ReactNode
        )
vi.mock('@/components/ui/tabs', () => ({
  Tabs: pass('div'),
  TabsList: pass('div'),
  TabsTrigger: pass('button')
}))

const { ChatPanel } = await import('@/components/chat/panel/chat-panel')
const { chatMessagesAtom, chatPanelAtom, revealArtifactAtom } =
  await import('@/stores/chat')

const user = (id: string, text: string, images = 0): ChatMessage =>
  ({
    id,
    runId: id,
    role: 'user',
    content: [
      { type: 'text', text },
      ...Array.from({ length: images }, (_, i) => ({
        type: 'image',
        data: `data:image/png;base64,${id}${i}`,
        mimeType: 'image/png'
      }))
    ],
    timestamp: 1
  }) as unknown as ChatMessage

const result = (
  runId: string,
  toolName: string,
  details: unknown
): ChatMessage =>
  ({
    id: `${runId}-${toolName}`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-${toolName}-call`,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    details,
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

const messages: ChatMessage[] = [
  user('r1', 'Make me a page', 1),
  result('r1', 'create_artifact', {
    type: 'artifact',
    title: 'Landing',
    code: '',
    artifactId: 'a1'
  }),
  result('r1', 'write_file', { path: '/ws/c/notes.md' }),
  user('r2', 'Search it'),
  result('r2', 'web_search', [
    {
      rank: 1,
      link: 'https://a.example/x',
      title: 'A page',
      content: '',
      snippet: 'about *a*'
    }
  ]),
  result('r2', 'web_search', [
    {
      rank: 2,
      link: 'https://b.example/y',
      title: 'B page',
      content: '',
      snippet: ''
    }
  ])
]

const mounted: Array<() => void> = []
afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount())
  scrollToRun.mockClear()
})

function mount(
  panel: {
    open: boolean
    section: 'files' | 'tools' | 'sources'
    runId?: string
  },
  path = '/chat/c1',
  list = messages
) {
  const store = createStore()
  store.set(chatMessagesAtom, list)
  store.set(chatPanelAtom, panel)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/chat/:id',
              element: createElement(ChatPanel)
            }),
            createElement(Route, {
              path: '/',
              element: createElement(ChatPanel)
            })
          )
        )
      )
    )
  )
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, store }
}

const rows = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.panel.item}"]`
  )
]

describe('<ChatPanel>', () => {
  it('lists the files newest first, each under its question, and the tabs carry counts', () => {
    const { host } = mount({ open: true, section: 'files' })
    const items = rows(host)
    expect(items.map((r) => r.dataset.kind)).toEqual([
      'workspace-file',
      'artifact',
      'user-image'
    ])
    expect(items[0].textContent).toContain('notes.md')
    expect(items[0].textContent).toContain('Make me a page')
    expect(items[1].textContent).toContain('Landing')
    expect(items[2].querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,r10'
    )
    expect(items[2].textContent).toContain('panel.picture(1)')
    const tabs = [
      ...host.querySelectorAll<HTMLElement>(
        `[data-testid="${TEST_IDS.chat.panel.tab}"]`
      )
    ]
    expect(
      tabs.map((tab) => `${tab.dataset.section}:${tab.textContent}`)
    ).toEqual([
      'files:panel.files3',
      'tools:panel.tools3',
      // Every source, not the one run they are grouped under.
      'sources:panel.sources2'
    ])
  })

  it('a file row scrolls to its run; an artifact row also opens its card', () => {
    const { host, store } = mount({ open: true, section: 'files' })
    act(() => rows(host)[0].click())
    expect(scrollToRun).toHaveBeenLastCalledWith('r1')
    expect(store.get(revealArtifactAtom)).toBeNull()
    act(() => rows(host)[1].click())
    expect(scrollToRun).toHaveBeenCalledTimes(2)
    expect(scrollToRun).toHaveBeenLastCalledWith('r1')
    expect(store.get(revealArtifactAtom)).toBe('r1-create_artifact-call')
  })

  it('lists the tools by their capital-case names, most used first with their counts, a row scrolling to the latest call', () => {
    const { host } = mount({ open: true, section: 'tools' })
    const items = rows(host)
    expect(items.map((r) => r.textContent)).toEqual([
      'Web Searchpanel.calls(2)',
      'Create Artifactpanel.calls(1)',
      'Write Filepanel.calls(1)'
    ])
    act(() => items[0].click())
    expect(scrollToRun).toHaveBeenCalledWith('r2')
  })

  it('groups the sources by run under the question, and brings the asked-for run into view', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const { host, store } = mount({
      open: true,
      section: 'sources',
      runId: 'r2'
    })
    const group = host.querySelector<HTMLElement>('[data-run-id="r2"]')
    expect(group?.textContent).toContain('Search it')
    const links = [...group!.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )
    expect(links).toEqual(['https://a.example/x', 'https://b.example/y'])
    expect(group?.textContent).toContain('about a')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    // Brought into view once: a later message does not scroll it back.
    expect(store.get(chatPanelAtom).runId).toBeUndefined()
    act(() => store.set(chatMessagesAtom, [...messages, user('r3', 'more')]))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('keeps an asked-for run that is not listed yet, for a later message to bring', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const { store } = mount({ open: true, section: 'sources', runId: 'r9' })
    expect(store.get(chatPanelAtom).runId).toBe('r9')
  })

  it('says what will show up when there is nothing yet', () => {
    const { host } = mount({ open: true, section: 'files' }, '/chat/c1', [
      user('r1', 'hi')
    ])
    expect(
      host.querySelector(`[data-testid="${TEST_IDS.chat.panel.empty}"]`)
        ?.textContent
    ).toBe('panel.empty')
    expect(rows(host)).toEqual([])
  })

  it('closes off a chat page', () => {
    const { store } = mount({ open: true, section: 'files' }, '/')
    expect(store.get(chatPanelAtom).open).toBe(false)
  })

  it('its close button closes it', () => {
    const { host, store } = mount({ open: true, section: 'files' })
    const root = host.querySelector<HTMLElement>(
      `[data-testid="${TEST_IDS.chat.panel.root}"]`
    )
    const close = [...root!.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'action.close'
    )
    act(() => close!.click())
    expect(store.get(chatPanelAtom).open).toBe(false)
  })
})
