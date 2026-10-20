# Chat header redesign — history arrows, title with model chip, the files / tools / sources panel

Date: 2026-10-08 · Status: design approved in chat (owner, 2026-10-08); spec for the owner's review
Repo: `actovia` (desktop only; the phone is untouched)
Reference: Claude's desktop app header (owner's screenshot, 2026-10-07): sidebar toggle + `←` `→` on the left, the chat title with a small status icon and a `▾` menu in the middle, a files panel toggle on the right.

## 1. Goal

The chat header stops being a browser: the tab strip goes, and with it the idea of several open chats. In its place, what Claude's header has and what a reader of a long chat needs: a way back to where they just were, the chat's name and the model answering it, and one panel that lists what the chat produced and used — files, tools, sources.

### Decided by the owner (2026-10-08)

| Decision          | Choice                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What `←` `→` mean | Browser-style history across every page the app showed (chats, home, settings), not a hidden tab list                                                                 |
| The title group   | Title + model chip (click to switch the model) + `▾` menu: rename, favourite, export (Markdown / PDF), delete                                                         |
| The right side    | One panel with three sections — files, tools, sources — replacing the separate Sources panel; no "Share" (a local app has no link to share; export lives in the menu) |
| Extras            | A paired-phone status dot in the header (green / grey, opens Settings › Devices); nothing else                                                                        |

### Non-goals

- No change to the phone.
- No new server state: the panel's three sections are derived from the chat's loaded messages.
- No change to how a chat is loaded, streamed or stored; no change to the sidebar's list.

## 2. Layout

The header keeps its height (48 px), its drag region and its place (`ContentHeader` in `src/renderer/layouts/chat-layout/index.tsx`). Three groups:

```
[ ☰ ] [ ← ] [ → ]        [ Title ● ] [ GPT-5 ▾chip ] [ ▾ ]        [ ◉ phone ] [ ▤ panel • ]
```

