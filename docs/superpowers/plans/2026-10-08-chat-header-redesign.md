# Chat Header Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat header stops being a browser: the tab strip goes; in its place `←` `→` over the app's own page history, the chat's title with a model chip and a `▾` menu, a paired-phone dot, and one panel listing the chat's files, tools and sources.

**Architecture:** A pure route-history stack (`lib/route-history.ts`) in a jotai atom, recorded once in the layout and read by the header and the shortcuts. `<Chat>` publishes its messages to an atom when one is added or the stream settles; the header's panel toggle and the panel derive files / tools / sources from them through pure functions (`lib/chat-panel-items.ts`). Export is a pure Markdown writer (`lib/chat-export.ts`) over the same messages, saved through the existing `downloadFile` and the existing PDF route (which gains a print stylesheet).

**Tech Stack:** React 19, react-router 8 (hash router), jotai, TanStack Query + Hotkeys, Base UI primitives in `components/ui`, Hugeicons, Vitest + happy-dom, i18next (10 locales).

**Spec:** `docs/superpowers/specs/2026-10-08-chat-header-redesign-design.md` — read it first; it is the authority. The **Decisions** section below records where this plan departs from its letter and why.

## Global Constraints

- Repo `/Users/yanceyleo/Code/actovia/actovia`, branch `maintenance`, work in place (the owner declined worktrees). Commit by explicit paths only (`git add <paths>` / `git commit -o`); never `git stash`, `reset`, `restore`, `checkout`; never push. Trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The pre-commit hook runs lint-staged (fmt + lint), typecheck and `i18n:check`; run the task's own tests with `bun run test <file>` before each commit, and the whole suite (`bun run test`) once before the last task's commit. `bun run fmt` may touch only the files you own.
- Strings: every new user-facing string is a key in `packages/shared/src/i18n/locales/en/<ns>.json`, translated in the same commit into the other nine locales (de, es, fr, it, ja, ko, pt-BR, zh-Hant-HK, zh-Hant-TW). Plural keys: en, de, es, fr, it, pt-BR carry `_one` and `_other`; ja, ko, zh-Hant-HK, zh-Hant-TW carry `_other` only (as `sourcesPanel.title_other` did).
- Test ids: every interactive element added gets a `TEST_IDS` entry (`packages/shared/src/constants/test-ids.ts`), is applied in renderer source and referenced in a test under `tests/`; never a raw `data-testid="…"` string; never rename an existing id (`close-tab` stays `close-tab`).
- Exact values: header height 48 px (`h-12`); panel width `w-88`; history cap `MAX_ENTRIES = 50`; files cap `PANEL_FILES_CAP = 200`; phone online window `PHONE_ONLINE_WINDOW_MS = 300000`; shortcuts `Mod+[` back, `Mod+]` forward, `Mod+W` close chat; export file names `<title>.md` / `<title>.pdf` with `exportFileName`.
- Hugeicons used (all exist in `@hugeicons/core-free-icons`): `ArrowLeft01Icon`, `ArrowRight01Icon`, `SidebarRightIcon`, `MoreHorizontalIcon`, `ArrowDown01Icon`, `Tick02Icon`, `PencilEdit02Icon`, `StarIcon`, `FileExportIcon`, `Pdf01Icon`, `Delete02Icon`, `File01Icon`, `SparklesIcon`, `Wrench01Icon`.
- CLAUDE.md is updated in Task 8 (new files and the retired tab strip).

## Decisions (departures from the spec, with reasons)

1. **Arrows navigate by path, not `navigate(±1)`.** `goBack`/`goForward` move our index and `navigate(entries[index])`. The browser's history is invisible in Electron, and the app's `replace` navigations (home → `/chat/:id` after the first reply) and the deletion's `window.location.hash = '/'` would put the two out of step. The stack records every location change the recorder sees, including replaces.
2. **Settings is not recorded.** `/settings` and `/philharmonic` are routes outside `ChatLayout`, so the recorder is unmounted there; Settings keeps its own "Back to app". The stack resumes on return (the page it left from is already the current entry).
3. **The model chip lists the cached catalog** (`settings.modelCatalog[provider]`, what the Settings picker shows) — there is no `GET /api/v1/settings/models`; the route is a POST that needs the key. An empty catalog shows "No models fetched yet" with a link to Settings › AI Providers. Choosing writes `providerConfig.provider`, `.model` **and** `.modelSnapshot` (the composer reads the snapshot's reasoning levels), posting the whole settings object as the Settings form does (masked keys mean "unchanged").
4. **PDF export posts Markdown to the existing `POST /api/v1/tools/md-to-pdf`** (as Deep Research does); the route gains a print stylesheet (`src/main/lib/pdf/print-document.ts`) instead of a new `{ html, fileName }` shape. There is no save-file IPC; `downloadFile` (an `<a download>`) is what every export uses.
5. **Export writes every assistant text block** of a run, narration included; folded and hidden regenerate attempts are skipped. References resolve against the sources found up to and including that run.
6. **The phone dot does not add a poll.** The devices query refetches on window focus; the dot re-evaluates the five-minute window on a 60 s render tick (the existing hook test asserts no refetch for 60 s while nothing is pairing).
7. **Messages reach the header through `chatMessagesAtom`**, set by `<Chat>` when `messages.length` or `status` changes — not every streaming frame: files, tools and sources arrive whole, as messages.
8. **A truncated title shows its full text in the native `title` attribute**, not a Tooltip component.
9. **The artifact row opens the card** through `revealArtifactAtom` (a tool call id the `ArtifactCard` watches); no unit test renders the card (it mounts sandboxed iframes) — the panel test asserts the atom is set.

## Review Focus

1. A chat deleted while it is open: the stack loses its entries and `←` never leads back to a 404 — Task 1 (`without`) and Task 2 (the dialog calls it).
2. Going back and then opening another page drops the forward branch; `Mod+W` on home does nothing — Task 1 and Task 2 tests.
3. Malformed tool results (a write without `path`, a search whose `details` is not an array, an artifact without `title`, an error result) must not crash the panel — Task 4 tests.
4. An answer citing a source found in an earlier run resolves to that source, not to a later run's same rank — Task 3 test.
5. Choosing a model never writes another provider's id or a stale snapshot; a refused save leaves the chip on the saved model — Task 7 test.

---

### Task 1: Route history — the pure stack, its atom and hooks

**Files:**

- Create: `src/renderer/lib/route-history.ts`
- Create: `src/renderer/stores/history.ts`
- Create: `src/renderer/hooks/use-route-history.ts`
- Test: `tests/unit/renderer/lib/route-history.test.ts`
- Test: `tests/unit/renderer/hooks/use-route-history.test.ts`

**Interfaces:**

- Produces: `RouteHistory { entries: string[]; index: number; skipNext: boolean }`, `EMPTY_HISTORY`, `MAX_ENTRIES = 50`, `pushed(state, path)`, `back(state)`, `forward(state)`, `canGoBack(state)`, `canGoForward(state)`, `current(state)`, `without(state, path)`; `historyAtom`; `useRouteHistoryRecorder()` (mount once, in the layout); `useRouteHistory(): { canGoBack: boolean; canGoForward: boolean; goBack(): void; goForward(): void }`.

- [ ] **Step 1: Write the failing tests for the pure stack**

`tests/unit/renderer/lib/route-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  back,
  canGoBack,
  canGoForward,
  current,
  EMPTY_HISTORY,
  forward,
  MAX_ENTRIES,
  pushed,
  without
} from '@/lib/route-history'

const visit = (...paths: string[]) => paths.reduce(pushed, EMPTY_HISTORY)

describe('route history', () => {
  it('starts at the first page with both arrows off', () => {
    const h = visit('/')
    expect(h).toEqual({ entries: ['/'], index: 0, skipNext: false })
    expect(canGoBack(h)).toBe(false)
    expect(canGoForward(h)).toBe(false)
  })

  it('goes back and forward along what was visited, marking the move for the recorder', () => {
    let h = visit('/', '/chat/a', '/chat/b')
    expect(canGoBack(h)).toBe(true)
    h = back(h)
    expect(current(h)).toBe('/chat/a')
    expect(h.skipNext).toBe(true)
    h = back(h)
    expect(current(h)).toBe('/')
    expect(canGoBack(h)).toBe(false)
    expect(back(h)).toBe(h)
    h = forward(h)
    expect(current(h)).toBe('/chat/a')
    expect(canGoForward(h)).toBe(true)
    expect(forward(forward(h))).toEqual(forward(h))
  })

  it('a new page after going back drops the forward branch', () => {
    const h = pushed(back(visit('/', '/chat/a', '/chat/b')), '/chat/c')
    expect(h.entries).toEqual(['/', '/chat/a', '/chat/c'])
    expect(h.index).toBe(2)
    expect(h.skipNext).toBe(false)
    expect(canGoForward(h)).toBe(false)
  })

  it('the same page twice in a row is one entry', () => {
    expect(visit('/', '/').entries).toEqual(['/'])
    expect(visit('/', '/chat/a', '/chat/a').entries).toEqual(['/', '/chat/a'])
  })

  it('keeps the newest 50 entries', () => {
    const h = visit(...Array.from({ length: 60 }, (_, i) => `/chat/${i}`))
    expect(h.entries).toHaveLength(MAX_ENTRIES)
    expect(h.entries[0]).toBe('/chat/10')
    expect(current(h)).toBe('/chat/59')
    expect(h.index).toBe(MAX_ENTRIES - 1)
  })

  it('a deleted chat leaves the stack and the index stays on the page in view', () => {
    const h = without(back(visit('/', '/chat/a', '/', '/chat/a')), '/chat/a')
    expect(h.entries).toEqual(['/'])
    expect(h.index).toBe(0)
  })

  it('deleting the chat on screen stays at the same depth, or as deep as is left', () => {
    const h = without(visit('/', '/chat/a'), '/chat/a')
    expect(h.entries).toEqual(['/'])
    expect(h.index).toBe(0)
    expect(canGoBack(h)).toBe(false)
    expect(without(visit('/chat/a'), '/chat/a')).toEqual(EMPTY_HISTORY)
  })

  it('collapses the duplicates a deletion creates', () => {
    const h = without(visit('/', '/chat/a', '/', '/chat/b'), '/chat/a')
    expect(h.entries).toEqual(['/', '/chat/b'])
    expect(h.index).toBe(1)
  })

  it('without a match is the same state', () => {
    const h = visit('/', '/chat/a')
    expect(without(h, '/chat/zzz')).toBe(h)
    expect(without(EMPTY_HISTORY, '/chat/a')).toBe(EMPTY_HISTORY)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test tests/unit/renderer/lib/route-history.test.ts`
Expected: FAIL — cannot resolve `@/lib/route-history`.

- [ ] **Step 3: Write the pure stack**

`src/renderer/lib/route-history.ts`:

```ts
/**
 * The header's `←` `→` (spec 2026-10-08 §3): the app's own stack of the pages
 * it showed, not the browser's — deterministic (a reload starts it fresh at
 * the page on screen) and unit-testable. Entries are router paths (`/`,
 * `/chat/<id>`); `index` is where the user is. `skipNext` is set by an arrow
 * before it navigates, so the recorder (`hooks/use-route-history.ts`) moves
 * nothing for that location change instead of pushing it.
 */
export interface RouteHistory {
  entries: string[]
  index: number
  skipNext: boolean
}

/** Past this many entries the oldest drops. */
export const MAX_ENTRIES = 50

export const EMPTY_HISTORY: RouteHistory = {
  entries: [],
  index: -1,
  skipNext: false
}

/**
 * A navigation the arrows did not make: everything after `index` (the forward
 * branch) is dropped, `path` is appended unless it is the current entry, and
 * the index moves to the end.
 */
export function pushed(state: RouteHistory, path: string): RouteHistory {
  if (state.entries[state.index] === path) {
    return state.skipNext ? { ...state, skipNext: false } : state
  }
  const entries = [...state.entries.slice(0, state.index + 1), path]
  const kept = entries.slice(Math.max(0, entries.length - MAX_ENTRIES))
  return { entries: kept, index: kept.length - 1, skipNext: false }
}

export function canGoBack(state: RouteHistory): boolean {
  return state.index > 0
}

export function canGoForward(state: RouteHistory): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1
}

/** One step back, marked for the recorder; the same state when there is none. */
export function back(state: RouteHistory): RouteHistory {
  return canGoBack(state)
    ? { ...state, index: state.index - 1, skipNext: true }
    : state
}

export function forward(state: RouteHistory): RouteHistory {
  return canGoForward(state)
    ? { ...state, index: state.index + 1, skipNext: true }
    : state
}

/** The entry the user is on; undefined while nothing was recorded. */
export function current(state: RouteHistory): string | undefined {
  return state.entries[state.index]
}

/**
 * A deleted chat's entries are removed, the consecutive duplicates that
 * creates collapse, and the index follows the page in view — or, when that
 * page was the deleted chat, stays at the same depth (as deep as is left).
 */
export function without(state: RouteHistory, path: string): RouteHistory {
  if (!state.entries.includes(path)) return state
  const entries: string[] = []
  let index = -1
  state.entries.forEach((entry, i) => {
    if (entry === path) return
    if (entries.at(-1) !== entry) entries.push(entry)
    if (i === state.index) index = entries.length - 1
  })
  if (index === -1) index = Math.min(state.index, entries.length - 1)
  return { entries, index, skipNext: false }
}
```

- [ ] **Step 4: Run the pure tests**

Run: `bun run test tests/unit/renderer/lib/route-history.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the atom and the hooks**

`src/renderer/stores/history.ts`:

```ts
import { atom } from 'jotai'

import { EMPTY_HISTORY, type RouteHistory } from '@/lib/route-history'

/** The pages this window showed, for the header's `←` `→` (`hooks/use-route-history.ts`). */
export const historyAtom = atom<RouteHistory>(EMPTY_HISTORY)
```

`src/renderer/hooks/use-route-history.ts`:

```ts
import { useAtom, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import {
  back,
  canGoBack,
  canGoForward,
  current,
  forward,
  pushed,
  type RouteHistory
} from '@/lib/route-history'
import { historyAtom } from '@/stores/history'

/**
 * Records every page the router shows into the history stack. Mounted once,
 * in the chat layout. A location change an arrow made (`skipNext`) has moved
 * the index already and is not pushed again. Settings and Philharmonic are
 * routes outside the layout: they are not recorded (Settings has its own
 * "Back to app"), and the stack resumes on return.
 */
export function useRouteHistoryRecorder() {
  const { pathname, key } = useLocation()
  const setHistory = useSetAtom(historyAtom)
  useEffect(() => {
    setHistory((history) =>
      history.skipNext
        ? { ...history, skipNext: false }
        : pushed(history, pathname)
    )
  }, [key, pathname, setHistory])
}

/**
 * The arrows: whether each can go, and going. An arrow navigates to the
 * entry's own path (not `navigate(-1)`): the browser's history is invisible
 * in Electron and the app's replace navigations would put the two out of
 * step; the stack is the one record.
 */
export function useRouteHistory() {
  const navigate = useNavigate()
  const [history, setHistory] = useAtom(historyAtom)
  const go = useCallback(
    (step: (state: RouteHistory) => RouteHistory) => {
      const next = step(history)
      if (next === history) return
      const path = current(next)
      if (path === undefined) return
      setHistory(next)
      navigate(path)
    },
    [history, navigate, setHistory]
  )
  const goBack = useCallback(() => go(back), [go])
  const goForward = useCallback(() => go(forward), [go])
  return {
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    goBack,
    goForward
  }
}
```

- [ ] **Step 6: Write the failing hook test**

`tests/unit/renderer/hooks/use-route-history.test.ts`:

```ts
// @vitest-environment happy-dom
// The recorder pushes what the router shows; an arrow moves the index and
// navigates without pushing a second entry.
import { createStore, Provider } from 'jotai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { useRouteHistory, useRouteHistoryRecorder } =
  await import('@/hooks/use-route-history')
const { historyAtom } = await import('@/stores/history')

function Probe() {
  useRouteHistoryRecorder()
  const { canGoBack, canGoForward, goBack, goForward } = useRouteHistory()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return createElement(
    'div',
    null,
    createElement('span', { id: 'path' }, pathname),
    createElement('button', { id: 'open', onClick: () => navigate('/chat/a') }),
    createElement('button', { id: 'home', onClick: () => navigate('/') }),
    createElement('button', {
      id: 'back',
      disabled: !canGoBack,
      onClick: goBack
    }),
    createElement('button', {
      id: 'forward',
      disabled: !canGoForward,
      onClick: goForward
    })
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>

const click = (id: string) =>
  act(() => host.querySelector<HTMLButtonElement>(`#${id}`)!.click())
const path = () => host.querySelector('#path')!.textContent
const disabled = (id: string) =>
  host.querySelector<HTMLButtonElement>(`#${id}`)!.disabled

beforeEach(() => {
  store = createStore()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          MemoryRouter,
          { initialEntries: ['/'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '*', element: createElement(Probe) })
          )
        )
      )
    )
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useRouteHistory', () => {
  it('records the first page with both arrows off', () => {
    expect(store.get(historyAtom)).toEqual({
      entries: ['/'],
      index: 0,
      skipNext: false
    })
    expect(disabled('back')).toBe(true)
    expect(disabled('forward')).toBe(true)
  })

  it('an arrow moves the index and navigates, without pushing again', () => {
    click('open')
    expect(path()).toBe('/chat/a')
    expect(disabled('back')).toBe(false)

    click('back')
    expect(path()).toBe('/')
    expect(store.get(historyAtom)).toEqual({
      entries: ['/', '/chat/a'],
      index: 0,
      skipNext: false
    })
    expect(disabled('forward')).toBe(false)

    click('forward')
    expect(path()).toBe('/chat/a')
    expect(store.get(historyAtom).index).toBe(1)
    expect(disabled('forward')).toBe(true)
  })

  it('a page opened after going back replaces the forward branch', () => {
    click('open')
    click('back')
    click('home')
    // Home again from home: the same entry, nothing pushed, the forward page still there.
    expect(store.get(historyAtom)).toEqual({
      entries: ['/', '/chat/a'],
      index: 0,
      skipNext: false
    })
    click('open')
    expect(store.get(historyAtom)).toEqual({
      entries: ['/', '/chat/a'],
      index: 1,
      skipNext: false
    })
  })
})
```

- [ ] **Step 7: Run the hook test**

Run: `bun run test tests/unit/renderer/hooks/use-route-history.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/lib/route-history.ts src/renderer/stores/history.ts src/renderer/hooks/use-route-history.ts tests/unit/renderer/lib/route-history.test.ts tests/unit/renderer/hooks/use-route-history.test.ts
git commit -m "feat(chat): the app's own page history for the header's arrows — a pure stack (push, back, forward, without a deleted chat, capped at 50) in an atom, recorded once in the layout" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Retire the tab strip; `Mod+W` closes the chat; `Mod+[` `Mod+]` go back and forward

