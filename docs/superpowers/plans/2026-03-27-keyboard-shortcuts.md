# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a centralized keyboard shortcuts system with a Settings display page.

**Architecture:** A `useKeyboardShortcuts` hook in ChatLayout registers a single global `keydown` listener that dispatches actions via `navigate`, Jotai atoms, and IPC calls. A new "Keyboard Shortcuts" settings page displays all shortcuts using the `Kbd` component grouped by category.

**Tech Stack:** React hooks, Jotai, React Router, Kbd/KbdGroup components, existing SettingsRow/SettingsSection

---

### File Structure

| File                                                                    | Action | Responsibility                                               |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `src/renderer/hooks/use-keyboard-shortcuts.ts`                          | Create | Central hook: single keydown listener, dispatches actions    |
| `src/renderer/components/settings/settings-form/keyboard-shortcuts.tsx` | Create | Settings page: displays all shortcuts grouped by category    |
| `src/renderer/components/settings/settings-menu.ts`                     | Modify | Add KeyboardShortcuts enum + menu entry                      |
| `src/renderer/components/settings/settings-form.tsx`                    | Modify | Wire up KeyboardShortcuts page                               |
| `src/renderer/layouts/chat-layout/index.tsx`                            | Modify | Replace inline Escape handler with useKeyboardShortcuts hook |

---

### Task 1: Create useKeyboardShortcuts hook

**Files:**

- Create: `src/renderer/hooks/use-keyboard-shortcuts.ts`

- [ ] Create the hook that registers a single `keydown` listener on `window`
- [ ] Detect platform (`navigator.platform`) for Cmd vs Ctrl
- [ ] Shortcuts to handle:
  - `Mod+N` → navigate to `/` (new chat, via `window.location.href = '/'`)
  - `Mod+,` → navigate to `/settings`
  - `Mod+Shift+F` → set `isFullTextSearchVisibleAtom(true)`
  - `Mod+W` → close active chat tab (reuse closeTab logic)
  - `Mod+Shift+E` → focus chat input textarea
  - `Escape` → close search bar (existing logic, moved here)
- [ ] Export a `SHORTCUT_MAP` constant for the settings page to consume

### Task 2: Add Keyboard Shortcuts to Settings menu

**Files:**

- Modify: `src/renderer/components/settings/settings-menu.ts`

- [ ] Add `KeyboardShortcuts = 'Keyboard Shortcuts'` to `SettingsLabel` enum
- [ ] Add menu entry with `KeyboardIcon` before `AboutActovia`

### Task 3: Create Keyboard Shortcuts settings page

**Files:**

- Create: `src/renderer/components/settings/settings-form/keyboard-shortcuts.tsx`

- [ ] Import `SHORTCUT_MAP` from the hook
- [ ] Group shortcuts by category (General, Chat, Search)
- [ ] Render each shortcut as a row: label left, `KbdGroup > Kbd` right
- [ ] Use `SettingsSection` / `SettingsRow` for consistent layout

### Task 4: Wire up settings form + layout

**Files:**

- Modify: `src/renderer/components/settings/settings-form.tsx`
- Modify: `src/renderer/layouts/chat-layout/index.tsx`

- [ ] Add `KeyboardShortcuts` case to `SettingsForm`
- [ ] Replace the inline Escape keydown + hardcoded logic in `Layout` with `useKeyboardShortcuts()`
- [ ] Verify typecheck + lint pass

### Task 5: Commit

- [ ] `git add` all new/modified files and commit
