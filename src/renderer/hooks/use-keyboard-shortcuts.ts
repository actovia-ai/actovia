import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { ParseKeys } from 'i18next'
import { useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'

import { useRouteHistory } from '@/hooks/use-route-history'
import { useSettings } from '@/hooks/use-settings'
import { closeSearchbar } from '@/lib/ipc'
import { isSearchChatsVisibleAtom } from '@/stores/chat'

const isMac = navigator.platform.toUpperCase().includes('MAC')

/** Readable modifier label for the current platform */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl'

/**
 * The Return key's glyph. U+21A9 alone has emoji presentation on macOS (a
 * blue tile beside a monochrome ⌘); VS15 asks for the text glyph.
 */
export const RETURN_GLYPH = '\u21A9\uFE0E'

/**
 * How a key of `ShortcutDef.keys` is drawn: on a Mac every modifier is its
 * glyph (⌘ ⇧ ⌥ ↩), as the menu bar draws them; elsewhere their names.
 */
export function keyLabel(key: string): string {
  switch (key) {
    case 'Shift':
    case '⇧':
      return isMac ? '⇧' : 'Shift'
    case 'Alt':
    case '⌥':
      return isMac ? '⌥' : 'Alt'
    case 'Enter':
      return isMac ? RETURN_GLYPH : 'Enter'
    default:
      return key
  }
}

export type ShortcutDef = {
  id: string
  keys: string[]
  labelKey: ParseKeys<'settings'>
  category: 'General' | 'Chat' | 'Search'
  /**
   * Defaults to true. Explicitly false for shortcuts that either have no
   * safe fallback if disabled (Enter to send, Shift+Enter for a new line)
   * or whose keybinding lives outside this hook — Toggle sidebar is wired
   * directly into the shadcn Sidebar primitive
   * (`components/ui/sidebar.tsx`), and Find in page and Lock Now are native
   * Electron menu accelerators (`main/lib/menu.ts`) — so there's nothing
   * here to gate.
   */
  toggleable?: boolean
}

/**
 * Static shortcut map consumed by both the hook and the Settings page.
 * `keys` uses a normalized format: modifier symbols + key name. `id` is a
 * stable key for persisting per-shortcut enabled/disabled state — never
 * rename an existing id, it's stored in settings (`close-tab` is the tab
 * strip's id, kept for "Close chat").
 */
export const SHORTCUT_MAP: ShortcutDef[] = [
  {
    id: 'new-chat',
    keys: [MOD_KEY, 'N'],
    labelKey: 'keyboardShortcuts.shortcuts.new-chat.label',
    category: 'General'
  },
  {
    id: 'open-settings',
    keys: [MOD_KEY, ','],
    labelKey: 'keyboardShortcuts.shortcuts.open-settings.label',
    category: 'General'
  },
  {
    id: 'go-back',
    keys: [MOD_KEY, '['],
    labelKey: 'keyboardShortcuts.shortcuts.go-back.label',
    category: 'General'
  },
  {
    id: 'go-forward',
    keys: [MOD_KEY, ']'],
    labelKey: 'keyboardShortcuts.shortcuts.go-forward.label',
    category: 'General'
  },
  {
    id: 'toggle-sidebar',
    keys: [MOD_KEY, 'B'],
    labelKey: 'keyboardShortcuts.shortcuts.toggle-sidebar.label',
    category: 'General',
    toggleable: false
  },
  {
    id: 'lock-now',
    keys: [MOD_KEY, 'L'],
    labelKey: 'keyboardShortcuts.shortcuts.lock-now.label',
    category: 'General',
    toggleable: false
  },
  {
    id: 'toggle-developer-tools',
    keys: [MOD_KEY, 'Alt', 'I'],
    labelKey: 'keyboardShortcuts.shortcuts.toggle-developer-tools.label',
    category: 'General',
    toggleable: false
  },
  {
    id: 'force-refresh-page',
    keys: [MOD_KEY, 'Shift', 'R'],
    labelKey: 'keyboardShortcuts.shortcuts.force-refresh-page.label',
    category: 'General',
    toggleable: false
  },
  {
    id: 'find-in-page',
    keys: [MOD_KEY, 'F'],
    labelKey: 'keyboardShortcuts.shortcuts.find-in-page.label',
    category: 'Search',
    toggleable: false
  },
  {
    id: 'search-chat-history',
    keys: [MOD_KEY, '⇧', 'F'],
    labelKey: 'keyboardShortcuts.shortcuts.search-chat-history.label',
    category: 'Search'
  },
  {
    id: 'close-find-bar',
    keys: ['Esc'],
    labelKey: 'keyboardShortcuts.shortcuts.close-find-bar.label',
    category: 'Search'
  },
  {
    id: 'close-tab',
    keys: [MOD_KEY, 'W'],
    labelKey: 'keyboardShortcuts.shortcuts.close-tab.label',
    category: 'Chat'
  },
  {
    id: 'focus-chat-input',
    keys: [MOD_KEY, '⇧', 'E'],
    labelKey: 'keyboardShortcuts.shortcuts.focus-chat-input.label',
    category: 'Chat'
  },
  {
    id: 'send-message',
    keys: ['Enter'],
    labelKey: 'keyboardShortcuts.shortcuts.send-message.label',
    category: 'Chat',
    toggleable: false
  },
  {
    id: 'new-line',
    keys: ['⇧', 'Enter'],
    labelKey: 'keyboardShortcuts.shortcuts.new-line.label',
    category: 'Chat',
    toggleable: false
  }
]

/**
 * i18n key for each shortcut category heading, keyed by
 * `ShortcutDef['category']` the same way `NAV_TITLE_KEYS`
 * (`settings-menu.ts`) keys off `SettingsLabel` — `as const satisfies
 * Record<...>` keeps each value's exact literal key type so
 * `t(CATEGORY_TITLE_KEYS[category])` type-checks with no cast.
 */
export const CATEGORY_TITLE_KEYS = {
  General: 'keyboardShortcuts.category.general',
  Chat: 'keyboardShortcuts.category.chat',
  Search: 'keyboardShortcuts.category.search'
} as const satisfies Record<ShortcutDef['category'], ParseKeys<'settings'>>

/** A chat page's hash: `#/chat/<id>`. */
const CHAT_HASH = /^#\/chat\/.+/u

/**
 * Central keyboard shortcuts listener. Mount once at the ChatLayout level.
 * Backed by TanStack Hotkeys' singleton manager — no manual addEventListener
 * bookkeeping, and `ignoreInputs` replaces the hand-rolled input-focus check.
 * `stopPropagation: false` keeps the keydown reaching other window-level
 * listeners (the idle-lock activity tracker in `use-lock.ts` sees every key).
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const setSearchVisible = useSetAtom(isSearchChatsVisibleAtom)
  const { canGoBack, canGoForward, goBack, goForward } = useRouteHistory()
  const { data: settings } = useSettings()
  const disabled = useMemo(
    () => new Set(settings?.keyboardShortcuts?.disabled ?? []),
    [settings?.keyboardShortcuts?.disabled]
  )

  useHotkeys(
    [
      {
        // Closes the find bar, which lives in its own view (see window.ts): the
        // main window only relays the keypress when it has focus.
        hotkey: 'Escape',
        callback: () => {
          void closeSearchbar()
        },
        options: {
          enabled: !disabled.has('close-find-bar'),
          preventDefault: false,
          conflictBehavior: 'allow'
        }
      },
      {
        // Skips inputs to match the app's existing convention that Mod+N
        // shouldn't fire while the user is mid-typing (Mod+W, the arrows,
        // Shift+F and Shift+E are the deliberate exceptions below).
        hotkey: 'Mod+N',
        callback: () => navigate('/'),
        options: { enabled: !disabled.has('new-chat'), ignoreInputs: true }
      },
      {
        hotkey: 'Mod+,',
        callback: () => navigate('/settings'),
        options: { enabled: !disabled.has('open-settings'), ignoreInputs: true }
      },
      {
        // Closes the chat on screen — home, nothing deleted; off a chat page
        // it does nothing. Works while typing: closing the chat from the
        // composer is the point.
        hotkey: 'Mod+W',
        callback: () => {
          if (CHAT_HASH.test(window.location.hash)) navigate('/')
        },
        options: { enabled: !disabled.has('close-tab') }
      },
      {
        // The header's `←` `→` (macOS's convention), from the composer too.
        hotkey: 'Mod+[',
        callback: goBack,
        options: { enabled: !disabled.has('go-back') && canGoBack }
      },
      {
        hotkey: 'Mod+]',
        callback: goForward,
        options: { enabled: !disabled.has('go-forward') && canGoForward }
      },
      {
        hotkey: 'Mod+Shift+F',
        callback: () => setSearchVisible(true),
        options: { enabled: !disabled.has('search-chat-history') }
      },
      {
        hotkey: 'Mod+Shift+E',
        callback: () => {
          document
            .querySelector<HTMLTextAreaElement>(
              `[data-testid='${TEST_IDS.composer.textarea}']`
            )
            ?.focus()
        },
        options: { enabled: !disabled.has('focus-chat-input') }
      }
    ],
    { stopPropagation: false }
  )
}