**Files:**

- Delete: `src/renderer/layouts/chat-layout/chat-tabs.tsx`
- Modify: `src/renderer/layouts/chat-layout/index.tsx`
- Modify: `src/renderer/stores/chat.ts` (lines 3, 9–10: drop `ChatTab` and `openTabsAtom`)
- Modify: `packages/shared/src/types/chat.ts:196` (drop `ChatTab`)
- Modify: `src/renderer/layouts/chat-layout/nav-histories.tsx` (lines 44–48, 98, 111–125)
- Modify: `src/renderer/layouts/chat-layout/rename-chat-dialog.tsx` (lines 1, 16, 21, 60–62)
- Modify: `src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx`
- Modify: `src/renderer/containers/chat-detail.tsx` (lines 1–27)
- Modify: `src/renderer/hooks/use-keyboard-shortcuts.ts`
- Modify: `packages/shared/src/i18n/locales/*/settings.json` (10 files: `keyboardShortcuts.shortcuts`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts:134-136`
- Test: `tests/unit/renderer/hooks/use-keyboard-shortcuts.test.ts`

**Interfaces:**

- Consumes: `useRouteHistory`, `useRouteHistoryRecorder`, `historyAtom`, `without` (Task 1).
- Produces: `SHORTCUT_MAP` ids `go-back` (`Mod+[`, General) and `go-forward` (`Mod+]`, General); `close-tab` relabelled "Close chat". The layout's header is, for now, the sidebar trigger alone (Task 8 fills it).

- [ ] **Step 1: Write the failing shortcut tests**

Append to `tests/unit/renderer/hooks/use-keyboard-shortcuts.test.ts`. Add these imports after the existing `const { useKeyboardShortcuts } = await import(...)` line:

```ts
import { getDefaultStore } from 'jotai'

const { historyAtom } = await import('@/stores/history')
const { EMPTY_HISTORY, pushed } = await import('@/lib/route-history')
const visit = (...paths: string[]) => paths.reduce(pushed, EMPTY_HISTORY)
```

In `beforeEach`, before `root = createRoot(...)`, add:

```ts
window.location.hash = '#/'
getDefaultStore().set(historyAtom, EMPTY_HISTORY)
```

Add these cases inside `describe('useKeyboardShortcuts', ...)`:

```ts
it('Mod+W closes the chat on screen: home, nothing deleted, even while typing', () => {
  window.location.hash = '#/chat/abc'
  const input = document.createElement('input')
  document.body.append(input)
  press(input, 'w', { ctrlKey: true })
  expect(navigate).toHaveBeenCalledWith('/')
})

it('Mod+W does nothing off a chat page', () => {
  window.location.hash = '#/'
  press(document.body, 'w', { ctrlKey: true })
  expect(navigate).not.toHaveBeenCalled()
})

it('Mod+[ goes back along the history and Mod+] forward', () => {
  const store = getDefaultStore()
  act(() => store.set(historyAtom, visit('/', '/chat/a')))
  act(() => root.render(createElement(Probe)))

  press(document.body, '[', { ctrlKey: true })
  expect(navigate).toHaveBeenCalledWith('/')
  expect(store.get(historyAtom).index).toBe(0)

  act(() => root.render(createElement(Probe)))
  press(document.body, ']', { ctrlKey: true })
  expect(navigate).toHaveBeenLastCalledWith('/chat/a')
  expect(store.get(historyAtom).index).toBe(1)
})

it('Mod+[ does nothing with no page to go back to', () => {
  act(() => getDefaultStore().set(historyAtom, visit('/')))
  act(() => root.render(createElement(Probe)))
  press(document.body, '[', { ctrlKey: true })
  expect(navigate).not.toHaveBeenCalled()
})

it('go-back turned off in settings does nothing', () => {
  disabled = ['go-back']
  act(() => getDefaultStore().set(historyAtom, visit('/', '/chat/a')))
  act(() => root.render(createElement(Probe)))
  press(document.body, '[', { ctrlKey: true })
  expect(navigate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to see them fail**

Run: `bun run test tests/unit/renderer/hooks/use-keyboard-shortcuts.test.ts`
Expected: the new cases FAIL (Mod+W navigates nowhere / `[` unbound); existing cases still pass.

- [ ] **Step 3: Rewrite the shortcuts hook**

Replace `src/renderer/hooks/use-keyboard-shortcuts.ts` from the imports through the end with:

```ts
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { ParseKeys } from 'i18next'
import { useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'

import { useRouteHistory } from '@/hooks/use-route-history'
import { useSettings } from '@/hooks/use-settings'
import { closeSearchbar } from '@/lib/ipc'
import { isFullTextSearchVisibleAtom } from '@/stores/chat'

const isMac = navigator.platform.toUpperCase().includes('MAC')

/** Readable modifier label for the current platform */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl'

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
  const setSearchVisible = useSetAtom(isFullTextSearchVisibleAtom)
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
```

- [ ] **Step 4: Remove the tab strip everywhere**

1. `git rm src/renderer/layouts/chat-layout/chat-tabs.tsx`.
2. `packages/shared/src/types/chat.ts`: delete the line `export type ChatTab = { id: string; title: string }` (and the blank line after it).
3. `src/renderer/stores/chat.ts`: the import becomes `import { Attachment } from '@actovia/shared/types/chat'`; delete `export type { ChatTab }` and `export const openTabsAtom = atom<ChatTab[]>([])`.
4. `src/renderer/layouts/chat-layout/nav-histories.tsx`: the store import becomes `import { renamedChatTitleAtom, toBeDeletedChatAtom } from '@/stores/chat'`; delete `const setOpenTabs = useSetAtom(openTabsAtom)`; the row's link becomes
   ```tsx
         <SidebarMenuButton
           isActive={chat.id === id}
           render={<Link to={`/chat/${chat.id}`} />}
         >
   ```
5. `src/renderer/layouts/chat-layout/rename-chat-dialog.tsx`: `import { useAtom } from 'jotai'`; `import { renamedChatTitleAtom } from '@/stores/chat'`; delete `const setOpenTabs = useSetAtom(openTabsAtom)` and the `setOpenTabs((prev) => …)` call in the submit handler (keep `updateChat({ id, title })` and `reset()`).
6. `src/renderer/containers/chat-detail.tsx` becomes:
   ```tsx
   import { useMemo } from 'react'
   import { useParams } from 'react-router'

   import { Chat } from '@/components/chat/chat'
   import { TranscriptSkeleton } from '@/components/chat/transcript-skeleton'
   import { useChatHistory, useChatPage } from '@/hooks/use-chat-history'
   import { convertToUIMessages } from '@/lib/utils'

   export function ChatDetail() {
     const { id } = useParams()
     // The newest page; older ones load as the user scrolls up (`useOlderPages`).
     const { data: page, isFresh } = useChatPage(id)
     const { data: history } = useChatHistory()

     const initialMessages = useMemo(
       () => convertToUIMessages(page?.messages ?? []),
       [page]
     )

     const chatRecord = history?.find((c) => c.id === id)

     if (!id) return null
     if (!isFresh || !page) return <TranscriptSkeleton />

     return (
       <Chat
         key={id}
         id={id}
         initialMessages={initialMessages}
         history={page}
         chatTitle={chatRecord?.title ?? 'New chat'}
       />
     )
   }
   ```
7. `src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx`: add `import { useAtom, useSetAtom } from 'jotai'` (replacing `import { useAtom } from 'jotai'`), `import { without } from '@/lib/route-history'`, `import { historyAtom } from '@/stores/history'`; inside the component add `const setHistory = useSetAtom(historyAtom)`; after the `try { await deleteChat(...) } catch { return }` block and before `setToBeDeletedChat(undefined)` add:
   ```tsx
   // The deleted chat's pages leave the header's history: `←` must
   // never lead back to it.
   setHistory((history) => without(history, `/chat/${toBeDeletedChat.id}`))
   ```
8. `src/renderer/layouts/chat-layout/index.tsx` becomes:
   ```tsx
   import { Outlet } from 'react-router'

   import { AppToaster } from '@/components/app/app-toaster'
   import { DeepResearchProcess } from '@/components/deep-research'
   import {
     SidebarInset,
     SidebarProvider,
     SidebarTrigger,
     useSidebar
   } from '@/components/ui/sidebar'
   import { SourcesPanel } from '@/components/web-search/sources-panel'
   import { useIsFullscreen } from '@/hooks/use-is-full-screen'
   import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
   import { useRouteHistoryRecorder } from '@/hooks/use-route-history'
   import { ResizableSidebarShell } from '@/layouts/shared/resizable-sidebar'
   import { cn } from '@/lib/utils'

   import { AppSidebar } from './app-sidebar'
   import { ChatDeletionConfirmationDialog } from './chat-deletion-confirmation-dialog'
   import { RenameChatDialog } from './rename-chat-dialog'
   import { SearchDialog } from './search-dialog'

   function ContentHeader() {
     const { open } = useSidebar()
     const isFullscreen = useIsFullscreen()
     return (
       <header
         className={cn(
           'draggable border-border bg-card/80 flex h-12 shrink-0 items-center gap-1 rounded-tl-xl border-b pr-3 backdrop-blur-sm transition-[padding] duration-200 ease-out',
           open ? 'pl-1' : isFullscreen ? 'pl-4' : 'pl-21'
         )}
       >
         {/* While the sidebar is open its toggle sits in the sidebar's own top
             row, by the traffic lights (as Notes and ChatGPT keep it); it comes
             here only once the sidebar is away, so it can be brought back. The
             header stays a drag region: every control in it is `no-drag`. */}
         {!open && (
           <SidebarTrigger className="no-drag text-muted-foreground hover:text-foreground" />
         )}
       </header>
     )
   }

   function InsertedSidebar() {
     return (
       <SidebarInset className="bg-card flex h-full min-w-0 flex-col overflow-hidden">
         <ContentHeader />
         <Outlet />
         <AppToaster />
         <SearchDialog />
         <RenameChatDialog />
         <ChatDeletionConfirmationDialog />
       </SidebarInset>
     )
   }

   function ChatWorkspace() {
     return (
       <ResizableSidebarShell id="chat" sidebar={<AppSidebar />}>
         <InsertedSidebar />
       </ResizableSidebarShell>
     )
   }

   export function Layout() {
     // The pages shown, for the header's arrows; and the central keyboard
     // shortcuts (Mod+N, Mod+W, Mod+[, Mod+], Mod+,, Mod+Shift+F, Escape, etc.).
     useRouteHistoryRecorder()
     useKeyboardShortcuts()

     return (
       <SidebarProvider className="h-screen overflow-hidden">
         <ChatWorkspace />
         <DeepResearchProcess />
         <SourcesPanel />
       </SidebarProvider>
     )
   }
   ```

- [ ] **Step 5: The shortcut labels, in 10 locales**

In every `packages/shared/src/i18n/locales/<locale>/settings.json`, inside `keyboardShortcuts.shortcuts`: change `close-tab.label` and insert `go-back` and `go-forward` objects right after `open-settings` (same shape as the neighbours: `"go-back": { "label": "…" }`).

| locale     | close-tab.label      | go-back.label | go-forward.label |
| ---------- | -------------------- | ------------- | ---------------- |
| en         | Close chat           | Back          | Forward          |
| de         | Chat schließen       | Zurück        | Vorwärts         |
| es         | Cerrar chat          | Atrás         | Adelante         |
| fr         | Fermer la discussion | Précédent     | Suivant          |
| it         | Chiudi chat          | Indietro      | Avanti           |
| ja         | チャットを閉じる     | 戻る          | 進む             |
| ko         | 채팅 닫기            | 뒤로          | 앞으로           |
| pt-BR      | Fechar chat          | Voltar        | Avançar          |
| zh-Hant-HK | 關閉聊天             | 上一頁        | 下一頁           |
| zh-Hant-TW | 關閉聊天             | 上一頁        | 下一頁           |

In `tests/unit/i18n/settings-namespace.test.ts`, the `close-tab` assertion becomes `'Close chat'`, and add right after it:

```ts
expect(settings.keyboardShortcuts.shortcuts['go-back'].label).toBe('Back')
expect(settings.keyboardShortcuts.shortcuts['go-forward'].label).toBe('Forward')
```

- [ ] **Step 6: Run the tests and the gates**

Run: `bun run test tests/unit/renderer/hooks/use-keyboard-shortcuts.test.ts tests/unit/i18n tests/unit/renderer/layouts tests/unit/renderer/containers tests/unit/shared`
Expected: PASS. Then `bun run typecheck` and `bun run i18n:check`: clean (no reference to `openTabsAtom`, `ChatTab`, `ChatTabs` remains: `grep -rn "openTabsAtom\|ChatTab\b\|ChatTabs" src packages/shared/src` prints nothing).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/layouts/chat-layout/index.tsx src/renderer/layouts/chat-layout/nav-histories.tsx src/renderer/layouts/chat-layout/rename-chat-dialog.tsx src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx src/renderer/containers/chat-detail.tsx src/renderer/stores/chat.ts packages/shared/src/types/chat.ts src/renderer/hooks/use-keyboard-shortcuts.ts packages/shared/src/i18n/locales/*/settings.json tests/unit/i18n/settings-namespace.test.ts tests/unit/renderer/hooks/use-keyboard-shortcuts.test.ts
git commit -m "feat(chat): the tab strip is gone — a sidebar click just opens the chat; Mod+W closes the chat on screen (home, nothing deleted), Mod+[ and Mod+] walk the app's own page history; a deleted chat leaves that history" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git rm` already staged the deletion of `chat-tabs.tsx`.)

---

### Task 3: Export — the Markdown writer, the file name, the print sheet

**Files:**

- Create: `src/renderer/lib/chat-export.ts`
- Create: `src/main/lib/pdf/print-document.ts`
- Modify: `src/main/lib/server/routes/tools.ts:14-16` (render through `printDocument`)
- Test: `tests/unit/renderer/lib/chat-export.test.ts`
- Test: `tests/unit/main/lib/print-document.test.ts`

**Interfaces:**

- Consumes: `withBlockText` (`@actovia/shared/utils/interactive-plain-text`), `withReferences(markdown, sources, heading)` (`@/lib/citation-references`), `userMessageText` (`@/lib/user-message-text`), `TOOL_NAMES`.
- Produces: `ExportLabels { you: string; assistant: string; references: string; pictures(count: number): string; tool(name: string): string }`, `chatToMarkdown(title: string, messages: ChatMessage[], labels: ExportLabels): string`, `exportFileName(title: string): string`; main: `printDocument(markdown: string): string` (a whole HTML document).

- [ ] **Step 1: Write the failing export tests**

`tests/unit/renderer/lib/chat-export.test.ts`:

```ts
// The chat as a document: each run as You / Actovia paragraphs, tool calls as
// quoted lines, citations as numbered references resolved against the
// sources found up to that run.
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import {
  chatToMarkdown,
  exportFileName,
  type ExportLabels
} from '@/lib/chat-export'

const labels: ExportLabels = {
  you: 'You',
  assistant: 'Actovia',
  references: 'References',
  pictures: (count) => `${count} picture${count === 1 ? '' : 's'} attached`,
  tool: (name) => `Tool: ${name}`
}

const user = (
  id: string,
  text: string,
  extra: Record<string, unknown> = {}
): ChatMessage =>
  ({
    id,
    runId: id,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
    ...extra
  }) as unknown as ChatMessage

const assistant = (runId: string, text: string): ChatMessage =>
  ({
    id: `${runId}-a`,
    runId,
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text }
    ],
    timestamp: 2
  }) as unknown as ChatMessage

const search = (runId: string, link: string, title: string): ChatMessage =>
  ({
    id: `${runId}-s`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-call`,
    toolName: 'web_search',
    content: [{ type: 'text', text: 'ok' }],
    details: [{ rank: 1, link, title, content: '', snippet: '' }],
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

const tool = (runId: string, toolName: string): ChatMessage =>
  ({
    id: `${runId}-${toolName}`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-${toolName}-call`,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

describe('chatToMarkdown', () => {
  it('writes the runs in order, with references resolved against the sources found so far', () => {
    const picture = {
      content: [
        { type: 'text', text: 'Who won?' },
        {
          type: 'image',
          data: 'data:image/png;base64,AAAA',
          mimeType: 'image/png'
        }
      ]
    }
    const messages = [
      user('r1', 'Who won?', picture),
      search('r1', 'https://a.example/x', 'A title'),
      assistant('r1', 'A won【1-source】.'),
      user('r2', 'And then?'),
      search('r2', 'https://b.example/y', 'B title'),
      tool('r2', 'terminal'),
      assistant('r2', 'B next【1-source】.')
    ]

    expect(chatToMarkdown('Trip', messages, labels)).toBe(
      [
        '# Trip',
        '**You:**\n\nWho won?\n\n_1 picture attached_',
        '> Tool: web_search',
        '**Actovia:**\n\nA won[1].\n\n---\n\n## References\n\n- [1] A title (a.example) https://a.example/x',
        '**You:**\n\nAnd then?',
        '> Tool: web_search',
        '> Tool: terminal',
        '**Actovia:**\n\nB next[1].\n\n---\n\n## References\n\n- [1] B title (b.example) https://b.example/y'
      ].join('\n\n') + '\n'
    )
  })

  it('skips the answers not in the conversation: folded and hidden attempts', () => {
    const messages = [
      user('r1', 'Q'),
      assistant('r1', 'First.'),
      user('r2', 'Q', { alternateOf: 'r1', attempt: 'folded' }),
      assistant('r2', 'Second.'),
      user('r3', 'Q', { alternateOf: 'r1', attempt: 'hidden' }),
      assistant('r3', 'Third.')
    ]
    const markdown = chatToMarkdown('T', messages, labels)
    expect(markdown).toContain('First.')
    expect(markdown).not.toContain('Second.')
    expect(markdown).not.toContain('Third.')
  })

  it('a question of pictures alone has no empty text line', () => {
    const messages = [
      user('r1', '', {
        content: [
          {
            type: 'image',
            data: 'data:image/png;base64,AAAA',
            mimeType: 'image/png'
          }
        ]
      })
    ]
    expect(chatToMarkdown('T', messages, labels)).toBe(
      '# T\n\n**You:**\n\n_1 picture attached_\n'
    )
  })

  it('an empty chat is its title alone', () => {
    expect(chatToMarkdown('T', [], labels)).toBe('# T\n')
  })
})

describe('exportFileName', () => {
  it('drops what a file name cannot hold and keeps the rest', () => {
    expect(exportFileName('A/B: c? "d" <e>|f\\g')).toBe('A B c d e f g')
  })
  it('falls back when nothing is left, and cuts at 80 characters', () => {
    expect(exportFileName('   ')).toBe('chat')
    expect(exportFileName('x'.repeat(100))).toHaveLength(80)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test tests/unit/renderer/lib/chat-export.test.ts`
Expected: FAIL — cannot resolve `@/lib/chat-export`.

- [ ] **Step 3: Write the export writer**

`src/renderer/lib/chat-export.ts`:

```ts
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatMessage,
  ChatToolResultMessage,
  ChatUserMessage
} from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { withBlockText } from '@actovia/shared/utils/interactive-plain-text'

import { withReferences } from '@/lib/citation-references'
import { userMessageText } from '@/lib/user-message-text'

/** The words the document is written with (the caller translates them). */
export interface ExportLabels {
  you: string
  assistant: string
  /** The heading over an answer's references (`withReferences`). */
  references: string
  pictures: (count: number) => string
  tool: (name: string) => string
}

interface Run {
  texts: string[]
  tools: string[]
}

/**
 * The chat as a Markdown document (spec 2026-10-08 §4): `# title`, then each
 * run as a **You:** paragraph (its pictures as a count), the tools it called
 * as quoted lines, and an **Actovia:** paragraph — the answer's text blocks
 * joined, through the same rules Copy uses: a block's words instead of its
 * JSON (`withBlockText`), citation markers as [n] with the sources listed
 * under it (`withReferences`, against the sources found up to that run).
 * Folded and hidden regenerate attempts are not in the conversation and are
 * left out.
 */
export function chatToMarkdown(
  title: string,
  messages: ChatMessage[],
  labels: ExportLabels
): string {
  const parts: string[] = [`# ${title}`]
  const sources: WebSearchResult[] = []
  const skipped = new Set<string>()
  let run: Run | null = null

  const flush = () => {
    if (!run) return
    for (const line of run.tools) parts.push(`> ${line}`)
    const body = run.texts.join('\n\n').trim()
    if (body) {
      const answer = withReferences(
        withBlockText(body),
        sources,
        labels.references
      )
      parts.push(`**${labels.assistant}:**\n\n${answer}`)
    }
    run = null
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flush()
      const question = message as ChatUserMessage
      if (question.attempt === 'hidden' || question.attempt === 'folded') {
        skipped.add(question.runId)
        continue
      }
      const text = userMessageText(question)
      const pictures = Array.isArray(question.content)
        ? question.content.filter((part) => part.type === 'image').length
        : 0
      const lines = [`**${labels.you}:**`]
      if (text) lines.push('', text)
      if (pictures > 0) lines.push('', `_${labels.pictures(pictures)}_`)
      parts.push(lines.join('\n'))
      run = { texts: [], tools: [] }
      continue
    }
    if (skipped.has(message.runId)) continue
    run ??= { texts: [], tools: [] }
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type === 'text' && part.text.trim()) run.texts.push(part.text)
      }
    } else if (message.role === 'toolResult') {
      const result = message as ChatToolResultMessage
      run.tools.push(labels.tool(result.toolName))
      if (
        result.toolName === TOOL_NAMES.webSearch &&
        !result.isError &&
        Array.isArray(result.details)
      ) {
        sources.push(...(result.details as WebSearchResult[]))
      }
    }
  }
  flush()
  return `${parts.join('\n\n')}\n`
}