- **Left:** the sidebar toggle (only while the sidebar is closed — open, it stays in the sidebar's own top row, as today), then `←` and `→`. Everything in this group is `no-drag`.
- **Middle:** present only on a chat page (`/chat/:id`). The title, a streaming dot after it, the model chip, the `▾` menu button. Centred in the remaining width; the title truncates with an ellipsis at 32 rem.
- **Right:** the paired-phone dot (every page), and — on a chat page — the panel toggle, with a small dot when the panel has anything to show.
- Off a chat page (home, settings), the middle group renders nothing and the panel toggle is absent; `←` `→` work everywhere.
- Gone: `ChatTabs`, `openTabsAtom`, `ChatTab`, every "open in a tab" path (the sidebar's click handler, `⌘W`'s tab logic, the `Mod+W` test-id), and the strip's CSS. The sidebar's click simply navigates.

## 3. History: `←` `→`

A route stack of our own, not the browser's `navigation` API: exact enabled/disabled states, deterministic after a reload, unit-testable.

- `src/renderer/stores/history.ts`: `historyAtom: { entries: string[]; index: number }` (entries are router paths, e.g. `/chat/abc`, `/`, `/settings`). Pure functions in `src/renderer/lib/route-history.ts`:
  - `pushed(state, path)`: a navigation that is not the result of `back`/`forward` truncates everything after `index`, appends `path` (unless it equals the current entry), and moves `index` to the end. Capped at 50 entries (the oldest drops).
  - `back(state)` / `forward(state)`: move `index` when possible; `canGoBack(state)` / `canGoForward(state)`.
  - `without(state, path)`: a deleted chat's entries are removed (and consecutive duplicates that this creates collapse); `index` is clamped.
- A `useRouteHistory()` hook in the layout subscribes to `useLocation()` and calls `pushed` on every change that was not initiated by the arrows (a ref flag set by `goBack`/`goForward` before they call `navigate(-1)` / `navigate(1)`).
- `goBack`/`goForward` call react-router's `navigate(±1)` — the browser's history is still the thing that moves; our stack only knows what is there and where we are. Reload: the stack starts fresh at the current page (both arrows disabled).
- Deleting a chat (the existing deletion dialog's success path) calls `without`; if the current page was that chat, the app goes home as today.
- Shortcuts: `Mod+[` back, `Mod+]` forward (macOS convention; both work while typing in the composer, like `Mod+W` does). `Mod+W` becomes "close this chat": navigate home (`/`) without deleting; on any other page it does nothing.

## 4. The title group

- **Title:** `chat.title`, or the `chat:sidebar.newChat` string while it has none. A 6 px dot in the tone's ink after the title while the chat's status is `submitted` or `streaming`; gone (not hidden) otherwise. Hovering the title shows the full title in a tooltip when it was truncated.
- **Model chip** (`src/renderer/components/chat/header/model-chip.tsx`): reads `settings.providerConfig.provider` and `settings.providerConfig.model` from `useSettings()`; shows the provider's short label and the model's display name as the Settings page shows it (the cached catalog entry's label when there is one, else the raw id). Click opens a Popover listing the active provider's models from `GET /api/v1/settings/models` (what the Settings page's `ModelPicker` lists), the current one checked; choosing one calls `updateSettings` with `providerConfig.model` replaced, closes the popover, and the next message uses it (the server reads settings per run). No provider configured, or no API key: the chip reads `chat:header.noModel` and clicking it opens Settings › Providers. Switching the _provider_ stays in Settings.
- **`▾` menu** (`src/renderer/components/chat/header/chat-menu.tsx`, a DropdownMenu): Rename (the existing rename dialog), Favourite / Unfavourite (the existing `PUT /api/v1/chat { id, favorite }` the sidebar uses), Export as Markdown…, Export as PDF…, a separator, Delete (destructive; the existing confirmation dialog).
- **Export** (`src/renderer/lib/chat-export.ts`): `chatToMarkdown(messages, sources, t)` writes the chat as a document — `# <title>`, then each run as `**You:**` / `**Actovia:**` paragraphs; an assistant turn's text goes through the same rules Copy uses (`withBlockText`, then `withReferences` with the turn's sources; citation markers become `[n]`); user pictures become `![](attachment)` placeholders with the picture count; tool cards become one line `> tool: <name>`. Markdown export saves through the existing save-file IPC (the same dialog `Save` uses elsewhere; file name `<title>.md`). PDF export renders that Markdown to HTML with the app's Markdown stylesheet and posts it to the existing print route (`src/main/lib/server/routes/tools.ts`'s `printToPDF` path, generalised to take `{ html, fileName }`), then saves `<title>.pdf`.

## 5. The panel: files, tools, sources

`src/renderer/components/chat/panel/chat-panel.tsx`, mounted where `SourcesPanel` is today (the layout), a `SheetPanel` (w-88, slides in beside the content). One atom replaces `sourcesPanelAtom`: `chatPanelAtom: { open: boolean; section: 'files' | 'tools' | 'sources'; runId?: string }`.

Everything is derived from the chat's loaded messages by pure functions in `src/renderer/lib/chat-panel-items.ts`, memoised on the messages array:

- **Files** — `chatFiles(messages): ChatFile[]`, newest first:
  - _Yours:_ every image part of a user message (`{ kind: 'user-image', runId, mimeType, data }`), thumbnail from the data URL.
  - _Made here:_ artifacts (`create_artifact` tool results: `{ kind: 'artifact', id, title, runId }`), workspace files (`write_file` / `edit_file` results: `{ kind: 'workspace-file', path, runId }`, one entry per path, the latest run), generated pictures (`image_generation` results: `{ kind: 'generated-image', runId, url }`).
  - Each row: icon or thumbnail, name (artifact title, file basename, "Picture" + index), the run's question as a one-line caption. Click scrolls the transcript to that run's card (`scrollToRun(runId)` — the existing anchor the Sources button uses) and, for an artifact, opens its card as the card's own button does.
- **Tools** — `chatTools(messages): ChatToolUse[]`: every tool name called in the chat with its count and the run of its latest call, most-used first. Click scrolls to that latest run.
- **Sources** — the current Sources panel's rows (`WebSearchResult` with favicon, title, host), grouped by run with the run's question as the group's heading, newest run first; the existing per-message "Sources" button (`message-action.tsx`) sets `chatPanelAtom` to `{ open: true, section: 'sources', runId }` and the panel scrolls that group into view.
- Section tabs across the top of the panel (three segmented buttons with counts); the toggle button in the header opens the last-used section. Empty panel: one sentence (`chat:panel.empty`: "Files, tools and sources from this chat will show up here."). The header dot shows when any section has an item.
- Off a chat page the panel closes.

## 6. The paired-phone dot

A 10 px dot in the right group on every page: green when `GET /api/v1/devices` lists a paired device that was seen in the last five minutes (the existing devices query and its `lastSeenAt`), grey otherwise; tooltip `chat:header.phonePaired` / `phoneNotPaired`; click opens Settings › Devices. Refreshes with the devices query's existing interval.

## 7. Edge cases

- A chat renamed from the sidebar or by the title stream (`renamedChatTitleAtom`) updates the header title live, as the sidebar does.
- The streaming dot is read from `chatStatusAtom` (the composer's), so it is per app, not per chat — a chat opened while another streams in the background shows no dot (the status atom belongs to the chat on screen).
- A model chosen in the chip while a reply streams applies to the next message (nothing in flight changes).
- `Mod+W` with the composer holding text still navigates home; the draft is the atom's and stays (as today when switching chats).
- The panel's files list is capped at 200 rows (older ones dropped) to keep the memo cheap on huge chats.
- Export of a chat with no messages: the menu items are disabled.

## 8. Testing

- `route-history.test.ts`: push/back/forward/without, the cap, the duplicate collapse, index clamping.
- `chat-header.test.ts` (happy-dom): the three groups on a chat page; the middle group absent off it; `←`/`→` disabled states from the atom; the streaming dot follows `chatStatusAtom`; the model chip shows the configured model and calls `updateSettings` with only `providerConfig.model` changed; the `▾` menu lists the five items.
- `chat-panel-items.test.ts`: files/tools/sources derived from a fixture of messages (user images, an artifact, two writes to one path, an image generation, three tool calls, two search runs).
- `chat-export.test.ts`: the Markdown of a two-run fixture, citations as references, a block as its words.
- `use-keyboard-shortcuts.test.ts`: `Mod+[`, `Mod+]`, the new `Mod+W`.
- Removal: the tab strip's tests go; `test-ids.ts` loses the tab ids and gains `chat.header.*` and `chat.panel.*`.
