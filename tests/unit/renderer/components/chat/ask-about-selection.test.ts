// @vitest-environment happy-dom
// "Ask about this": text selected in a message becomes a quote over the
// composer, travels with the next message, and is drawn as a quote in the
// bubble of the message that carried it.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})
// The composer's neighbours, none of them the subject here.
vi.mock('border-beam', () => ({
  BorderBeam: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children)
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('react-router', () => ({ useParams: () => ({ id: 'chat-1' }) }))
vi.mock('@/hooks/use-upload', () => ({
  useUpload: () => ({ uploadFile: vi.fn() })
}))
vi.mock('@/components/chat/composer/composer-tools', () => ({
  ActiveToolPills: () => null,
  ComposerToolsButton: () => null
}))
vi.mock('@/components/chat/composer/file-preview', () => ({
  FilePreview: () => null
}))
vi.mock('@/components/chat/composer/audio-recorder', () => ({
  AudioRecorder: () => null
}))

const { chatInputAtom, chatInputFocusAtom, chatQuoteAtom } =
  await import('@/stores/input')
const { default: InputBox } =
  await import('@/components/chat/composer/composer')
const { UserBubble } = await import('@/components/chat/user-bubble')
const { SelectionAsk } = await import('@/components/chat/selection-ask')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  window.getSelection()?.removeAllRanges()
})

const show = (node: ReactNode) =>
  act(async () => root.render(createElement(Provider, { store }, node)))
const find = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('the composer', () => {
  const sendMessage = vi.fn()
  const composer = () =>
    createElement(InputBox, { chatId: 'chat-1', sendMessage })

  beforeEach(() => sendMessage.mockReset())

  it('shows the quote it was given, and lets go of it', async () => {
    store.set(chatQuoteAtom, { chatId: 'chat-1', text: 'a quoted line' })
    await show(composer())

    expect(find(TEST_IDS.composer.quote)?.textContent).toContain(
      'a quoted line'
    )

    await act(async () => find(TEST_IDS.composer.quoteRemove)?.click())

    expect(find(TEST_IDS.composer.quote)).toBeNull()
    expect(store.get(chatQuoteAtom)).toBeNull()
  })

  it('shows nothing of a quote made in another chat', async () => {
    store.set(chatQuoteAtom, { chatId: 'chat-2', text: 'elsewhere' })
    await show(composer())

    expect(find(TEST_IDS.composer.quote)).toBeNull()
  })

  it('sends the quote with what was typed, once', async () => {
    store.set(chatQuoteAtom, { chatId: 'chat-1', text: 'a quoted line' })
    store.set(chatInputAtom, 'why?')
    await show(composer())

    const field = find(TEST_IDS.composer.textarea)!
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
    )

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '> a quoted line\n\nwhy?' })
    )
    expect(store.get(chatQuoteAtom)).toBeNull()
    expect(store.get(chatInputAtom)).toBe('')
  })

  it('does not send a quote with nothing asked about it', async () => {
    store.set(chatQuoteAtom, { chatId: 'chat-1', text: 'a quoted line' })
    await show(composer())

    const field = find(TEST_IDS.composer.textarea)!
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
    )

    expect(sendMessage).not.toHaveBeenCalled()
    expect(store.get(chatQuoteAtom)).not.toBeNull()
  })
})

describe('the bubble of a message that carried a quote', () => {
  it('draws the quote as a quote, and the question under it', async () => {
    await show(createElement(UserBubble, { text: '> a quoted line\n\nwhy?' }))

    expect(host.querySelector('blockquote')?.textContent).toBe('a quoted line')
    expect(host.textContent).toBe('a quoted linewhy?')
  })

  it('is as it always was without one', async () => {
    await show(createElement(UserBubble, { text: 'just a question' }))

    expect(host.querySelector('blockquote')).toBeNull()
    expect(host.textContent).toBe('just a question')
  })
})

describe('selecting text in a message', () => {
  async function page() {
    await show(
      createElement(
        'div',
        null,
        createElement(
          'p',
          { 'data-askable': '', id: 'answer' },
          'An answer to select from.'
        ),
        createElement('p', { id: 'elsewhere' }, 'The sidebar, say.'),
        createElement(SelectionAsk, { chatId: 'chat-1' })
      )
    )
  }

  async function select(id: string, from: number, to: number) {
    const text = document.querySelector(`#${id}`)!.firstChild!
    const range = document.createRange()
    range.setStart(text, from)
    range.setEnd(text, to)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  it('offers to ask about it, and hands the selection to the composer', async () => {
    await page()
    await select('answer', 3, 9)

    const ask = find(TEST_IDS.chat.ask.button)
    expect(ask?.textContent).toContain('ask.button')

    const focusBefore = store.get(chatInputFocusAtom)
    await act(async () => ask?.click())

    expect(store.get(chatQuoteAtom)).toEqual({
      chatId: 'chat-1',
      text: 'answer'
    })
    expect(store.get(chatInputFocusAtom)).toBe(focusBefore + 1)
    expect(find(TEST_IDS.chat.ask.button)).toBeNull()
    expect(window.getSelection()?.toString()).toBe('')
  })

  it('offers nothing for a selection outside a message', async () => {
    await page()
    await select('elsewhere', 0, 5)

    expect(find(TEST_IDS.chat.ask.button)).toBeNull()
  })
})