/**
 * A file name from the chat's title: the characters no file system takes
 * become spaces, runs of space collapse, 80 characters at most; `chat` when
 * nothing is left.
 */
export function exportFileName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return name || 'chat'
}
```

- [ ] **Step 4: Run the export tests**

Run: `bun run test tests/unit/renderer/lib/chat-export.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing print-sheet test**

`tests/unit/main/lib/print-document.test.ts`:

````ts
import { printDocument } from '@main/lib/pdf/print-document'
import { describe, expect, it } from 'vitest'

describe('printDocument', () => {
  it('is a whole page: the Markdown as HTML under a print stylesheet', () => {
    const html = printDocument(
      '# Title\n\nSome `code` and\n\n```ts\nlet a = 1\n```\n'
    )
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<style>')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain(
      '<pre><code class="language-ts">let a = 1\n</code></pre>'
    )
  })

  it("keeps the model's HTML inert: it is text, not markup", () => {
    const html = printDocument('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
````

- [ ] **Step 6: Run to see it fail**

Run: `bun run test tests/unit/main/lib/print-document.test.ts`
Expected: FAIL — cannot resolve `@main/lib/pdf/print-document`.

- [ ] **Step 7: Write the print sheet and route the PDF through it**

`src/main/lib/pdf/print-document.ts`:

```ts
import MarkdownIt from 'markdown-it'

/**
 * What a PDF export prints (the chat export and the Deep Research export):
 * the Markdown as HTML in a plain, readable sheet — the system's font, grey
 * code panels, ruled tables, a quiet rule under quotes. `html: false` (the
 * default) keeps anything the model wrote as tags as text.
 */
const STYLE = [
  'body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#111;max-width:46em;margin:0 auto;padding:24px}',
  'h1,h2,h3,h4{line-height:1.3;margin:1.4em 0 0.5em}',
  'h1{font-size:1.7em}h2{font-size:1.3em}h3{font-size:1.1em}',
  'p,ul,ol,pre,blockquote,table{margin:0 0 0.9em}',
  'pre{background:#f4f4f4;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px;white-space:pre-wrap}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em}',
  ':not(pre)>code{background:#f4f4f4;padding:1px 4px;border-radius:4px}',
  'blockquote{margin-left:0;padding-left:12px;border-left:3px solid #ddd;color:#555}',
  'table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}',
  'img{max-width:100%}a{color:#1a56db}hr{border:0;border-top:1px solid #ddd;margin:1.4em 0}'
].join('')

export function printDocument(markdown: string): string {
  const body = new MarkdownIt().render(markdown)
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`
}
```

In `src/main/lib/server/routes/tools.ts`: replace `import MarkdownIt from 'markdown-it'` with `import { printDocument } from '../../pdf/print-document'` (keep the import groups sorted as the linter wants), and in `markdownStringToPdfBuffer` replace

```ts
const md = new MarkdownIt()
const html = md.render(markdownString)
```

with

```ts
const html = printDocument(markdownString)
```

- [ ] **Step 8: Run the tests and the gates**

Run: `bun run test tests/unit/main/lib/print-document.test.ts tests/unit/renderer/lib/chat-export.test.ts` — PASS. `bun run typecheck` — clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/lib/chat-export.ts src/main/lib/pdf/print-document.ts src/main/lib/server/routes/tools.ts tests/unit/renderer/lib/chat-export.test.ts tests/unit/main/lib/print-document.test.ts
git commit -m "feat(chat): a chat as a Markdown document — You / Actovia paragraphs, tool calls quoted, citations as references against the sources found so far — and a print sheet under every PDF export" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: What the panel lists — files, tools, sources — and whether the phone is here

**Files:**

- Create: `src/renderer/lib/generated-image.ts` (moved out of the image card)
- Modify: `src/renderer/components/calling-tools/image-generation/image-generation-card.tsx` (lines 1, 17, 46–66: `imageSrcOf` moves out)
- Create: `src/renderer/lib/chat-panel-items.ts`
- Create: `src/renderer/lib/phone-presence.ts`
- Test: `tests/unit/renderer/lib/chat-panel-items.test.ts`
- Test: `tests/unit/renderer/lib/phone-presence.test.ts`

**Interfaces:**

- Consumes: `TOOL_NAMES`, `userMessageText`, `isRasterDataUrl` (`@/components/markdown/remote-image`), `DevicesState` (`@/services/devices`).
- Produces: `imageSrcOf(image)` (unchanged behaviour, new home `@/lib/generated-image`); `ChatFile` (`user-image` | `artifact` | `workspace-file` | `generated-image`), `ChatToolUse { name; count; lastRunId }`, `ChatSourceGroup { runId; question; results }`, `ChatPanelItems { files; tools; sources; questions: Map<string, string> }`, `PANEL_FILES_CAP = 200`, `questionsByRun`, `chatFiles`, `chatTools`, `chatSources`, `chatPanelItems`, `hasPanelItems`; `PHONE_ONLINE_WINDOW_MS = 300000`, `isPhoneOnline(state, now?)`.

- [ ] **Step 1: Move `imageSrcOf` into a lib**

Create `src/renderer/lib/generated-image.ts`:

```ts
import { BASE_URL } from '@actovia/shared/constants/systems'
import type {
  GeneratedImage,
  LegacyGeneratedImage
} from '@actovia/shared/types/chat'

import { isRasterDataUrl } from '@/components/markdown/remote-image'

/**
 * Where a generated image loads from: a saved image from the local media
 * route; a row written before images were saved (a base64 `data:` URL, or a
 * DALL·E link — dead an hour after it was made, which the card's `onError`
 * turns into "unavailable") from its `url`. A `data:` URL only when it is a
 * raster image — the same rule as the chat's remote images: an SVG rendered
 * as `<img>` still fetches its own `<image href>` / `url()` references.
 * Anything else has nothing to show.
 */
export function imageSrcOf(
  image: Partial<GeneratedImage> & LegacyGeneratedImage
): string | undefined {
  if (image.mediaId) {
    return image.chatId
      ? `${BASE_URL}/api/v1/media/${encodeURIComponent(image.chatId)}/${encodeURIComponent(image.mediaId)}`
      : undefined
  }
  const url = image.url
  if (!url) return undefined
  if (/^data:/iu.test(url)) return isRasterDataUrl(url) ? url : undefined
  return /^https?:/iu.test(url) ? url : undefined
}
```

In `image-generation-card.tsx`: delete the `imageSrcOf` function and its doc comment; add `import { imageSrcOf } from '@/lib/generated-image'`; re-export it for its existing importers with `export { imageSrcOf }` right after the imports; remove the now-unused imports (`BASE_URL`, `isRasterDataUrl`, and `GeneratedImage` / `LegacyGeneratedImage` if nothing else in the file uses them — the linter tells you). Run `bun run typecheck` and `bun run test tests/unit/renderer/components` to confirm nothing moved.

- [ ] **Step 2: Write the failing panel-items tests**

`tests/unit/renderer/lib/chat-panel-items.test.ts`:

```ts
// @vitest-environment happy-dom
// What the header's panel lists, derived from the chat's messages: the
// user's pictures and what the tools made (newest first), every tool called
// with its count, and the sources found, grouped by the run's question.
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import {
  chatFiles,
  chatPanelItems,
  chatSources,
  chatTools,
  hasPanelItems,
  PANEL_FILES_CAP,
  questionsByRun
} from '@/lib/chat-panel-items'

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
  details: unknown,
  over: Record<string, unknown> = {}
): ChatMessage =>
  ({
    id: `${runId}-${toolName}-${Math.random()}`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-${toolName}`,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    details,
    isError: false,
    timestamp: 2,
    ...over
  }) as unknown as ChatMessage

const source = (rank: number, link: string) => ({
  rank,
  link,
  title: link,
  content: '',
  snippet: ''
})

const messages: ChatMessage[] = [
  user('r1', 'Make me a page', 2),
  result('r1', 'create_artifact', {
    type: 'artifact',
    title: 'Landing page',
    code: '<h1/>',
    artifactId: 'a1'
  }),
  result('r1', 'write_file', { path: '/ws/c/notes.md' }),
  user('r2', 'Search it'),
  result('r2', 'web_search', [
    source(1, 'https://a.example/'),
    source(2, 'https://b.example/')
  ]),
  result('r2', 'web_search', [source(3, 'https://c.example/')]),
  result('r2', 'write_file', { path: '/ws/c/notes.md' }),
  result('r2', 'edit_file', { path: '/ws/c/other.txt' }),
  user('r3', 'Draw it'),
  result('r3', 'image_generation', {
    images: [{ mediaId: 'm1.png', chatId: 'c', mimeType: 'image/png' }]
  }),
  result('r3', 'terminal', { stdout: '' }),
  result('r3', 'web_search', [source(1, 'https://d.example/')])
]

describe('chatFiles', () => {
  it('lists the pictures sent and what the tools made, newest first, one row per written path', () => {
    expect(chatFiles(messages)).toEqual([
      {
        kind: 'generated-image',
        runId: 'r3',
        src: expect.stringContaining('/api/v1/media/c/m1.png'),
        index: 1
      },
      {
        kind: 'workspace-file',
        runId: 'r2',
        path: '/ws/c/other.txt',
        name: 'other.txt'
      },
      {
        kind: 'workspace-file',
        runId: 'r2',
        path: '/ws/c/notes.md',
        name: 'notes.md'
      },
      {
        kind: 'artifact',
        runId: 'r1',
        toolCallId: 'r1-create_artifact',
        title: 'Landing page'
      },
      {
        kind: 'user-image',
        runId: 'r1',
        src: 'data:image/png;base64,r11',
        index: 2
      },
      {
        kind: 'user-image',
        runId: 'r1',
        src: 'data:image/png;base64,r10',
        index: 1
      }
    ])
  })

  it('ignores what is malformed or failed', () => {
    const odd: ChatMessage[] = [
      user('r1', 'q'),
      result('r1', 'write_file', { nope: true }),
      result('r1', 'write_file', 'a string'),
      result('r1', 'create_artifact', { type: 'artifact' }),
      result('r1', 'image_generation', { images: 'none' }),
      result('r1', 'image_generation', { images: [{ mediaId: 'x.png' }] }),
      result('r1', 'write_file', { path: '/ws/c/f.txt' }, { isError: true }),
      {
        id: 'u2',
        runId: 'u2',
        role: 'user',
        content: 'plain',
        timestamp: 1
      } as ChatMessage
    ]
    expect(chatFiles(odd)).toEqual([])
  })

  it('keeps the newest 200 rows', () => {
    const many = Array.from({ length: 210 }, (_, i) =>
      result(`r${i}`, 'write_file', { path: `/ws/c/${i}.txt` })
    )
    const files = chatFiles(many)
    expect(files).toHaveLength(PANEL_FILES_CAP)
    expect(files[0]).toMatchObject({ runId: 'r209' })
  })
})

describe('chatTools', () => {
  it('counts every tool called, most used first, with the run of its latest call', () => {
    expect(chatTools(messages)).toEqual([
      { name: 'web_search', count: 3, lastRunId: 'r3' },
      { name: 'write_file', count: 2, lastRunId: 'r2' },
      { name: 'create_artifact', count: 1, lastRunId: 'r1' },
      { name: 'edit_file', count: 1, lastRunId: 'r2' },
      { name: 'image_generation', count: 1, lastRunId: 'r3' },
      { name: 'terminal', count: 1, lastRunId: 'r3' }
    ])
  })
})

describe('chatSources', () => {
  it("groups the results by run under the run's question, newest run first", () => {
    const groups = chatSources(messages)
    expect(
      groups.map((g) => [g.runId, g.question, g.results.map((r) => r.link)])
    ).toEqual([
      ['r3', 'Draw it', ['https://d.example/']],
      [
        'r2',
        'Search it',
        ['https://a.example/', 'https://b.example/', 'https://c.example/']
      ]
    ])
  })

  it('leaves out a search that failed or answered with something else', () => {
    expect(
      chatSources([
        user('r1', 'q'),
        result('r1', 'web_search', { error: 'x' }),
        result('r1', 'web_search', [source(1, 'https://a.example/')], {
          isError: true
        })
      ])
    ).toEqual([])
  })
})

describe('questionsByRun and the whole', () => {
  it('names each run by its question, one line, 120 characters at most', () => {
    const long = user('r9', `a ${'b'.repeat(200)}\n\nc`)
    const questions = questionsByRun([...messages, long])
    expect(questions.get('r1')).toBe('Make me a page')
    expect(questions.get('r9')).toHaveLength(120)
    expect(questions.get('r9')).not.toContain('\n')
  })

  it('says whether there is anything to show', () => {
    expect(hasPanelItems(chatPanelItems(messages))).toBe(true)
    expect(hasPanelItems(chatPanelItems([user('r1', 'hi')]))).toBe(false)
    expect(hasPanelItems(chatPanelItems([]))).toBe(false)
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `bun run test tests/unit/renderer/lib/chat-panel-items.test.ts`
Expected: FAIL — cannot resolve `@/lib/chat-panel-items`.

- [ ] **Step 4: Write the panel items**

`src/renderer/lib/chat-panel-items.ts`:

```ts
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatMessage,
  ChatToolResultMessage,
  ImageContent,
  ImageGenerationDetails
} from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'

import { imageSrcOf } from '@/lib/generated-image'
import { userMessageText } from '@/lib/user-message-text'

/**
 * What the header's panel lists (spec 2026-10-08 §5), derived from the chat's
 * loaded messages by pure functions: nothing is stored.
 */
export type ChatFile =
  | { kind: 'user-image'; runId: string; src: string; index: number }
  | { kind: 'artifact'; runId: string; toolCallId: string; title: string }
  | { kind: 'workspace-file'; runId: string; path: string; name: string }
  | { kind: 'generated-image'; runId: string; src: string; index: number }

export interface ChatToolUse {
  name: string
  count: number
  /** The run of its latest call. */
  lastRunId: string
}

export interface ChatSourceGroup {
  runId: string
  /** The run's question, one line (`questionsByRun`); '' when it had no text. */
  question: string
  results: WebSearchResult[]
}

export interface ChatPanelItems {
  files: ChatFile[]
  tools: ChatToolUse[]
  sources: ChatSourceGroup[]
  /** Each run's question, for a row's caption. */
  questions: Map<string, string>
}

/** Past this many rows the older files drop, to keep the memo cheap on a huge chat. */
export const PANEL_FILES_CAP = 200
const QUESTION_LENGTH = 120

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const baseName = (path: string) => path.split(/[\\/]/u).pop() || path

/** Each run's question as one line, cut to 120 characters. */
export function questionsByRun(messages: ChatMessage[]): Map<string, string> {
  const questions = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    questions.set(
      message.runId,
      userMessageText(message)
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, QUESTION_LENGTH)
    )
  }
  return questions
}

/**
 * The user's pictures and what the tools made — artifacts, workspace files
 * (one row per path, the latest write), generated pictures — newest first.
 */
export function chatFiles(messages: ChatMessage[]): ChatFile[] {
  const files: ChatFile[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      if (!Array.isArray(message.content)) continue
      let index = 0
      for (const part of message.content) {
        if (part.type !== 'image') continue
        index += 1
        files.push({
          kind: 'user-image',
          runId: message.runId,
          src: (part as ImageContent).data,
          index
        })
      }
      continue
    }
    if (message.role !== 'toolResult') continue
    const result = message as ChatToolResultMessage
    if (result.isError) continue
    const details = result.details
    if (result.toolName === TOOL_NAMES.createArtifact) {
      if (isRecord(details) && typeof details.title === 'string') {
        files.push({
          kind: 'artifact',
          runId: result.runId,
          toolCallId: result.toolCallId,
          title: details.title
        })
      }
    } else if (
      result.toolName === TOOL_NAMES.writeFile ||
      result.toolName === TOOL_NAMES.editFile
    ) {
      if (
        isRecord(details) &&
        typeof details.path === 'string' &&
        details.path
      ) {
        files.push({
          kind: 'workspace-file',
          runId: result.runId,
          path: details.path,
          name: baseName(details.path)
        })
      }
    } else if (result.toolName === TOOL_NAMES.imageGeneration) {
      const images = isRecord(details)
        ? (details as unknown as ImageGenerationDetails).images
        : undefined
      if (!Array.isArray(images)) continue
      let index = 0
      for (const image of images) {
        const src = isRecord(image) ? imageSrcOf(image) : undefined
        if (!src) continue
        index += 1
        files.push({ kind: 'generated-image', runId: result.runId, src, index })
      }
    }
  }
  // One row per written path: the latest write.
  const latest = new Map<string, number>()
  files.forEach((file, i) => {
    if (file.kind === 'workspace-file') latest.set(file.path, i)
  })
  return files
    .filter(
      (file, i) => file.kind !== 'workspace-file' || latest.get(file.path) === i
    )
    .reverse()
    .slice(0, PANEL_FILES_CAP)
}

