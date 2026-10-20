// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock('@/components/chat/message-action', () => ({
  MessageAction: () => null
}))
const t = (key: string, options?: { count?: number }) =>
  options?.count === undefined ? key : `${key}:${options.count}`
const i18n = { language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: undefined })
}))
vi.mock('@/hooks/use-discover-feed', () => ({
  useDiscoverFeed: () => ({ feed: undefined })
}))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/chat/chat-toc', () => ({ ChatToc: () => null }))
vi.mock('@/components/home/discover-feed', () => ({ DiscoverFeed: () => null }))
vi.mock('@/components/chat/message-spinner', () => ({
  MessageSpinner: () => null,
  shouldShowMessageSpinner: () => false
}))
vi.mock('react-medium-image-zoom', () => ({
  default: ({ children }: { children: unknown }) => children
}))
vi.mock('@/hooks/use-memory', () => ({
  useMemories: () => ({ data: undefined, isLoading: false }),
  useRunMemoryUsage: () => [],
  useUndoMemoryChanges: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateMemory: () => vi.fn()
}))
vi.mock('@/hooks/use-approvals', () => ({
  useRunApprovals: () => [],
  useDecideApproval: () => ({ mutate: vi.fn(), isPending: false })
}))

const { default: Messages, USER_IMAGES_SHOWN } =
  await import('@/components/chat/messages')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const asked = (count: number, text: string | null = 'which?') =>
  ({
    id: 'u1',
    runId: 'u1',
    role: 'user',
    timestamp: 1,
    content: [
      ...(text === null ? [] : [{ type: 'text', text }]),
      ...Array.from({ length: count }, (_, i) => ({
        type: 'image',
        mimeType: 'image/png',
        data: `data:image/png;base64,${i}`
      }))
    ]
  }) as unknown as ChatMessage

async function render(count: number, text: string | null = 'which?') {
  const host = document.createElement('div')
  await act(() =>
    createRoot(host).render(
      createElement(Messages, {
        chatId: 'chat-1',
        status: 'ready',
        messages: [asked(count, text)],
        regenerate: vi.fn()
      })
    )
  )
  return host
}

const pictures = (host: HTMLElement) =>
  host.querySelectorAll('img[alt="messageList.attachmentAlt"]')

describe("a question's pictures", () => {
  it('are squares, every one shown while they fit', async () => {
    const host = await render(USER_IMAGES_SHOWN)
    expect(pictures(host)).toHaveLength(USER_IMAGES_SHOWN)
    expect(pictures(host)[0].className).toContain('size-24')
    expect(
      host.querySelector('button[aria-label^="messageList.moreImages"]')
    ).toBeNull()
  })

  it('past the row, the last square reads +N and opens the rest in place', async () => {
    const host = await render(7)
    expect(pictures(host)).toHaveLength(USER_IMAGES_SHOWN - 1)
    const more = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="messageList.moreImages"]'
    )
    expect(more?.getAttribute('aria-label')).toBe('messageList.moreImages:4')
    expect(more?.textContent).toBe('+4')
    await act(() => more?.click())
    expect(pictures(host)).toHaveLength(7)
  })

  it('with no words, draw no empty bubble', async () => {
    for (const text of [null, '', '  \n ']) {
      const host = await render(2, text)
      expect(pictures(host)).toHaveLength(2)
      expect(host.querySelector('[data-askable]')).toBeNull()
    }
    const said = await render(2)
    expect(said.querySelector('[data-askable]')).not.toBeNull()
  })
})
