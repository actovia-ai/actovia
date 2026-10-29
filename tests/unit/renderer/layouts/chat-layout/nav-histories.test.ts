// @vitest-environment happy-dom
// A chat's row in the sidebar: its menu copies the conversation's id, which
// is what the user pastes into another chat to have that conversation read
// (`lcm_describe` / `lcm_grep` with the id).
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '@/types/db'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = toast
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

vi.mock('@/hooks/use-chat-history', () => ({
  useChatHistory: () => ({ data: [], isLoading: false }),
  useUpdateChat: () => ({ mutate: vi.fn() })
}))

// The menu's own behaviour (opening, focus, placement) is Base UI's; here
// the menu is always open, so what is tested is what its items do.
const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    // Base UI's `render`: the element to draw in the part's place.
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
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: pass('div'),
  DropdownMenuContent: pass('div'),
  DropdownMenuItem: pass('button'),
  DropdownMenuSeparator: pass('hr'),
  DropdownMenuTrigger: pass('div')
}))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: pass('div'),
  SidebarGroupContent: pass('div'),
  SidebarGroupLabel: pass('div'),
  SidebarMenu: pass('ul'),
  SidebarMenuAction: pass('button'),
  SidebarMenuButton: pass('div'),
  SidebarMenuItem: pass('li'),
  useSidebar: () => ({ isMobile: false })
}))

const { NavItems } = await import('@/layouts/chat-layout/nav-histories')

const chat = {
  id: '5b30d978-ebe8-4da6-9e73-02c6fc42b771',
  title: 'Trip planning',
  createdAt: '2026-09-29T08:00:00.000',
  favorite: false
} as unknown as Chat

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let writeText: ReturnType<typeof vi.fn>

beforeEach(async () => {
  toast.success.mockReset()
  toast.error.mockReset()
  writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(NavItems, { chat, onToggleFavorite: vi.fn() })
      )
    )
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const copyItem = () =>
  host.querySelector<HTMLElement>(
    `[data-testid="${TEST_IDS.chatLayout.copyChatId}"]`
  )

describe('a chat row in the sidebar', () => {
  it('copies the conversation id from its menu and says so', async () => {
    expect(copyItem()?.textContent).toContain('chat:sidebar.history.copyId')

    await act(async () => copyItem()!.click())

    expect(writeText).toHaveBeenCalledWith(chat.id)
    expect(toast.success).toHaveBeenCalledWith({
      title: 'chat:sidebar.history.idCopied'
    })
  })

  it('says the copy failed, and not that it worked, when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'))

    await act(async () => copyItem()!.click())

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('marks the menu button, so a test can open the menu of a row', () => {
    expect(
      host.querySelector(
        `[data-testid="${TEST_IDS.chatLayout.historyItemMenu}"]`
      )
    ).not.toBeNull()
  })

  it('reads its age off the UTC instant the server sends', async () => {
    const tz = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      const fresh = { ...chat, createdAt: new Date().toISOString() } as Chat
      await act(async () =>
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(NavItems, { chat: fresh, onToggleFavorite: vi.fn() })
          )
        )
      )
      const ages = [...host.querySelectorAll('span')].map((s) => s.textContent)
      expect(ages).toContain('now')
    } finally {
      process.env.TZ = tz
    }
  })
})