/** Every tool called, with its count and the run of its latest call; most used first, then by name. */
export function chatTools(messages: ChatMessage[]): ChatToolUse[] {
  const uses = new Map<string, ChatToolUse>()
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    const result = message as ChatToolResultMessage
    const use = uses.get(result.toolName)
    if (use) {
      use.count += 1
      use.lastRunId = result.runId
    } else {
      uses.set(result.toolName, {
        name: result.toolName,
        count: 1,
        lastRunId: result.runId
      })
    }
  }
  return [...uses.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )
}

/** The searches' results, grouped by run under the run's question, newest run first. */
export function chatSources(messages: ChatMessage[]): ChatSourceGroup[] {
  const questions = questionsByRun(messages)
  const groups = new Map<string, ChatSourceGroup>()
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    const result = message as ChatToolResultMessage
    if (result.toolName !== TOOL_NAMES.webSearch || result.isError) continue
    if (!Array.isArray(result.details) || result.details.length === 0) continue
    const results = result.details as WebSearchResult[]
    const group = groups.get(result.runId)
    if (group) {
      group.results.push(...results)
    } else {
      groups.set(result.runId, {
        runId: result.runId,
        question: questions.get(result.runId) ?? '',
        results: [...results]
      })
    }
  }
  return [...groups.values()].reverse()
}

export function chatPanelItems(messages: ChatMessage[]): ChatPanelItems {
  return {
    files: chatFiles(messages),
    tools: chatTools(messages),
    sources: chatSources(messages),
    questions: questionsByRun(messages)
  }
}

export function hasPanelItems(items: ChatPanelItems): boolean {
  return items.files.length + items.tools.length + items.sources.length > 0
}
```

- [ ] **Step 5: Run the panel-items tests**

Run: `bun run test tests/unit/renderer/lib/chat-panel-items.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing phone-presence test, then the module**

`tests/unit/renderer/lib/phone-presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isPhoneOnline, PHONE_ONLINE_WINDOW_MS } from '@/lib/phone-presence'

const NOW = Date.parse('2026-10-08T10:00:00.000Z')
const state = (lastSeenAt: string | null) => ({
  devices: [
    {
      id: 'd1',
      name: 'Phone',
      createdAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt
    }
  ],
  pairing: null,
  lanRunning: true
})

describe('isPhoneOnline', () => {
  it('is a phone seen within the last five minutes', () => {
    expect(
      isPhoneOnline(
        state(new Date(NOW - PHONE_ONLINE_WINDOW_MS).toISOString()),
        NOW
      )
    ).toBe(true)
    expect(
      isPhoneOnline(
        state(new Date(NOW - PHONE_ONLINE_WINDOW_MS - 1).toISOString()),
        NOW
      )
    ).toBe(false)
  })

  it('is nothing without a device, a visit, or a readable time', () => {
    expect(isPhoneOnline(undefined, NOW)).toBe(false)
    expect(
      isPhoneOnline({ devices: [], pairing: null, lanRunning: true }, NOW)
    ).toBe(false)
    expect(isPhoneOnline(state(null), NOW)).toBe(false)
    expect(isPhoneOnline(state('yesterday-ish'), NOW)).toBe(false)
  })
})
```

`src/renderer/lib/phone-presence.ts`:

```ts
import type { DevicesState } from '@/services/devices'

/** A phone counts as connected when it called the computer within this long (spec 2026-10-08 §6). */
export const PHONE_ONLINE_WINDOW_MS = 5 * 60_000

export function isPhoneOnline(
  state: DevicesState | undefined,
  now: number = Date.now()
): boolean {
  return !!state?.devices.some((device) => {
    if (!device.lastSeenAt) return false
    const seen = Date.parse(device.lastSeenAt)
    return Number.isFinite(seen) && now - seen <= PHONE_ONLINE_WINDOW_MS
  })
}
```

Run: `bun run test tests/unit/renderer/lib/phone-presence.test.ts` — PASS (2 tests).

- [ ] **Step 7: Gates and commit**

Run `bun run typecheck` and `bun run test tests/unit/renderer/components tests/unit/renderer/lib` — PASS.

```bash
git add src/renderer/lib/generated-image.ts src/renderer/components/calling-tools/image-generation/image-generation-card.tsx src/renderer/lib/chat-panel-items.ts src/renderer/lib/phone-presence.ts tests/unit/renderer/lib/chat-panel-items.test.ts tests/unit/renderer/lib/phone-presence.test.ts
git commit -m "feat(chat): what the header's panel lists, derived from the chat's messages — pictures and what the tools made, newest first and one row per path; every tool with its count; the sources grouped by run — and whether a phone called in the last five minutes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The transcript reaches the header — messages published, a run scrolled to, an artifact revealed

**Files:**

- Modify: `src/renderer/stores/chat.ts` (add `chatMessagesAtom`, `revealArtifactAtom`)
- Modify: `src/renderer/components/chat/chat.tsx` (lines 16–17 imports, 112–119 effects)
- Create: `src/renderer/lib/scroll-to-run.ts`
- Modify: `src/renderer/components/chat/chat-toc.tsx` (lines 15–16, 161–173)
- Modify: `src/renderer/components/chat/messages.tsx:883` (the scroll container gains `data-chat-scroll`)
- Modify: `src/renderer/components/calling-tools/artifact/artifact-card.tsx` (lines 229–243: a `toolCallId` prop and the reveal effect)
- Modify: `src/renderer/components/chat/messages-calling-tools.tsx:176-179`
- Test: `tests/unit/renderer/lib/scroll-to-run.test.ts`

**Interfaces:**

- Produces: `chatMessagesAtom: Atom<ChatMessage[]>` (the open chat's messages; `[]` off a chat), `revealArtifactAtom: Atom<string | null>` (a tool call id); `SCROLL_OFFSET = 88`, `scrollRunIntoView(container: HTMLElement, runId: string): boolean`, `scrollToRun(runId: string): boolean`; `ArtifactCard` takes `toolCallId: string`.

- [ ] **Step 1: Write the failing scroll test**

`tests/unit/renderer/lib/scroll-to-run.test.ts`:

```ts
// @vitest-environment happy-dom
// A run is found by its question's anchor and scrolled to sit under the
// transcript's top, from the rail or from the header's panel.
import { describe, expect, it, vi } from 'vitest'

import {
  SCROLL_OFFSET,
  scrollRunIntoView,
  scrollToRun
} from '@/lib/scroll-to-run'

if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  ;(globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
}

function transcript() {
  const container = document.createElement('div')
  container.setAttribute('data-chat-scroll', '')
  const run = document.createElement('div')
  run.setAttribute('data-user-msg-id', 'r2')
  container.append(run)
  document.body.append(container)
  container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
  run.getBoundingClientRect = () => ({ top: 400 }) as DOMRect
  const scrollBy = vi.fn()
  container.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']
  return { container, scrollBy }
}

describe('scrollRunIntoView', () => {
  it('scrolls the container so the question sits SCROLL_OFFSET under its top', () => {
    const { container, scrollBy } = transcript()
    expect(scrollRunIntoView(container, 'r2')).toBe(true)
    expect(scrollBy).toHaveBeenCalledWith({
      top: 400 - 100 - SCROLL_OFFSET,
      behavior: 'smooth'
    })
    container.remove()
  })

  it('is false for a run not on screen', () => {
    const { container, scrollBy } = transcript()
    expect(scrollRunIntoView(container, 'r9')).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
    container.remove()
  })
})

describe('scrollToRun', () => {
  it("finds the open chat's transcript by its attribute", () => {
    const { container, scrollBy } = transcript()
    expect(scrollToRun('r2')).toBe(true)
    expect(scrollBy).toHaveBeenCalledTimes(1)
    container.remove()
    expect(scrollToRun('r2')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test tests/unit/renderer/lib/scroll-to-run.test.ts`
Expected: FAIL — cannot resolve `@/lib/scroll-to-run`.

- [ ] **Step 3: Write the helper and route the rail through it**

`src/renderer/lib/scroll-to-run.ts`:

```ts
/** Where a jumped-to question lands, measured from the transcript's top. */
export const SCROLL_OFFSET = 88

/**
 * The transcript's scroll container carries `data-chat-scroll` (`messages.tsx`),
 * so the header's panel can find it from outside.
 */
const CONTAINER = '[data-chat-scroll]'

/**
 * Scrolls `container` so the run's question (`data-user-msg-id`, the run's
 * user message id) sits `SCROLL_OFFSET` under its top. False when the run is
 * not on screen — an older page not loaded yet.
 */
export function scrollRunIntoView(
  container: HTMLElement,
  runId: string
): boolean {
  const node = container.querySelector<HTMLElement>(
    `[data-user-msg-id="${CSS.escape(runId)}"]`
  )
  if (!node) return false
  const delta =
    node.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    SCROLL_OFFSET
  container.scrollBy({ top: delta, behavior: 'smooth' })
  return true
}

/** From outside the transcript (the header's panel): the open chat's. */
export function scrollToRun(runId: string): boolean {
  const container = document.querySelector<HTMLElement>(CONTAINER)
  return !!container && scrollRunIntoView(container, runId)
}
```

In `chat-toc.tsx`: delete `const SCROLL_OFFSET = 88` and its comment; add `import { SCROLL_OFFSET, scrollRunIntoView } from '@/lib/scroll-to-run'` (with the other `@/lib` imports); replace `scrollToEntry` with

```ts
const scrollToEntry = (id: string) => {
  const container = scrollContainerRef.current
  if (container && scrollRunIntoView(container, id)) setActiveId(id)
}
```

In `messages.tsx`, on the scroll container (`ref={chatBoxRef}` at line ~883) add the attribute `data-chat-scroll=""` on the line before `ref={chatBoxRef}`.

- [ ] **Step 4: Run the test and the rail's**

Run: `bun run test tests/unit/renderer/lib/scroll-to-run.test.ts tests/unit/renderer/components/chat-toc-outline.test.ts`
Expected: PASS.

- [ ] **Step 5: Publish the messages and the artifact reveal**

`src/renderer/stores/chat.ts`, after `reasoningEffortAtom`:

```ts
/**
 * The open chat's messages, for the header and its panel (`chat/header`,
 * `chat/panel`): `<Chat>` sets them when a message is added or the stream
 * settles — not on every streaming frame — and clears them on unmount.
 */
export const chatMessagesAtom = atom<ChatMessage[]>([])

/**
 * A tool call id: the artifact card with it opens full screen (the panel's
 * Files list clicked it), then clears it.
 */
export const revealArtifactAtom = atom<string | null>(null)
```

and add `ChatMessage` to the `@actovia/shared/types/chat` import (`import { Attachment, ChatMessage } from '@actovia/shared/types/chat'`).

`chat.tsx`: import `chatMessagesAtom` from `@/stores/chat` (join the existing import), add `const setChatMessages = useSetAtom(chatMessagesAtom)` beside `setChatStop`, and after the `setChatStop` effect:

```ts
// What the header and its panel show — pictures, tool results, sources —
// arrives whole, as a message: published when one is added or the stream
// settles, not on every frame of a reply.
useEffect(() => {
  setChatMessages(messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a message added, or the stream settled
}, [messages.length, status, setChatMessages])
useEffect(() => () => setChatMessages([]), [setChatMessages])
```

`artifact-card.tsx`: add `import { useAtom } from 'jotai'` and `import { revealArtifactAtom } from '@/stores/chat'`; the component signature becomes

```tsx
export function ArtifactCard({
  chatId,
  toolResult,
  toolCallId
}: {
  chatId: string
  toolResult: ArtifactDetails
  /** The call's id: the header's panel names it to open this card. */
  toolCallId?: string
}) {
```

and after `const [expanded, setExpanded] = useState(false)`:

```tsx
const [reveal, setReveal] = useAtom(revealArtifactAtom)
// The panel's Files row for this artifact: open full screen, once.
useEffect(() => {
  if (toolCallId && reveal === toolCallId) {
    setExpanded(true)
    setReveal(null)
  }
}, [reveal, toolCallId, setReveal])
```

`messages-calling-tools.tsx`: `<ArtifactCard chatId={chatId} toolResult={output} toolCallId={toolResult.toolCallId} />`.

- [ ] **Step 6: Gates and commit**

Run `bun run typecheck` and `bun run test tests/unit/renderer` — PASS.

```bash
git add src/renderer/stores/chat.ts src/renderer/components/chat/chat.tsx src/renderer/lib/scroll-to-run.ts src/renderer/components/chat/chat-toc.tsx src/renderer/components/chat/messages.tsx src/renderer/components/calling-tools/artifact/artifact-card.tsx src/renderer/components/chat/messages-calling-tools.tsx tests/unit/renderer/lib/scroll-to-run.test.ts
git commit -m "feat(chat): the transcript reaches the header — the open chat's messages in an atom (set when one is added or the stream settles), a run scrolled to from outside the transcript (the rail's rule, shared), an artifact card opened by its call id" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The panel — files, tools, sources — in the Sources panel's place

**Files:**

- Modify: `src/renderer/stores/chat.ts` (replace `sourcesPanelAtom` with `chatPanelAtom`)
- Create: `src/renderer/components/chat/panel/chat-panel.tsx`
- Delete: `src/renderer/components/web-search/sources-panel.tsx`
- Modify: `src/renderer/components/chat/message-action.tsx` (lines 14, 70–113, 148–153)
- Modify: `src/renderer/components/chat/assistant-turn-segment.tsx:265-271`
- Modify: `src/renderer/components/markdown/markdown-citations.tsx:21` (the comment names `sources-panel.tsx`; say `chat/panel/chat-panel.tsx`)
- Modify: `src/renderer/layouts/chat-layout/index.tsx` (`SourcesPanel` → `ChatPanel`)
- Modify: `packages/shared/src/constants/test-ids.ts` (`chat.panel`)
- Modify: `packages/shared/src/i18n/locales/*/chat.json` (10 files: drop `sourcesPanel`, add `panel`)
- Modify: `tests/unit/i18n/chat-namespace.test.ts:357-362`
- Test: `tests/unit/renderer/components/chat/chat-panel.test.ts`

**Interfaces:**

- Consumes: `chatMessagesAtom`, `revealArtifactAtom`, `scrollToRun` (Task 5); `chatPanelItems`, `hasPanelItems`, `ChatFile`, `ChatToolUse`, `ChatSourceGroup` (Task 4); `SheetPanel`, `SourceFavicon`, `Tabs`/`TabsList`/`TabsTrigger`.
- Produces: `ChatPanelSection = 'files' | 'tools' | 'sources'`, `ChatPanelState { open: boolean; section: ChatPanelSection; runId?: string }`, `chatPanelAtom` (initial `{ open: false, section: 'files' }`), `ChatPanel` (mounted in the layout), `MessageAction` prop `runId?: string`, `TEST_IDS.chat.panel.{root,tab,item,empty}`, i18n `chat:panel.*`.

- [ ] **Step 1: The atom, the test ids and the strings**

`src/renderer/stores/chat.ts`: delete `sourcesPanelAtom` (and the `WebSearchResult` import if nothing else uses it) and add:

```ts
export type ChatPanelSection = 'files' | 'tools' | 'sources'

export interface ChatPanelState {
  open: boolean
  section: ChatPanelSection
  /** A run whose Sources group the panel scrolls to (a message's Sources button). */
  runId?: string
}

/** The header's files / tools / sources panel (`chat/panel/chat-panel.tsx`). */
export const chatPanelAtom = atom<ChatPanelState>({
  open: false,
  section: 'files'
})
```

`packages/shared/src/constants/test-ids.ts`, inside `chat` right after `richBlocks: { … }` (add a comma after its closing brace):

```ts
    /** The header's files / tools / sources panel (chat/panel/): its root, a section tab, a row, the empty line. */
    panel: {
      root: 'chat.panel.root',
      tab: 'chat.panel.tab',
      item: 'chat.panel.item',
      empty: 'chat.panel.empty'
    }
```

In every `packages/shared/src/i18n/locales/<locale>/chat.json`: delete the whole `"sourcesPanel": { … }` object and put a `"panel": { … }` object in its place (same position, before `"sidebar"`). Keys and values:

| key              | en                                                         | de                                                          | es                                                                 | fr                                                                    | it                                                       |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| files            | Files                                                      | Dateien                                                     | Archivos                                                           | Fichiers                                                              | File                                                     |
| tools            | Tools                                                      | Tools                                                       | Herramientas                                                       | Outils                                                                | Strumenti                                                |
| sources          | Sources                                                    | Quellen                                                     | Fuentes                                                            | Sources                                                               | Fonti                                                    |
| empty            | Files, tools and sources from this chat will show up here. | Dateien, Tools und Quellen aus diesem Chat erscheinen hier. | Los archivos, herramientas y fuentes de este chat aparecerán aquí. | Les fichiers, outils et sources de cette discussion apparaîtront ici. | File, strumenti e fonti di questa chat compariranno qui. |
| yours            | Yours                                                      | Deine                                                       | Tuyos                                                              | Les vôtres                                                            | Tuoi                                                     |
| madeHere         | Made here                                                  | Hier erstellt                                               | Creados aquí                                                       | Créés ici                                                             | Creati qui                                               |
| picture          | Picture {{index}}                                          | Bild {{index}}                                              | Imagen {{index}}                                                   | Image {{index}}                                                       | Immagine {{index}}                                       |
| generatedPicture | Generated picture {{index}}                                | Generiertes Bild {{index}}                                  | Imagen generada {{index}}                                          | Image générée {{index}}                                               | Immagine generata {{index}}                              |
| calls_one        | {{count}} call                                             | {{count}} Aufruf                                            | {{count}} llamada                                                  | {{count}} appel                                                       | {{count}} chiamata                                       |
| calls_other      | {{count}} calls                                            | {{count}} Aufrufe                                           | {{count}} llamadas                                                 | {{count}} appels                                                      | {{count}} chiamate                                       |
| untitledQuestion | (no text)                                                  | (kein Text)                                                 | (sin texto)                                                        | (sans texte)                                                          | (senza testo)                                            |

| key              | ja                                                           | ko                                              | pt-BR                                                      | zh-Hant-HK                             | zh-Hant-TW                             |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| files            | ファイル                                                     | 파일                                            | Arquivos                                                   | 檔案                                   | 檔案                                   |
| tools            | ツール                                                       | 도구                                            | Ferramentas                                                | 工具                                   | 工具                                   |
| sources          | ソース                                                       | 출처                                            | Fontes                                                     | 來源                                   | 來源                                   |
| empty            | このチャットのファイル・ツール・ソースがここに表示されます。 | 이 채팅의 파일, 도구, 출처가 여기에 표시됩니다. | Arquivos, ferramentas e fontes deste chat aparecerão aqui. | 此聊天的檔案、工具與來源會顯示在這裡。 | 此聊天的檔案、工具與來源會顯示在這裡。 |
| yours            | あなたのもの                                                 | 내 파일                                         | Seus                                                       | 你的                                   | 你的                                   |
| madeHere         | ここで作成                                                   | 여기서 생성됨                                   | Criados aqui                                               | 在此產生                               | 在此產生                               |
| picture          | 画像 {{index}}                                               | 사진 {{index}}                                  | Imagem {{index}}                                           | 圖片 {{index}}                         | 圖片 {{index}}                         |
| generatedPicture | 生成画像 {{index}}                                           | 생성된 사진 {{index}}                           | Imagem gerada {{index}}                                    | 生成圖片 {{index}}                     | 生成圖片 {{index}}                     |
| calls_one        | —                                                            | —                                               | {{count}} chamada                                          | —                                      | —                                      |
| calls_other      | {{count}} 回                                                 | {{count}}회                                     | {{count}} chamadas                                         | {{count}} 次                           | {{count}} 次                           |
| untitledQuestion | （テキストなし）                                             | (텍스트 없음)                                   | (sem texto)                                                | （無文字）                             | （無文字）                             |

(— means the key is not written: ja, ko, zh-Hant-HK and zh-Hant-TW carry `calls_other` only.)

`tests/unit/i18n/chat-namespace.test.ts`: replace the `it('has the sourcesPanel keys', …)` case with

```ts
it('has the header panel keys', () => {
  expect(chat).not.toHaveProperty('sourcesPanel')
  expect(chat.panel.files).toBe('Files')
  expect(chat.panel.tools).toBe('Tools')
  expect(chat.panel.sources).toBe('Sources')
  expect(chat.panel.empty).toBe(
    'Files, tools and sources from this chat will show up here.'
  )
  expect(chat.panel.calls_one).toBe('{{count}} call')
  expect(chat.panel.calls_other).toBe('{{count}} calls')
})
```

- [ ] **Step 2: Write the failing panel test**

`tests/unit/renderer/components/chat/chat-panel.test.ts`:

```ts
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
      'sources:panel.sources1'
    ])
  })

  it('a file row scrolls to its run; an artifact row also opens its card', () => {
    const { host, store } = mount({ open: true, section: 'files' })
    act(() => rows(host)[0].click())
    expect(scrollToRun).toHaveBeenCalledWith('r2')
    act(() => rows(host)[1].click())
    expect(scrollToRun).toHaveBeenLastCalledWith('r1')
    expect(store.get(revealArtifactAtom)).toBe('r1-create_artifact-call')
  })

  it('lists the tools most used first with their counts, a row scrolling to the latest call', () => {
    const { host } = mount({ open: true, section: 'tools' })
    const items = rows(host)
    expect(items.map((r) => r.textContent)).toEqual([
      'web_searchpanel.calls(2)',
      'create_artifactpanel.calls(1)',
      'write_filepanel.calls(1)'
    ])
    act(() => items[0].click())
    expect(scrollToRun).toHaveBeenCalledWith('r2')
  })

  it('groups the sources by run under the question, and brings the asked-for run into view', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const { host } = mount({ open: true, section: 'sources', runId: 'r2' })
    const group = host.querySelector<HTMLElement>('[data-run-id="r2"]')
    expect(group?.textContent).toContain('Search it')
    const links = [...group!.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )
    expect(links).toEqual(['https://a.example/x', 'https://b.example/y'])
    expect(group?.textContent).toContain('about a')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
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
```

- [ ] **Step 3: Run to see it fail**

Run: `bun run test tests/unit/renderer/components/chat/chat-panel.test.ts`
Expected: FAIL — cannot resolve `@/components/chat/panel/chat-panel`.

- [ ] **Step 4: Write the panel**

`src/renderer/components/chat/panel/chat-panel.tsx`:

```tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import {
  File01Icon,
  SparklesIcon,
  Wrench01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import removeMd from 'remove-markdown'

import { SheetPanel } from '@/components/app/sheet-panel'
import { SourceFavicon } from '@/components/markdown/source-favicon'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type ChatFile,
  type ChatPanelItems,
  chatPanelItems,
  type ChatSourceGroup,
  type ChatToolUse,
  hasPanelItems
} from '@/lib/chat-panel-items'
import { scrollToRun } from '@/lib/scroll-to-run'
import { cn } from '@/lib/utils'
import {
  chatMessagesAtom,
  chatPanelAtom,
  type ChatPanelSection,
  revealArtifactAtom
} from '@/stores/chat'

const SECTIONS: ChatPanelSection[] = ['files', 'tools', 'sources']
const SECTION_LABELS = {
  files: 'panel.files',
  tools: 'panel.tools',
  sources: 'panel.sources'
} as const

/**
 * The header's panel (spec 2026-10-08 §5): what the chat produced and used —
 * files, tools, sources — derived from its messages, a `SheetPanel` beside
 * the content where the Sources panel was. Each row leads back to its run.
 */
export function ChatPanel() {
  const { t } = useTranslation('chat')
  const { id } = useParams<{ id: string }>()
  const [panel, setPanel] = useAtom(chatPanelAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const items = useMemo(() => chatPanelItems(messages), [messages])
  const bodyRef = useRef<HTMLDivElement>(null)

  // Off a chat page there is nothing to list: the panel closes.
  useEffect(() => {
    if (!id)
      setPanel((state) => (state.open ? { ...state, open: false } : state))
  }, [id, setPanel])

  // Opened on a run's Sources: that run's group comes into view.
  useEffect(() => {
    if (!panel.open || panel.section !== 'sources' || !panel.runId) return
    bodyRef.current
      ?.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(panel.runId)}"]`)
      ?.scrollIntoView({ block: 'start' })
  }, [panel.open, panel.section, panel.runId, items])

  const counts = {
    files: items.files.length,
    tools: items.tools.length,
    sources: items.sources.length
  }

  return (
    <SheetPanel
      open={panel.open}
      onClose={() => setPanel({ ...panel, open: false })}
      data-testid={TEST_IDS.chat.panel.root}
    >
      <div className="bg-background sticky top-0 z-10 flex h-12 shrink-0 items-center border-b pr-12 pl-3">
        <Tabs
          value={panel.section}
          onValueChange={(section) =>
            setPanel({
              ...panel,
              section: section as ChatPanelSection,
              runId: undefined
            })
          }
        >
          <TabsList>
            {SECTIONS.map((section) => (
              <TabsTrigger
                key={section}
                value={section}
                data-testid={TEST_IDS.chat.panel.tab}
                data-section={section}
              >
                {t(SECTION_LABELS[section])}
                <span className="text-muted-foreground ml-1 tabular-nums">
                  {counts[section]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {panel.open && (
        <div ref={bodyRef} className="bg-background flex-1 overflow-y-auto p-3">
          {!hasPanelItems(items) ? (
            <p
              className="text-muted-foreground px-3 py-6 text-center text-sm"
              data-testid={TEST_IDS.chat.panel.empty}
            >
              {t('panel.empty')}
            </p>
          ) : panel.section === 'files' ? (
            <FilesSection items={items} />
          ) : panel.section === 'tools' ? (
            <ToolsSection tools={items.tools} />
          ) : (
            <SourcesSection groups={items.sources} />
          )}
        </div>
      )}
    </SheetPanel>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-3 text-xs font-semibold">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

function Row({
  kind,
  onClick,
  icon,
  name,
  caption
}: {
  kind: string
  onClick: () => void
  icon: ReactNode
  name: ReactNode
  caption?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={TEST_IDS.chat.panel.item}
      data-kind={kind}
      className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        {caption && (
          <span className="text-muted-foreground truncate text-xs">
            {caption}
          </span>
        )}
      </span>
    </button>
  )
}

function FilesSection({ items }: { items: ChatPanelItems }) {
  const { t } = useTranslation('chat')
  const yours = items.files.filter((file) => file.kind === 'user-image')
  const made = items.files.filter((file) => file.kind !== 'user-image')
  const row = (file: ChatFile, i: number) => (
    <FileRow
      key={`${file.runId}-${file.kind}-${i}`}
      file={file}
      caption={items.questions.get(file.runId) ?? ''}
    />
  )
  return (
    <div className="flex flex-col gap-4">
      {made.length > 0 && (
        <Group title={t('panel.madeHere')}>{made.map(row)}</Group>
      )}
      {yours.length > 0 && (
        <Group title={t('panel.yours')}>{yours.map(row)}</Group>
      )}
    </div>
  )
}

function FileRow({ file, caption }: { file: ChatFile; caption: string }) {
  const { t } = useTranslation('chat')
  const reveal = useSetAtom(revealArtifactAtom)
  const name =
    file.kind === 'user-image'
      ? t('panel.picture', { index: file.index })
      : file.kind === 'generated-image'
        ? t('panel.generatedPicture', { index: file.index })
        : file.kind === 'artifact'
          ? file.title
          : file.name
  const icon =
    file.kind === 'user-image' || file.kind === 'generated-image' ? (
      <img
        src={file.src}
        alt=""
        className="size-9 shrink-0 rounded-md object-cover"
      />
    ) : (
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        <HugeiconsIcon
          icon={file.kind === 'artifact' ? SparklesIcon : File01Icon}
        />
      </span>
    )
  return (
    <Row
      kind={file.kind}
      icon={icon}
      name={name}
      caption={caption}
      onClick={() => {
        scrollToRun(file.runId)
        if (file.kind === 'artifact') reveal(file.toolCallId)
      }}
    />
  )
}

function ToolsSection({ tools }: { tools: ChatToolUse[] }) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-col gap-0.5">
      {tools.map((tool) => (
        <Row
          key={tool.name}
          kind="tool"
          icon={
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <HugeiconsIcon icon={Wrench01Icon} />
            </span>
          }
          name={<span className="font-mono">{tool.name}</span>}
          caption={t('panel.calls', { count: tool.count })}
          onClick={() => scrollToRun(tool.lastRunId)}
        />
      ))}
    </div>
  )
}

function SourcesSection({ groups }: { groups: ChatSourceGroup[] }) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.runId} data-run-id={group.runId}>
          <p
            className="mb-2 truncate px-3 text-xs font-semibold"
            title={group.question}
          >
            {group.question || t('panel.untitledQuestion')}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.results.map((item, i) => (
              <SourceLink key={`${item.link}-${i}`} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A source's row, as the Sources panel drew it: favicon and site, the title, the snippet as plain text. */
function SourceLink({ item }: { item: WebSearchResult }) {
  let hostname = item.hostname ?? ''
  if (!hostname) {
    try {
      hostname = new URL(item.link).hostname
    } catch {
      hostname = item.link
    }
  }
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('hover:bg-accent flex gap-3 rounded-lg px-3 py-2')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <SourceFavicon
            link={item.link}
            favicon={item.favicon}
            className="size-3.5"
          />
          <span className="truncate">{item.siteName || hostname}</span>
        </div>
        <div className="line-clamp-2 text-sm leading-snug font-semibold">
          {item.title}
        </div>
        {item.snippet && (
          <div className="text-muted-foreground line-clamp-2 text-xs leading-snug">
            {removeMd(item.snippet)}
          </div>
        )}
      </div>
    </a>
  )
}
```

- [ ] **Step 5: Wire it in, retire the Sources panel**

1. `git rm src/renderer/components/web-search/sources-panel.tsx`.
2. `src/renderer/layouts/chat-layout/index.tsx`: replace the `SourcesPanel` import with `import { ChatPanel } from '@/components/chat/panel/chat-panel'` (sorted among the `@/components` imports) and `<SourcesPanel />` with `<ChatPanel />`.
3. `src/renderer/components/chat/message-action.tsx`: import `chatPanelAtom` instead of `sourcesPanelAtom`; add the prop `runId?: string` (doc: `/** The run, for the panel: its Sources group comes into view. */`) after `timestamp`; replace `setSourcesPanel` and `onSourcesClick` with
   ```ts
   const setPanel = useSetAtom(chatPanelAtom)
   const onSourcesClick = useCallback(
     () => setPanel({ open: true, section: 'sources', runId }),
     [setPanel, runId]
   )
   ```
   (`webSearchResults` still drives `hasSources` and the button's favicons.)
4. `src/renderer/components/chat/assistant-turn-segment.tsx`: add `runId={turn.runId}` to `<MessageAction …>`.
5. `src/renderer/components/markdown/markdown-citations.tsx:21`: in the comment, `sources-panel.tsx` → `chat/panel/chat-panel.tsx`.
6. `grep -rn "sourcesPanelAtom\|SourcesPanel\|sources-panel\|sourcesPanel\." src tests packages/shared/src` prints nothing.

- [ ] **Step 6: Run the tests and the gates**

Run: `bun run test tests/unit/renderer/components/chat/chat-panel.test.ts tests/unit/renderer/components/message-action-copy.test.ts tests/unit/i18n tests/unit/shared` — PASS. `bun run typecheck`, `bun run i18n:check` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/chat.ts src/renderer/components/chat/panel/chat-panel.tsx src/renderer/components/chat/message-action.tsx src/renderer/components/chat/assistant-turn-segment.tsx src/renderer/components/markdown/markdown-citations.tsx src/renderer/layouts/chat-layout/index.tsx packages/shared/src/constants/test-ids.ts packages/shared/src/i18n/locales/*/chat.json tests/unit/i18n/chat-namespace.test.ts tests/unit/renderer/components/chat/chat-panel.test.ts
git commit -m "feat(chat): one panel for what the chat produced and used — files (pictures, artifacts, written files, generated pictures), tools with their counts, sources grouped by run — in the Sources panel's place; a message's Sources button opens it on that run" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The model chip and the chat menu

**Files:**

- Create: `src/renderer/lib/provider-labels.ts`
- Create: `src/renderer/components/chat/header/model-chip.tsx`
- Create: `src/renderer/components/chat/header/chat-menu.tsx`
- Modify: `packages/shared/src/constants/test-ids.ts` (`chat.header`)
- Modify: `packages/shared/src/i18n/locales/*/chat.json` (10 files: add `header` and `export`)
- Test: `tests/unit/renderer/lib/provider-labels.test.ts`
- Test: `tests/unit/renderer/components/chat/model-chip.test.ts`
- Test: `tests/unit/renderer/components/chat/chat-menu.test.ts`

**Interfaces:**

- Consumes: `useSettings()` → `{ data: Settings | undefined; updateSettings(payload: Settings): Promise<boolean> }`; `useUpdateChat().mutate(payload: Partial<Chat>)`; `renamedChatTitleAtom`, `toBeDeletedChatAtom`, `chatMessagesAtom`; `chatToMarkdown`, `exportFileName` (Task 3); `markdownToPdf(markdown): Promise<Blob>` (`@/services/tools`); `downloadFile(blob, name)` (`@/lib/utils`).
- Produces: `PROVIDER_SHORT_LABELS`, `configuredProvider(settings)`, `hasProviderKey(settings)`, `modelCatalog(settings, provider)`, `modelLabel(provider, model, catalog)`; `<ModelChip />`; `<ChatMenu chat={Chat | undefined} />`; `TEST_IDS.chat.header.{back,forward,title,modelChip,modelOption,menu,phone,panelToggle}`; i18n `chat:header.*`, `chat:export.*`.

- [ ] **Step 1: Test ids and strings**

`packages/shared/src/constants/test-ids.ts`, inside `chat`, right before `panel: {`:

```ts
    /** The chat header (chat/header/): the history arrows, the title group, the phone dot, the panel toggle. */
    header: {
      back: 'chat.header.back',
      forward: 'chat.header.forward',
      title: 'chat.header.title',
      modelChip: 'chat.header.model-chip',
      /** One per model in the chip's list (`data-model` holds the id). */
      modelOption: 'chat.header.model-option',
      menu: 'chat.header.menu',
      phone: 'chat.header.phone',
      panelToggle: 'chat.header.panel-toggle'
    },
```

(Task 8 applies `back`, `forward`, `title`, `phone` and `panelToggle` in source and tests; the linkage test fails until then, which is expected — run it only in Task 8.)

In every `packages/shared/src/i18n/locales/<locale>/chat.json`, insert `"header": { … }` and `"export": { … }` right before `"panel"`:

| key                   | en                          | de                                  | es                               | fr                                   | it                               |
| --------------------- | --------------------------- | ----------------------------------- | -------------------------------- | ------------------------------------ | -------------------------------- |
| header.back           | Back                        | Zurück                              | Atrás                            | Précédent                            | Indietro                         |
| header.forward        | Forward                     | Vorwärts                            | Adelante                         | Suivant                              | Avanti                           |
| header.streaming      | Replying…                   | Antwortet…                          | Respondiendo…                    | Réponse en cours…                    | Sta rispondendo…                 |
| header.noModel        | Choose a model              | Modell wählen                       | Elegir un modelo                 | Choisir un modèle                    | Scegli un modello                |
| header.modelMenu      | Model                       | Modell                              | Modelo                           | Modèle                               | Modello                          |
| header.noModels       | No models fetched yet       | Noch keine Modelle abgerufen        | Aún no se han obtenido modelos   | Aucun modèle récupéré pour l'instant | Nessun modello recuperato finora |
| header.openProviders  | Open AI Providers           | KI-Anbieter öffnen                  | Abrir proveedores de IA          | Ouvrir les fournisseurs d'IA         | Apri provider IA                 |
| header.menu           | Chat options                | Chat-Optionen                       | Opciones del chat                | Options de la discussion             | Opzioni della chat               |
| header.exportMarkdown | Export as Markdown…         | Als Markdown exportieren…           | Exportar como Markdown…          | Exporter en Markdown…                | Esporta come Markdown…           |
| header.exportPdf      | Export as PDF…              | Als PDF exportieren…                | Exportar como PDF…               | Exporter en PDF…                     | Esporta come PDF…                |
| header.exportFailed   | Couldn't export the chat    | Chat konnte nicht exportiert werden | No se pudo exportar el chat      | Impossible d'exporter la discussion  | Impossibile esportare la chat    |
| header.phonePaired    | Phone connected             | Telefon verbunden                   | Teléfono conectado               | Téléphone connecté                   | Telefono connesso                |
| header.phoneNotPaired | No phone connected          | Kein Telefon verbunden              | Ningún teléfono conectado        | Aucun téléphone connecté             | Nessun telefono connesso         |
| header.panel          | Files, tools and sources    | Dateien, Tools und Quellen          | Archivos, herramientas y fuentes | Fichiers, outils et sources          | File, strumenti e fonti          |
| export.you            | You                         | Du                                  | Tú                               | Vous                                 | Tu                               |
| export.assistant      | Actovia                     | Actovia                             | Actovia                          | Actovia                              | Actovia                          |
| export.pictures_one   | {{count}} picture attached  | {{count}} Bild angehängt            | {{count}} imagen adjunta         | {{count}} image jointe               | {{count}} immagine allegata      |
| export.pictures_other | {{count}} pictures attached | {{count}} Bilder angehängt          | {{count}} imágenes adjuntas      | {{count}} images jointes             | {{count}} immagini allegate      |
| export.tool           | Tool: {{name}}              | Tool: {{name}}                      | Herramienta: {{name}}            | Outil : {{name}}                     | Strumento: {{name}}              |

| key                   | ja                             | ko                          | pt-BR                            | zh-Hant-HK            | zh-Hant-TW            |
| --------------------- | ------------------------------ | --------------------------- | -------------------------------- | --------------------- | --------------------- |
| header.back           | 戻る                           | 뒤로                        | Voltar                           | 上一頁                | 上一頁                |
| header.forward        | 進む                           | 앞으로                      | Avançar                          | 下一頁                | 下一頁                |
| header.streaming      | 返信中…                        | 답변 중…                    | Respondendo…                     | 回覆中…               | 回覆中…               |
| header.noModel        | モデルを選択                   | 모델 선택                   | Escolher um modelo               | 選擇模型              | 選擇模型              |
| header.modelMenu      | モデル                         | 모델                        | Modelo                           | 模型                  | 模型                  |
| header.noModels       | まだモデルを取得していません   | 아직 가져온 모델이 없습니다 | Nenhum modelo obtido ainda       | 尚未取得模型          | 尚未取得模型          |
| header.openProviders  | AIプロバイダーを開く           | AI 제공업체 열기            | Abrir provedores de IA           | 開啟 AI 供應商        | 開啟 AI 供應商        |
| header.menu           | チャットのオプション           | 채팅 옵션                   | Opções do chat                   | 聊天選項              | 聊天選項              |
| header.exportMarkdown | Markdownとして書き出す…        | Markdown으로 내보내기…      | Exportar como Markdown…          | 匯出為 Markdown…      | 匯出為 Markdown…      |
| header.exportPdf      | PDFとして書き出す…             | PDF로 내보내기…             | Exportar como PDF…               | 匯出為 PDF…           | 匯出為 PDF…           |
| header.exportFailed   | チャットを書き出せませんでした | 채팅을 내보낼 수 없습니다   | Não foi possível exportar o chat | 無法匯出聊天          | 無法匯出聊天          |
| header.phonePaired    | スマートフォン接続中           | 휴대폰 연결됨               | Telefone conectado               | 手機已連線            | 手機已連線            |
| header.phoneNotPaired | スマートフォン未接続           | 연결된 휴대폰 없음          | Nenhum telefone conectado        | 未連線手機            | 未連線手機            |
| header.panel          | ファイル・ツール・ソース       | 파일, 도구 및 출처          | Arquivos, ferramentas e fontes   | 檔案、工具與來源      | 檔案、工具與來源      |
| export.you            | あなた                         | 나                          | Você                             | 你                    | 你                    |
| export.assistant      | Actovia                        | Actovia                     | Actovia                          | Actovia               | Actovia               |
| export.pictures_one   | —                              | —                           | {{count}} imagem anexada         | —                     | —                     |
| export.pictures_other | 添付画像 {{count}} 枚          | 사진 {{count}}장 첨부       | {{count}} imagens anexadas       | 附加 {{count}} 張圖片 | 附加 {{count}} 張圖片 |
| export.tool           | ツール: {{name}}               | 도구: {{name}}              | Ferramenta: {{name}}             | 工具：{{name}}        | 工具：{{name}}        |

In `tests/unit/i18n/chat-namespace.test.ts`, add after the `'has the header panel keys'` case:

```ts
it('has the header and export keys', () => {
  expect(chat.header.noModel).toBe('Choose a model')
  expect(chat.header.exportMarkdown).toBe('Export as Markdown…')
  expect(chat.header.phonePaired).toBe('Phone connected')
  expect(chat.export.pictures_one).toBe('{{count}} picture attached')
  expect(chat.export.tool).toBe('Tool: {{name}}')
})
```

- [ ] **Step 2: Write the failing provider-labels test**

`tests/unit/renderer/lib/provider-labels.test.ts`:

```ts
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { describe, expect, it } from 'vitest'

import {
  configuredProvider,
  hasProviderKey,
  modelCatalog,
  modelLabel
} from '@/lib/provider-labels'

const entry = (id: string, displayName: string) => ({
  id,
  displayName,
  snapshot: { reasoningLevels: [] }
})

const settings = (over: Partial<Settings>): Settings =>
  ({
    providerConfig: {
      provider: AiProviders.AnthropicClaude,
      model: 'claude-sonnet-5-5'
    },
    providers: { anthropicApiKey: '•••• abcd' },
    modelCatalog: {
      [AiProviders.AnthropicClaude]: [
        entry('claude-sonnet-5-5', 'Claude Sonnet 5.5')
      ]
    },
    ...over
  }) as unknown as Settings

describe('provider labels', () => {
  it('reads the configured provider, or null for none or an unknown name', () => {
    expect(configuredProvider(settings({}))).toBe(AiProviders.AnthropicClaude)
    expect(
      configuredProvider(settings({ providerConfig: { provider: 'Nope' } }))
    ).toBeNull()
    expect(configuredProvider(settings({ providerConfig: null }))).toBeNull()
    expect(configuredProvider(undefined)).toBeNull()
  })

  it('a provider has a key when its field holds one (a mask counts); Ollama needs none', () => {
    expect(hasProviderKey(settings({}))).toBe(true)
    expect(
      hasProviderKey(settings({ providers: { anthropicApiKey: '' } }))
    ).toBe(false)
    expect(hasProviderKey(settings({ providers: null }))).toBe(false)
    expect(
      hasProviderKey(
        settings({
          providerConfig: { provider: AiProviders.Ollama, model: 'llama3' },
          providers: null
        })
      )
    ).toBe(true)
    expect(hasProviderKey(undefined)).toBe(false)
  })

  it("labels the chip with the provider's short name and the model's display name, else its id", () => {
    const catalog = modelCatalog(settings({}), AiProviders.AnthropicClaude)
    expect(
      modelLabel(AiProviders.AnthropicClaude, 'claude-sonnet-5-5', catalog)
    ).toBe('Claude · Claude Sonnet 5.5')
    expect(modelLabel(AiProviders.OpenAiGpt, 'gpt-5', [])).toBe(
      'OpenAI · gpt-5'
    )
    expect(
      modelCatalog(
        settings({ modelCatalog: null }),
        AiProviders.AnthropicClaude
      )
    ).toEqual([])
  })
})
```

- [ ] **Step 3: Write provider-labels**

`src/renderer/lib/provider-labels.ts`:

```ts
import type {
  CachedModelEntry,
  Settings
} from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'

/** The provider's short name, as the Settings tabs spell it. */
export const PROVIDER_SHORT_LABELS: Record<AiProviders, string> = {
  [AiProviders.OpenAiGpt]: 'OpenAI',
  [AiProviders.AzureOpenAi]: 'Azure',
  [AiProviders.AnthropicClaude]: 'Claude',
  [AiProviders.GoogleGemini]: 'Gemini',
  [AiProviders.XaiGrok]: 'Grok',
  [AiProviders.Ollama]: 'Ollama'
}

type ProviderKeyField = keyof NonNullable<Settings['providers']>

/** The settings field holding each provider's key; none for Ollama. */
const PROVIDER_KEY_FIELDS: Partial<Record<AiProviders, ProviderKeyField>> = {
  [AiProviders.OpenAiGpt]: 'openaiApiKey',
  [AiProviders.AzureOpenAi]: 'azureOpenaiApiKey',
  [AiProviders.AnthropicClaude]: 'anthropicApiKey',
  [AiProviders.GoogleGemini]: 'googleGeminiApiKey',
  [AiProviders.XaiGrok]: 'xAiApiKey'
}

const PROVIDERS = new Set<string>(Object.values(AiProviders))

/** The provider configured, as the enum; null for none or an unknown name. */
export function configuredProvider(
  settings: Settings | undefined
): AiProviders | null {
  const value = settings?.providerConfig?.provider
  return value && PROVIDERS.has(value) ? (value as AiProviders) : null
}

/**
 * Whether the configured provider can answer: a key is saved (the renderer
 * sees it as a mask, a non-empty string), or it needs none (Ollama).
 */
export function hasProviderKey(settings: Settings | undefined): boolean {
  const provider = configuredProvider(settings)
  if (!provider) return false
  const field = PROVIDER_KEY_FIELDS[provider]
  if (!field) return true
  return !!settings?.providers?.[field]
}

/** The catalog the Settings picker lists for the provider; empty until a Refresh fetched it. */
export function modelCatalog(
  settings: Settings | undefined,
  provider: AiProviders
): CachedModelEntry[] {
  return settings?.modelCatalog?.[provider] ?? []
}

/** "Claude · Claude Sonnet 5.5": the provider's short name and the model's display name, else its id. */
export function modelLabel(
  provider: AiProviders,
  model: string,
  catalog: CachedModelEntry[]
): string {
  const entry = catalog.find((m) => m.id === model)
  return `${PROVIDER_SHORT_LABELS[provider]} · ${entry?.displayName ?? model}`
}
```

Run: `bun run test tests/unit/renderer/lib/provider-labels.test.ts` — PASS (3 tests).

- [ ] **Step 4: Write the failing chip test**

`tests/unit/renderer/components/chat/model-chip.test.ts`:

```ts
// @vitest-environment happy-dom
// The chip in the header: which model answers, and a pick that saves it.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const navigate = vi.fn()
vi.mock('react-router', () => ({ useNavigate: () => navigate }))

let settings: Settings | undefined
const updateSettings = vi.fn(async () => true)
vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: settings, updateSettings })
}))

// The popover's own behaviour is Base UI's; here it is always open.
const pass =
  (tag: string) =>
  ({ children, render, ...props }: Record<string, unknown>) =>
    render
      ? createElement(
          (render as { type: string | React.ComponentType }).type as string,
          {
            ...(render as { props: object }).props,
            ...Object.fromEntries(
              Object.entries(props).filter(
                ([k]) => k.startsWith('data-') || k === 'onClick'
              )
            )
          },
          children as ReactNode
        )
      : createElement(
          tag,
          Object.fromEntries(
            Object.entries(props).filter(
              ([key]) => key.startsWith('data-') || key === 'onClick'
            )
          ),
          children as ReactNode
        )
vi.mock('@/components/ui/popover', () => ({
  Popover: pass('div'),
  PopoverTrigger: pass('button'),
  PopoverContent: pass('div')
}))

const { ModelChip } = await import('@/components/chat/header/model-chip')

const snapshot = { reasoningLevels: ['low', 'high'] }
const configured = (): Settings =>
  ({
    providerConfig: {
      provider: AiProviders.AnthropicClaude,
      model: 'claude-sonnet-5-5',
      modelSnapshot: snapshot
    },
    providers: { anthropicApiKey: '•••• abcd' },
    modelCatalog: {
      [AiProviders.AnthropicClaude]: [
        { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', snapshot },
        {
          id: 'claude-opus-5-5',
          displayName: 'Claude Opus 5.5',
          snapshot: { reasoningLevels: ['max'] }
        }
      ]
    },
    keyboardShortcuts: { disabled: [] }
  }) as unknown as Settings

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  navigate.mockClear()
  updateSettings.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () => act(() => root.render(createElement(ModelChip)))
const chip = () =>
  host.querySelector<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.header.modelChip}"]`
  )
const options = () => [
  ...host.querySelectorAll<HTMLElement>(
    `[data-testid="${TEST_IDS.chat.header.modelOption}"]`
  )
]

describe('<ModelChip>', () => {
  it("reads the provider and the model's display name, and checks the current one in its list", () => {
    settings = configured()
    render()
    expect(chip()?.textContent).toBe('Claude · Claude Sonnet 5.5')
    expect(
      options().map(
        (o) => `${o.dataset.model}:${o.getAttribute('aria-checked')}`
      )
    ).toEqual(['claude-sonnet-5-5:true', 'claude-opus-5-5:false'])
  })

  it('a pick saves the model and its snapshot, the rest of the settings untouched', async () => {
    settings = configured()
    render()
    await act(async () => options()[1].click())
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({
      ...settings,
      providerConfig: {
        provider: AiProviders.AnthropicClaude,
        model: 'claude-opus-5-5',
        modelSnapshot: { reasoningLevels: ['max'] }
      }
    })
  })

  it('picking the current model saves nothing', async () => {
    settings = configured()
    render()
    await act(async () => options()[0].click())
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('a stale model id, no longer in the catalog, is shown as it is', () => {
    settings = configured()
    settings.providerConfig!.model = 'claude-old'
    render()
    expect(chip()?.textContent).toBe('Claude · claude-old')
  })

  it('without a key, or without a model, the chip asks for one and opens Settings › AI Providers', () => {
    settings = configured()
    settings.providers = { anthropicApiKey: '' } as Settings['providers']
    render()
    expect(chip()?.textContent).toBe('header.noModel')
    act(() => chip()!.click())
    expect(navigate).toHaveBeenCalledWith('/settings?tab=ai-providers')

    settings = undefined
    render()
    expect(chip()?.textContent).toBe('header.noModel')
  })

  it('an empty catalog says so and offers Settings', () => {
    settings = configured()
    settings.modelCatalog = null
    render()
    expect(chip()?.textContent).toBe('Claude · claude-sonnet-5-5')
    expect(options()).toEqual([])
    expect(host.textContent).toContain('header.noModels')
    const link = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'header.openProviders'
    )
    act(() => link!.click())
    expect(navigate).toHaveBeenCalledWith('/settings?tab=ai-providers')
  })
})
```

- [ ] **Step 5: Write the chip**

`src/renderer/components/chat/header/model-chip.tsx`:

```tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { CachedModelEntry } from '@actovia/shared/schemas/settings-schema'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { useSettings } from '@/hooks/use-settings'
import {
  configuredProvider,
  hasProviderKey,
  modelCatalog,
  modelLabel
} from '@/lib/provider-labels'
import { cn } from '@/lib/utils'

const PROVIDERS_TAB = '/settings?tab=ai-providers'
const CHIP =
  'no-drag h-6 max-w-56 gap-1 rounded-full px-2.5 text-xs font-normal'

/**
 * The model answering this chat (spec 2026-10-08 §4): the provider's short
 * name and the model's display name. Click lists the provider's cached
 * catalog (what the Settings picker shows); a pick saves `providerConfig`'s
 * model and snapshot — the server reads settings per run, so the next
 * message uses it. No provider, no model or no key: the chip says so and
 * opens Settings › AI Providers. Switching the provider stays in Settings.
 */
export function ModelChip() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { data: settings, updateSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const provider = configuredProvider(settings)
  const model = settings?.providerConfig?.model ?? null

  if (!settings || !provider || !model || !hasProviderKey(settings)) {
    return (
      <Button
        variant="outline"
        size="xs"
        className={CHIP}
        data-testid={TEST_IDS.chat.header.modelChip}
        onClick={() => navigate(PROVIDERS_TAB)}
      >
        {t('header.noModel')}
      </Button>
    )
  }

  const catalog = modelCatalog(settings, provider)
  const choose = async (entry: CachedModelEntry) => {
    setOpen(false)
    if (entry.id === model) return
    // The whole settings object goes back, as the Settings form posts it:
    // masked keys mean "unchanged" to the server.
    await updateSettings({
      ...settings,
      providerConfig: {
        ...settings.providerConfig,
        provider,
        model: entry.id,
        modelSnapshot: entry.snapshot
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={CHIP}
            data-testid={TEST_IDS.chat.header.modelChip}
          />
        }
      >
        <span className="truncate">{modelLabel(provider, model, catalog)}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0 opacity-60"
        />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-1">
        <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
          {t('header.modelMenu')}
        </p>
        {catalog.length === 0 ? (
          <div className="flex flex-col items-start gap-1 px-2 pb-2">
            <p className="text-muted-foreground text-xs">
              {t('header.noModels')}
            </p>
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() => {
                setOpen(false)
                navigate(PROVIDERS_TAB)
              }}
            >
              {t('header.openProviders')}
            </Button>
          </div>
        ) : (
          <div role="menu" className="flex max-h-80 flex-col overflow-y-auto">
            {catalog.map((entry) => {
              const checked = entry.id === model
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  data-testid={TEST_IDS.chat.header.modelOption}
                  data-model={entry.id}
                  onClick={() => void choose(entry)}
                  className={cn(
                    'hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    checked && 'font-medium'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {entry.displayName}
                  </span>
                  {checked && (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="size-4 shrink-0"
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

Run: `bun run test tests/unit/renderer/components/chat/model-chip.test.ts` — PASS (6 tests). If the `pass` mock's `render` branch does not carry the trigger's children, the chip's text is in the trigger: adjust the mock, not the component.

- [ ] **Step 6: Write the failing menu test**

`tests/unit/renderer/components/chat/chat-menu.test.ts`:

```ts
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

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>

beforeEach(() => {
  mutate.mockClear()
  downloadFile.mockClear()
  markdownToPdf.mockReset()
  toast.error.mockClear()
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

const render = (record: Chat | undefined = chat) =>
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(ChatMenu, { chat: record })
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

  it('export as Markdown saves the chat as <title>.md', async () => {
    render()
    act(() => item('chat:header.exportMarkdown')!.click())
    expect(downloadFile).toHaveBeenCalledTimes(1)
    const [blob, name] = downloadFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('Trip planning.md')
    expect(await blob.text()).toBe(
      '# Trip planning\n\n**chat:export.you:**\n\nHi\n\n**chat:export.assistant:**\n\nHello.\n'
    )
  })

  it('export as PDF posts that Markdown and saves <title>.pdf; a failure is toasted', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    markdownToPdf.mockResolvedValue(pdf)
    render()
    await act(async () => item('chat:header.exportPdf')!.click())
    expect(markdownToPdf).toHaveBeenCalledWith(
      expect.stringContaining('# Trip planning')
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
```

- [ ] **Step 7: Write the menu**

`src/renderer/components/chat/header/chat-menu.tsx`:

```tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  Delete02Icon,
  FileExportIcon,
  MoreHorizontalIcon,
  Pdf01Icon,
  PencilEdit02Icon,
  StarIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useUpdateChat } from '@/hooks/use-chat-history'
import { chatToMarkdown, exportFileName } from '@/lib/chat-export'
import { cn, downloadFile } from '@/lib/utils'
import { markdownToPdf } from '@/services/tools'
import {
  chatMessagesAtom,
  renamedChatTitleAtom,
  toBeDeletedChatAtom
} from '@/stores/chat'
import type { Chat } from '@/types/db'

/**
 * The `▾` beside the title (spec 2026-10-08 §4): rename, favourite, export
 * as Markdown or PDF, delete — the sidebar row's actions, for the chat on
 * screen. `chat` is undefined until the history list has the chat (its first
 * reply still streaming): the menu waits.
 */
export function ChatMenu({ chat }: { chat: Chat | undefined }) {
  const { t } = useTranslation(['common', 'chat'])
  const messages = useAtomValue(chatMessagesAtom)
  const setRenamedChatTitle = useSetAtom(renamedChatTitleAtom)
  const setToBeDeletedChat = useSetAtom(toBeDeletedChatAtom)
  const { mutate: updateChat } = useUpdateChat()

  if (!chat) return null

  const markdown = () =>
    chatToMarkdown(chat.title, messages, {
      you: t('chat:export.you'),
      assistant: t('chat:export.assistant'),
      references: t('chat:deepResearchCard.referencesHeading'),
      pictures: (count) => t('chat:export.pictures', { count }),
      tool: (name) => t('chat:export.tool', { name })
    })
  const exportMarkdown = () =>
    downloadFile(
      new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }),
      `${exportFileName(chat.title)}.md`
    )
  const exportPdf = async () => {
    try {
      downloadFile(
        await markdownToPdf(markdown()),
        `${exportFileName(chat.title)}.pdf`
      )
    } catch (error) {
      sileo.error({
        title: t('chat:header.exportFailed'),
        description: error instanceof Error ? error.message : undefined
      })
    }
  }
  const empty = messages.length === 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="no-drag text-muted-foreground hover:text-foreground"
            aria-label={t('chat:header.menu')}
            data-testid={TEST_IDS.chat.header.menu}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 rounded-lg" align="end">
        <DropdownMenuItem
          onClick={() =>
            setRenamedChatTitle({ id: chat.id, title: chat.title, open: true })
          }
        >
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            className="text-muted-foreground"
          />
          <span>{t('chat:sidebar.history.rename')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => updateChat({ id: chat.id, favorite: !chat.favorite })}
        >
          <HugeiconsIcon
            icon={StarIcon}
            className={cn(
              'text-muted-foreground',
              chat.favorite && 'fill-yellow-500 text-yellow-500'
            )}
          />
          <span>
            {chat.favorite
              ? t('chat:sidebar.history.unfavorite')
              : t('chat:sidebar.history.favoriteAction')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={empty} onClick={exportMarkdown}>
          <HugeiconsIcon
            icon={FileExportIcon}
            className="text-muted-foreground"
          />
          <span>{t('chat:header.exportMarkdown')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onClick={() => void exportPdf()}>
          <HugeiconsIcon icon={Pdf01Icon} className="text-muted-foreground" />
          <span>{t('chat:header.exportPdf')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => setToBeDeletedChat(chat)}
        >
          <HugeiconsIcon icon={Delete02Icon} />
          <span>{t('action.delete')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 8: Run the tests and the gates**

Run: `bun run test tests/unit/renderer/components/chat/chat-menu.test.ts tests/unit/renderer/components/chat/model-chip.test.ts tests/unit/renderer/lib/provider-labels.test.ts tests/unit/i18n` — PASS. `bun run typecheck`, `bun run i18n:check` — clean. (The test-id linkage test is expected to fail until Task 8 applies the header's remaining ids; do not run `tests/unit/shared` here.)

- [ ] **Step 9: Commit**

```bash
git add src/renderer/lib/provider-labels.ts src/renderer/components/chat/header/model-chip.tsx src/renderer/components/chat/header/chat-menu.tsx packages/shared/src/constants/test-ids.ts packages/shared/src/i18n/locales/*/chat.json tests/unit/i18n/chat-namespace.test.ts tests/unit/renderer/lib/provider-labels.test.ts tests/unit/renderer/components/chat/model-chip.test.ts tests/unit/renderer/components/chat/chat-menu.test.ts
git commit -m "feat(chat): the header's model chip — the provider and model answering, a pick from the cached catalog saved to settings, Settings offered when there is no key — and the chat's menu: rename, favourite, export as Markdown or PDF, delete" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The header — arrows, title, streaming dot, phone dot, panel toggle — in the layout

**Files:**

- Create: `src/renderer/components/chat/header/phone-dot.tsx`
- Create: `src/renderer/components/chat/header/chat-header.tsx`
- Modify: `src/renderer/layouts/chat-layout/index.tsx` (`ContentHeader` renders `<ChatHeader />`)
- Modify: `CLAUDE.md` (the chat layout paragraph)
- Test: `tests/unit/renderer/components/chat/chat-header.test.ts`

**Interfaces:**

- Consumes: `useRouteHistory` (Task 1), `useChatHistory` (`{ data: Chat[] | undefined }`), `useDevices` (`{ data: DevicesState | undefined }`), `isPhoneOnline` (Task 4), `chatPanelItems`/`hasPanelItems` (Task 4), `chatMessagesAtom`, `chatPanelAtom` (Tasks 5–6), `chatStatusAtom` (`@/stores/input`), `ModelChip`, `ChatMenu` (Task 7), `TEST_IDS.chat.header.*` (Task 7).
- Produces: `<ChatHeader />` (the whole header after the sidebar trigger), `<PhoneDot />`.

- [ ] **Step 1: Write the failing header test**

`tests/unit/renderer/components/chat/chat-header.test.ts`:

```ts
// @vitest-environment happy-dom
// The header's three groups: the arrows over the app's history; on a chat
// page the title with its streaming dot, the model chip and the menu; the
// phone dot and the panel toggle.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '@/types/db'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))

const chats: Chat[] = [
  {
    id: 'c1',
    title: 'Trip planning',
    createdAt: new Date('2026-09-29T08:00:00.000Z'),
    favorite: false
  } as Chat
]
vi.mock('@/hooks/use-chat-history', () => ({
  useChatHistory: () => ({ data: chats, isLoading: false })
}))

let lastSeenAt: string | null = null
vi.mock('@/hooks/use-devices', () => ({
  useDevices: () => ({
    data: {
      devices: [
        {
          id: 'd1',
          name: 'Phone',
          createdAt: '2026-10-01T00:00:00.000Z',
          lastSeenAt
        }
      ],
      pairing: null,
      lanRunning: true
    }
  })
}))

// The chip and the menu have tests of their own.
vi.mock('@/components/chat/header/model-chip', () => ({
  ModelChip: () => createElement('div', { 'data-stub': 'chip' })
}))
vi.mock('@/components/chat/header/chat-menu', () => ({
  ChatMenu: () => createElement('div', { 'data-stub': 'menu' })
}))

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

const { ChatHeader } = await import('@/components/chat/header/chat-header')
const { historyAtom } = await import('@/stores/history')
const { EMPTY_HISTORY, pushed } = await import('@/lib/route-history')
const { chatMessagesAtom, chatPanelAtom } = await import('@/stores/chat')
const { chatStatusAtom } = await import('@/stores/input')

const visit = (...paths: string[]) => paths.reduce(pushed, EMPTY_HISTORY)

const mounted: Array<() => void> = []
afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount())
  lastSeenAt = null
})

function mount(
  path: string,
  setup: (store: ReturnType<typeof createStore>) => void = () => {}
) {
  const store = createStore()
  store.set(historyAtom, visit(path))
  setup(store)
  const router = createMemoryRouter(
    [
      { path: '/', element: createElement(ChatHeader) },
      { path: '/chat/:id', element: createElement(ChatHeader) },
      { path: '*', element: null }
    ],
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
  const byId = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  return { host, store, router, byId }
}

describe('<ChatHeader>', () => {
  it('on a chat page shows the title group between the arrows and the right-hand controls', () => {
    const { host, byId } = mount('/chat/c1')
    expect(byId(TEST_IDS.chat.header.back)).not.toBeNull()
    expect(byId(TEST_IDS.chat.header.forward)).not.toBeNull()
    expect(byId(TEST_IDS.chat.header.title)?.textContent).toBe('Trip planning')
    expect(host.querySelector('[data-stub="chip"]')).not.toBeNull()
    expect(host.querySelector('[data-stub="menu"]')).not.toBeNull()
    expect(byId(TEST_IDS.chat.header.phone)).not.toBeNull()
    expect(byId(TEST_IDS.chat.header.panelToggle)).not.toBeNull()
  })

  it('off a chat page keeps the arrows and the phone dot only', () => {
    const { host, byId } = mount('/')
    expect(byId(TEST_IDS.chat.header.back)).not.toBeNull()
    expect(byId(TEST_IDS.chat.header.title)).toBeNull()
    expect(host.querySelector('[data-stub="chip"]')).toBeNull()
    expect(byId(TEST_IDS.chat.header.panelToggle)).toBeNull()
    expect(byId(TEST_IDS.chat.header.phone)).not.toBeNull()
  })

  it('a chat the list does not know yet is called New chat', () => {
    const { byId } = mount('/chat/unknown')
    expect(byId(TEST_IDS.chat.header.title)?.textContent).toBe(
      'sidebar.newChat'
    )
  })

  it('the arrows follow the history: back goes to the page before and enables forward', () => {
    const { byId, store, router } = mount('/chat/c1', (store) =>
      store.set(historyAtom, visit('/', '/chat/c1'))
    )
    const back = byId(TEST_IDS.chat.header.back) as HTMLButtonElement
    const forward = byId(TEST_IDS.chat.header.forward) as HTMLButtonElement
    expect(back.disabled).toBe(false)
    expect(forward.disabled).toBe(true)

    act(() => back.click())
    expect(router.state.location.pathname).toBe('/')
    expect(store.get(historyAtom).index).toBe(0)
    expect(
      (byId(TEST_IDS.chat.header.forward) as HTMLButtonElement).disabled
    ).toBe(false)
    expect(
      (byId(TEST_IDS.chat.header.back) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('a dot after the title while a reply is on its way', () => {
    const { host } = mount('/chat/c1', (store) =>
      store.set(chatStatusAtom, 'streaming')
    )
    expect(host.querySelector('[data-streaming]')).not.toBeNull()
    const idle = mount('/chat/c1', (store) => store.set(chatStatusAtom, 'idle'))
    expect(idle.host.querySelector('[data-streaming]')).toBeNull()
  })

  it('the panel toggle opens the panel, and carries a dot once there is something to show', () => {
    const { byId, store, host } = mount('/chat/c1')
    expect(host.querySelector('[data-has-items]')).toBeNull()
    act(() => byId(TEST_IDS.chat.header.panelToggle)!.click())
    expect(store.get(chatPanelAtom).open).toBe(true)

    const withTool = mount('/chat/c1', (store) =>
      store.set(chatMessagesAtom, [
        {
          id: 'r1-t',
          runId: 'r1',
          role: 'toolResult',
          toolCallId: 'k',
          toolName: 'terminal',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
          timestamp: 1
        } as unknown as ChatMessage
      ])
    )
    expect(withTool.host.querySelector('[data-has-items]')).not.toBeNull()
  })

  it('the phone dot is green for a phone seen in the last five minutes, and opens Settings › Devices', () => {
    lastSeenAt = new Date().toISOString()
    const online = mount('/')
    expect(online.byId(TEST_IDS.chat.header.phone)?.dataset.online).toBe('true')

    lastSeenAt = null
    const { byId, router } = mount('/')
    expect(byId(TEST_IDS.chat.header.phone)?.dataset.online).toBe('false')
    act(() => byId(TEST_IDS.chat.header.phone)!.click())
    expect(
      `${router.state.location.pathname}${router.state.location.search}`
    ).toBe('/settings?tab=devices')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `bun run test tests/unit/renderer/components/chat/chat-header.test.ts`
Expected: FAIL — cannot resolve `@/components/chat/header/chat-header`.

- [ ] **Step 3: Write the phone dot**

`src/renderer/components/chat/header/phone-dot.tsx`:

```tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useDevices } from '@/hooks/use-devices'
import { isPhoneOnline } from '@/lib/phone-presence'
import { cn } from '@/lib/utils'

/** How often the five-minute window is re-read without a fetch: a phone that went quiet greys out within a minute. */
const TICK_MS = 60_000

/**
 * The paired-phone dot (spec 2026-10-08 §6): green when a paired phone
 * called the computer in the last five minutes, grey otherwise. The devices
 * query refetches on window focus; between fetches the window is re-read on
 * a minute's tick. Click opens Settings › Devices.
 */
export function PhoneDot() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { data } = useDevices()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const online = isPhoneOnline(data, now)
  const label = online ? t('header.phonePaired') : t('header.phoneNotPaired')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="no-drag hover:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md"
            aria-label={label}
            data-testid={TEST_IDS.chat.header.phone}
            data-online={online ? 'true' : 'false'}
            onClick={() => navigate('/settings?tab=devices')}
          />
        }
      >
        <span
          className={cn(
            'size-2.5 rounded-full',
            online ? 'bg-emerald-500' : 'bg-muted-foreground/40'
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Write the header**

`src/renderer/components/chat/header/chat-header.tsx`:

```tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  SidebarRightIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useAtom, useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useChatHistory } from '@/hooks/use-chat-history'
import { useRouteHistory } from '@/hooks/use-route-history'
import { chatPanelItems, hasPanelItems } from '@/lib/chat-panel-items'
import { cn } from '@/lib/utils'
import { chatMessagesAtom, chatPanelAtom } from '@/stores/chat'
import { chatStatusAtom } from '@/stores/input'

import { ChatMenu } from './chat-menu'
import { ModelChip } from './model-chip'
import { PhoneDot } from './phone-dot'

/**
 * The chat header (spec 2026-10-08 §2), after the sidebar trigger: `←` `→`
 * over the app's own page history on the left; on a chat page the title, a
 * dot while a reply is on its way, the model chip and the `▾` menu in the
 * middle; the phone dot and the panel toggle on the right. The header is the
 * window's drag region, so every control here is `no-drag`.
 */
export function ChatHeader() {
  const { t } = useTranslation('chat')
  const { id } = useParams<{ id: string }>()
  const { canGoBack, canGoForward, goBack, goForward } = useRouteHistory()

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch">
        <HeaderButton
          label={t('header.back')}
          icon={ArrowLeft01Icon}
          disabled={!canGoBack}
          onClick={goBack}
          testId={TEST_IDS.chat.header.back}
        />
        <HeaderButton
          label={t('header.forward')}
          icon={ArrowRight01Icon}
          disabled={!canGoForward}
          onClick={goForward}
          testId={TEST_IDS.chat.header.forward}
        />
        <div className="flex min-w-0 flex-1 items-center justify-center px-2">
          {id && <TitleGroup id={id} />}
        </div>
        <PhoneDot />
        {id && <PanelToggle />}
      </div>
    </TooltipProvider>
  )
}

function HeaderButton({
  label,
  icon,
  disabled,
  pressed,
  onClick,
  testId
}: {
  label: string
  icon: IconSvgElement
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'no-drag text-muted-foreground hover:text-foreground',
              pressed && 'bg-accent text-foreground'
            )}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            data-testid={testId}
          />
        }
      >
        <HugeiconsIcon icon={icon} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The title (the list's, live: the title stream invalidates the list), a dot while replying, the chip, the menu. */
function TitleGroup({ id }: { id: string }) {
  const { t } = useTranslation('chat')
  const { data: history } = useChatHistory()
  const chat = history?.find((c) => c.id === id)
  const title = chat?.title ?? t('sidebar.newChat')
  const status = useAtomValue(chatStatusAtom)
  const replying = status === 'submitted' || status === 'streaming'

  return (
    <div className="no-drag flex max-w-lg min-w-0 items-center gap-2">
      <h1
        className="truncate text-sm font-medium"
        title={title}
        data-testid={TEST_IDS.chat.header.title}
      >
        {title}
      </h1>
      {replying && (
        <span
          className="bg-primary-ink size-1.5 shrink-0 rounded-full"
          role="status"
          aria-label={t('header.streaming')}
          data-streaming=""
        />
      )}
      <ModelChip />
      <ChatMenu chat={chat} />
    </div>
  )
}

/** Opens the panel on its last section; a dot when it has anything to show. */
function PanelToggle() {
  const { t } = useTranslation('chat')
  const [panel, setPanel] = useAtom(chatPanelAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const hasItems = useMemo(
    () => hasPanelItems(chatPanelItems(messages)),
    [messages]
  )
  return (
    <div className="relative">
      <HeaderButton
        label={t('header.panel')}
        icon={SidebarRightIcon}
        pressed={panel.open}
        onClick={() =>
          setPanel({ ...panel, open: !panel.open, runId: undefined })
        }
        testId={TEST_IDS.chat.header.panelToggle}
      />
      {hasItems && (
        <span
          className="bg-primary-ink pointer-events-none absolute top-1 right-1 size-1.5 rounded-full"
          data-has-items=""
        />
      )}
    </div>
  )
}
```

If `IconSvgElement` is not what `@hugeicons/react` exports for an icon's type, use `typeof ArrowLeft01Icon` for the prop instead.

- [ ] **Step 5: Mount it in the layout**

In `src/renderer/layouts/chat-layout/index.tsx`: add `import { ChatHeader } from '@/components/chat/header/chat-header'` (sorted among the `@/components` imports) and, inside `ContentHeader`'s `<header>`, after the `{!open && (<SidebarTrigger … />)}` block, add `<ChatHeader />`.

- [ ] **Step 6: CLAUDE.md**

In `CLAUDE.md`, in the renderer's chat bullets, insert this bullet right before the one beginning `- **A regenerate group is one segment**`:

```markdown
- **The chat header** (`components/chat/header/`, spec
  `docs/superpowers/specs/2026-10-08-chat-header-redesign-design.md`): the
  browser-like tab strip is gone (2026-10-08). `chat-header.tsx` draws `←`
  `→` over the app's own page history — a pure stack in `lib/route-history.ts`
  (`historyAtom`, capped at 50, a deleted chat's entries removed), recorded
  once by `useRouteHistoryRecorder` in `layouts/chat-layout/index.tsx`, walked
  by the arrows and by `Mod+[` / `Mod+]` (`Mod+W` closes the chat on screen:
  home, nothing deleted); on a chat page the title (the history list's, live)
  with a dot while replying, `model-chip.tsx` (the provider and model from
  `providerConfig`, a pick from the cached `modelCatalog` saved with its
  snapshot) and `chat-menu.tsx` (rename, favourite, export as Markdown / PDF
  through `lib/chat-export.ts` and the `md-to-pdf` route's print sheet
  `main/lib/pdf/print-document.ts`, delete); `phone-dot.tsx` (a paired phone
  seen in the last five minutes, `lib/phone-presence.ts`); and the toggle of
  `components/chat/panel/chat-panel.tsx` — files, tools and sources derived
  from the open chat's messages (`chatMessagesAtom`, set by `<Chat>` when a
  message is added or the stream settles) by `lib/chat-panel-items.ts`, each
  row scrolling to its run (`lib/scroll-to-run.ts`, the rail's rule) and an
  artifact row opening its card (`revealArtifactAtom`). It replaced the
  Sources panel: a message's Sources button opens the panel on that run.
```

- [ ] **Step 7: Run everything**

Run: `bun run test tests/unit/renderer/components/chat/chat-header.test.ts` — PASS (7 tests). Then the full gate: `bun run fmt` (then `git status` to confirm only your files changed), `bun run lint`, `bun run typecheck`, `bun run i18n:check`, `bun run test` — all clean, including `tests/unit/shared/constants/test-ids.linkage.test.ts` and the CLAUDE.md freshness tests.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/chat/header/phone-dot.tsx src/renderer/components/chat/header/chat-header.tsx src/renderer/layouts/chat-layout/index.tsx CLAUDE.md tests/unit/renderer/components/chat/chat-header.test.ts
git commit -m "feat(chat): the chat header — ← → over the app's page history, the title with a dot while replying, the model chip and the menu, a paired-phone dot, the toggle of the files / tools / sources panel — in the tab strip's place" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §2 layout → Tasks 2 (strip removed) and 8 (three groups, chat-page-only middle and toggle). §3 history → Task 1 (stack, cap, `without`), Task 2 (recorder mounted, shortcuts, the deletion dialog, `Mod+W`); Decisions 1–2 record the path-navigation and Settings exceptions. §4 title group → Task 8 (title, dot, truncation via `title`), Task 7 (chip, menu), Task 3 (export; Decision 4–5). §5 panel → Task 4 (derivations, caps), Task 5 (messages atom, scroll, reveal), Task 6 (panel, Sources button, `sourcesPanel` retired). §6 phone dot → Tasks 4 and 8 (Decision 6). §7 edge cases: live rename (the list's title, Task 8); dot per app (`chatStatusAtom`); a model picked mid-stream applies to the next run (settings are read per run); `Mod+W` with a draft keeps the atom's text (nothing clears it); the 200 cap (Task 4); empty chat disables exports (Task 7). §8 tests: `route-history`, `use-route-history`, `use-keyboard-shortcuts` (Mod+[ / Mod+] / Mod+W), `chat-export`, `chat-panel-items`, `chat-panel`, `model-chip`, `chat-menu`, `chat-header`, `phone-presence`, `provider-labels`, `scroll-to-run`, `print-document`; the tab strip had no ids or tests to remove; `chat.header.*` and `chat.panel.*` added.
- **Placeholders.** None: every step carries its code, strings and commands; the ten-locale tables are complete (plural forms per the Global Constraints).
- **Type consistency.** `RouteHistory`/`historyAtom`/`useRouteHistory` names match across Tasks 1, 2 and 8; `ChatPanelState`/`chatPanelAtom` across Tasks 6 and 8; `chatMessagesAtom`/`revealArtifactAtom` across Tasks 5, 6, 7, 8; `ExportLabels`/`chatToMarkdown`/`exportFileName` across Tasks 3 and 7; `chatPanelItems`/`hasPanelItems` across Tasks 4, 6, 8; `isPhoneOnline` across Tasks 4 and 8; `TEST_IDS.chat.header.*` declared in Task 7, applied by Tasks 7 and 8 (the linkage test is green only after Task 8, as both tasks say).
- **Review Focus.** Each line names its owning task and that task's test exercises it (Task 1 `without` cases and the forward-branch case; Task 2 `Mod+W` off a chat page; Task 4 malformed-results case; Task 3 the two-run references case; Task 7 the pick/snapshot and current-model cases).
