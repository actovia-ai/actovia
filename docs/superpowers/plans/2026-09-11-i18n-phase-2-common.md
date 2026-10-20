# i18n Phase 2 — `common` Namespace Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every generic, reused-across-features string in the renderer (Save/Cancel/Delete/Close/Retry/Edit/Add/Create button labels, the "Local" badge) out of hardcoded JSX and into `src/shared/i18n/locales/en/common.json`, rendered via `useTranslation('common')` — with **zero visible change** to any currently-displayed English text.

**Architecture:** This is the first of ~13 per-namespace extraction passes in i18n Phase 2 (Phase 1 — the i18next runtime, catalogs, and locale plumbing — is done and merged). Each task below is a same-shape batch of files: add `useTranslation('common')` to the component, replace one or more literal strings with `t('action.save')`-style calls, verify the rendered text is byte-identical.

**Tech Stack:** React 19, `react-i18next` (already wired via `<I18nProvider>` in all 4 entry points — no provider changes in this plan). Existing `common.json` scaffold already has `appName`, `action.{save,cancel,delete,close,retry,confirm}`, `state.{loading,local}`.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md` (Rollout, Phase 2). Phase 1 plan for context on what already exists: `docs/superpowers/plans/2026-09-11-i18n-phase-1-infrastructure.md`.

## Global Constraints

- **No visible change.** Every replaced string must render byte-identical English text. If a candidate site's wording doesn't _exactly_ match an existing/new `common` key (e.g. "Save changes" vs "Save", "Submit" vs "Confirm"), it is **out of scope for this plan** — leave it hardcoded; it belongs to a feature namespace in a later pass. Do not paraphrase a string to fit a key.
- **`common` namespace usage convention:** `const { t } = useTranslation('common')` then `t('action.save')` — **no `common:` prefix** on the key once the hook's default namespace is set. (The `ns:key` colon syntax is only for looking up a _different_ namespace than the hook's default.)
- **Namespace scope for this pass:** renderer only. No `src/main/**` file currently uses `common`-style generic action wording (main's own strings live in `menu`/`errors`, later passes) — nothing to touch there.
- **New keys added to `en/common.json` this pass:** `action.edit`, `action.add`, `action.create` (all `{}` in every non-English locale already — Phase 3 translates them, not this plan).
- **Excluded from this pass (near-misses, do not touch):** `src/renderer/containers/project-detail.tsx:89` ("Save changes" — not an exact match to `action.save`); `src/renderer/layouts/chat-layout/rename-chat-dialog.tsx:59` ("Submit" — not an exact match to `action.confirm`, and not yet duplicated elsewhere); `src/renderer/layouts/chat-layout/nav-projects.tsx:187` ("...and all its chats. This action cannot be undone." — the trailing sentence is reusable-shaped but appears only once today; extract to `common` only once it's genuinely duplicated, per YAGNI); all "verb + feature noun" composites like "Edit server", "Delete team", "Close detail panel", "Cancel scheduled task", "Edit avatar", "Next place" (feature-specific phrasing, not generic — later namespace passes).
- **Pre-commit gate unchanged from Phase 1:** `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm i18n:check` → `pnpm test`. `--no-verify` only for the documented PGlite WASM teardown flake.
- **Follow existing patterns:** components in this codebase call hooks at the top of the function body, before any early return; match each file's existing import-grouping style (oxfmt will reorder imports into groups automatically — importing `useTranslation` from `react-i18next` alongside existing imports and letting `oxfmt` sort it is fine).

---

### Task 1: Add the three missing `common` keys

**Files:**

- Modify: `src/shared/i18n/locales/en/common.json`
- Test: `tests/unit/i18n/common-namespace.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `common.json`'s `action` object gains `edit`, `add`, `create` (all subsequent tasks use these key names verbatim via `t('action.edit')` etc.).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n/common-namespace.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const common = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'shared',
      'i18n',
      'locales',
      'en',
      'common.json'
    ),
    'utf8'
  )
)

describe('common.json (Phase 2 additions)', () => {
  it('has the action verbs used by the Phase 2 common-namespace extraction', () => {
    expect(common.action).toMatchObject({
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      close: 'Close',
      retry: 'Retry',
      confirm: 'Confirm',
      edit: 'Edit',
      add: 'Add',
      create: 'Create'
    })
  })
  it('still has the state keys from Phase 1', () => {
    expect(common.state).toMatchObject({ loading: 'Loading…', local: 'Local' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/i18n/common-namespace.test.ts`
Expected: FAIL — `common.action.edit` etc. are `undefined`.

- [ ] **Step 3: Add the three keys**

Edit `src/shared/i18n/locales/en/common.json` — it currently reads:

```json
{
  "appName": "Actovia",
  "action": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "close": "Close",
    "retry": "Retry",
    "confirm": "Confirm"
  },
  "state": {
    "loading": "Loading…",
    "local": "Local"
  }
}
```

Change the `action` object to:

```json
  "action": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "close": "Close",
    "retry": "Retry",
    "confirm": "Confirm",
    "edit": "Edit",
    "add": "Add",
    "create": "Create"
  },
```

- [ ] **Step 4: Run to verify it passes, plus the catalog audit**

Run: `npx vitest run tests/unit/i18n/common-namespace.test.ts && pnpm i18n:check`
Expected: test passes; `i18n:check` still exits 0 (new `en` keys are simply "not yet translated" `info` findings for every non-English locale — unchanged behavior from Phase 1).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean on both projects — `types.d.ts`'s `typeof import('./locales/en/common.json')` picks up the three new keys automatically (no manual type edit needed), so `t('action.edit')` now type-checks anywhere `useTranslation('common')` is used.

- [ ] **Step 6: Format & commit**

```bash
npx oxfmt src/shared/i18n/locales/en/common.json tests/unit/i18n/common-namespace.test.ts
git add src/shared/i18n/locales/en/common.json tests/unit/i18n/common-namespace.test.ts
git commit -m "feat(i18n): add action.edit/add/create to the common catalog"
```

---

### Task 2: Extract `common` strings — Settings area (7 files)

**Files:**

- Modify: `src/renderer/components/settings/settings-form/knowledge-base.tsx`
- Modify: `src/renderer/components/settings/settings-form/lock-privacy.tsx`
- Modify: `src/renderer/components/settings/settings-form/mcp-servers.tsx`
- Modify: `src/renderer/components/settings/settings-form/data-controls.tsx`
- Modify: `src/renderer/components/settings/settings-form/memory.tsx`
- Modify: `src/renderer/components/settings/settings-form/update-panel.tsx`
- Modify: `src/renderer/components/settings/settings-form/profile.tsx`

**Interfaces:**

- Consumes: `common.action.{save,cancel,delete,edit,retry}`, `common.state.local` (Task 1 + Phase 1 scaffold).
- Produces: nothing new for later tasks — this is a leaf batch.

For EACH file below: **read the file first** to see its current imports and the exact surrounding JSX (line numbers are current as of this plan's writing and may drift by a line or two from unrelated formatting — locate by the quoted literal, not blindly by line number). If the component doesn't already call any hook from `react-i18next`, add the import and call `const { t } = useTranslation('common')` once, near its other hooks at the top of the function body. If it already has a `useTranslation(...)` call for another namespace, change it to the array form `useTranslation(['common', '<existing-ns>'])` and prefix lookups from the non-default namespace with `<existing-ns>:` — but for this task, none of these 7 files are expected to have an existing i18n hook (this is Phase 2's first pass), so just add a fresh one.

- [ ] **Step 1: `knowledge-base.tsx` — 6 sites**

  - Line ~168: `<Button variant="outline" onClick={onClose}>Cancel</Button>` → replace the `Cancel` child with `{t('action.cancel')}`.
  - Line ~175: `{saving ? 'Saving…' : 'Save'}` → replace with `{saving ? t('action.saving') : t('action.save')}`. **Note:** `action.saving` does not exist in the scaffold yet — add it to `en/common.json` in this same step as `"saving": "Saving…"` (next to `"save"`), since it's a direct progressive-tense pair with `save` and belongs in `common` for the same reason.
  - Line ~222: `title="Edit"` → `title={t('action.edit')}`.
  - Line ~231: `title="Delete"` → `title={t('action.delete')}`.
  - Line ~575: `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `<AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>`.
  - Line ~577: `<AlertDialogAction variant="destructive" onClick={confirmDelete}>Delete</AlertDialogAction>` → replace the `Delete` child with `{t('action.delete')}`.

- [ ] **Step 2: `lock-privacy.tsx` — 1 site**

  - Line ~224: `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `<AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>`.

- [ ] **Step 3: `mcp-servers.tsx` — 1 site**

  - Line ~618: `<Button variant="outline" ... onClick={resetForm}>Cancel</Button>` → replace the `Cancel` child with `{t('action.cancel')}`.

- [ ] **Step 4: `data-controls.tsx` — 2 sites**

  - Line ~207: `<Button variant="outline" ...>Cancel</Button>` (Import Data dialog) → replace the `Cancel` child with `{t('action.cancel')}`.
  - Line ~267: `<Button variant="outline" ...>Cancel</Button>` (Delete All Data dialog) → replace the `Cancel` child with `{t('action.cancel')}`.

- [ ] **Step 5: `memory.tsx` — 2 sites**

  - Line ~125: `title="Delete"` → `title={t('action.delete')}`.
  - Line ~231: `<Button variant="ghost" size="sm" onClick={handleDelete}>Delete</Button>` → replace the `Delete` child with `{t('action.delete')}`.

- [ ] **Step 6: `update-panel.tsx` — 1 site**

  - Line ~143: `<Button variant="outline" size="sm" onClick={() => updaterCheck()}>Retry</Button>` → replace the `Retry` child with `{t('action.retry')}`.

- [ ] **Step 7: `profile.tsx` — 1 site**

  - Line ~161: `<Badge variant="secondary" className="text-xs font-normal">Local</Badge>` → replace the `Local` child with `{t('state.local')}`. This file's default export is `Profile` — add the hook there.

- [ ] **Step 8: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run` then `pnpm i18n:check`
Expected: typecheck clean (every `t('action.X')` call resolves against `common.json`'s real keys — a typo here is a compile error thanks to Phase 1's `CustomTypeOptions`); lint clean; full suite green (no existing test asserts on the literal "Cancel"/"Delete"/etc. text in these files — if one does, update its expectation to the same rendered string, since `en`'s value is unchanged); `i18n:check` still OK.

- [ ] **Step 9: Manual smoke (if a dev environment is available)**

Run: `pnpm dev`, open Settings → Knowledge Base / Lock & Privacy / MCP Servers / Data Controls / Memory / General (update panel) / Profile. Expected: every button/label reads exactly as before — "Save", "Saving…", "Cancel", "Delete", "Edit", "Retry", "Local" — no visible change.

- [ ] **Step 10: Format & commit**

```bash
npx oxfmt src/renderer/components/settings/settings-form/knowledge-base.tsx src/renderer/components/settings/settings-form/lock-privacy.tsx src/renderer/components/settings/settings-form/mcp-servers.tsx src/renderer/components/settings/settings-form/data-controls.tsx src/renderer/components/settings/settings-form/memory.tsx src/renderer/components/settings/settings-form/update-panel.tsx src/renderer/components/settings/settings-form/profile.tsx src/shared/i18n/locales/en/common.json
git add src/renderer/components/settings/settings-form/knowledge-base.tsx src/renderer/components/settings/settings-form/lock-privacy.tsx src/renderer/components/settings/settings-form/mcp-servers.tsx src/renderer/components/settings/settings-form/data-controls.tsx src/renderer/components/settings/settings-form/memory.tsx src/renderer/components/settings/settings-form/update-panel.tsx src/renderer/components/settings/settings-form/profile.tsx src/shared/i18n/locales/en/common.json
git commit -m "feat(i18n): extract common strings in Settings (7 files)"
```

---

### Task 3: Extract `common` strings — Philharmonic area (4 files)

**Files:**

- Modify: `src/renderer/components/philharmonic/teams/team-editor.tsx`
- Modify: `src/renderer/components/philharmonic/employees/employee-editor.tsx`
- Modify: `src/renderer/components/philharmonic/chat/conversation-list.tsx`
- Modify: `src/renderer/components/philharmonic/workforce/workforce-page.tsx`

**Interfaces:**

- Consumes: `common.action.{save,cancel,delete,edit,create}` (Task 1 + Phase 1 scaffold).
- Produces: nothing new for later tasks.

Same read-first, add-hook-if-missing approach as Task 2.

- [ ] **Step 1: `team-editor.tsx` — 2 sites**

  - Line ~95: `<Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>` → replace the `Cancel` child with `{t('action.cancel')}`.
  - Line ~102: `{isNew ? 'Create' : 'Save'}` → `{isNew ? t('action.create') : t('action.save')}`.

- [ ] **Step 2: `employee-editor.tsx` — 2 sites**

  - Line ~252: `<Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>` → replace the `Cancel` child with `{t('action.cancel')}`.
  - Line ~259: `{isNew ? 'Create' : 'Save'}` → `{isNew ? t('action.create') : t('action.save')}`.

- [ ] **Step 3: `conversation-list.tsx` — 3 sites**

  - Line ~233: `<ContextMenuItem variant="destructive">Delete</ContextMenuItem>` (or similar — locate the "Delete" child of the group's context-menu item) → replace with `{t('action.delete')}`.
  - Line ~285: `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `<AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>`.
  - Lines ~295-296: `<AlertDialogAction variant="destructive" ...>Delete</AlertDialogAction>` → replace the `Delete` child with `{t('action.delete')}`.

- [ ] **Step 4: `workforce-page.tsx` — 6 sites**

  - Line ~116: `<ContextMenuItem onClick={() => onEdit(employee)}>Edit</ContextMenuItem>` → replace the `Edit` child with `{t('action.edit')}`.
  - Line ~124: `<ContextMenuItem variant="destructive" onClick={() => onAskDelete(employee)}>Delete</ContextMenuItem>` → replace the `Delete` child with `{t('action.delete')}`.
  - Line ~512: `<AlertDialogCancel>Cancel</AlertDialogCancel>` (delete-employee dialog) → `{t('action.cancel')}`.
  - Line ~536: `<AlertDialogAction variant="destructive" ...>Delete</AlertDialogAction>` (delete-employee dialog) → `{t('action.delete')}`.
  - Line ~564: `<AlertDialogCancel>Cancel</AlertDialogCancel>` (delete-team dialog) → `{t('action.cancel')}`.
  - Line ~590: `<AlertDialogAction variant="destructive" ...>Delete</AlertDialogAction>` (delete-team dialog) → `{t('action.delete')}`.

  Leave `Edit team` (line ~203) and `Delete team` (line ~215) untouched — composite feature phrases, out of scope per Global Constraints.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green, no visible-text change.

- [ ] **Step 6: Manual smoke (if a dev environment is available)**

Open Philharmonic → Workforce (employee/team context menus + delete dialogs) and a Group chat → delete-group dialog. Expected: identical text to before.

- [ ] **Step 7: Format & commit**

```bash
npx oxfmt src/renderer/components/philharmonic/teams/team-editor.tsx src/renderer/components/philharmonic/employees/employee-editor.tsx src/renderer/components/philharmonic/chat/conversation-list.tsx src/renderer/components/philharmonic/workforce/workforce-page.tsx
git add src/renderer/components/philharmonic/teams/team-editor.tsx src/renderer/components/philharmonic/employees/employee-editor.tsx src/renderer/components/philharmonic/chat/conversation-list.tsx src/renderer/components/philharmonic/workforce/workforce-page.tsx
git commit -m "feat(i18n): extract common strings in Philharmonic (4 files)"
```

---

### Task 4: Extract `common` strings — Chat-layout sidebar (5 files)

**Files:**

- Modify: `src/renderer/layouts/chat-layout/rename-chat-dialog.tsx`
- Modify: `src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx`
- Modify: `src/renderer/layouts/chat-layout/nav-projects.tsx`
- Modify: `src/renderer/layouts/chat-layout/nav-histories.tsx`
- Modify: `src/renderer/layouts/chat-layout/nav-footer.tsx`

**Interfaces:**

- Consumes: `common.action.{cancel,delete,create}`, `common.state.local` (Task 1 + Phase 1 scaffold).
- Produces: nothing new for later tasks.

- [ ] **Step 1: `rename-chat-dialog.tsx` — 1 site**

  - Line ~48: `<AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel>` → replace the `Cancel` child with `{t('action.cancel')}`. Leave the `Submit` button (line ~59) untouched — out of scope per Global Constraints.

- [ ] **Step 2: `chat-deletion-confirmation-dialog.tsx` — 2 sites**

  - Line ~36: `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `{t('action.cancel')}`.
  - Line ~45: `<AlertDialogAction className="bg-destructive ...">Delete</AlertDialogAction>` → replace the `Delete` child with `{t('action.delete')}`.

- [ ] **Step 3: `nav-projects.tsx` — 4 sites**

  - Line ~131: `<span className="text-destructive">Delete</span>` (project dropdown menu item) → replace the `Delete` child with `{t('action.delete')}`.
  - Line ~171: `<Button onClick={handleCreateProject} ...>Create</Button>` → replace the `Create` child with `{t('action.create')}`.
  - Line ~191: `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `{t('action.cancel')}`.
  - Line ~193: `<AlertDialogAction onClick={handleDeleteProject}>Delete</AlertDialogAction>` → replace the `Delete` child with `{t('action.delete')}`.

  Leave `Edit project` (line ~125) and the "...and all its chats. This action cannot be undone." sentence (line ~187) untouched — out of scope per Global Constraints.

- [ ] **Step 4: `nav-histories.tsx` — 1 site**

  - Line ~159: `<span className="text-destructive hover:text-destructive">Delete</span>` (chat item dropdown menu item) → replace the `Delete` child with `{t('action.delete')}`.

- [ ] **Step 5: `nav-footer.tsx` — 1 site**

  - Line ~50: `<span className="text-muted-foreground text-xs">Local</span>` → replace the `Local` child with `{t('state.local')}`.

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green. Note `tests/e2e/sidebar.spec.ts` asserts on the sidebar's rendered text/test-ids in a few places — it's a Playwright spec (not part of `pnpm test`), but if you can run it, confirm nothing there matched a literal "Delete"/"Cancel"/"Create" string directly (it uses `getByTestId` for the interactive elements this plan touches, per CLAUDE.md's test-id convention, so it should be unaffected).

- [ ] **Step 7: Manual smoke (if a dev environment is available)**

Open the chat sidebar: rename a chat, delete a chat, create/delete a project, check the footer's "Local" badge. Expected: identical text to before.

- [ ] **Step 8: Format & commit**

```bash
npx oxfmt src/renderer/layouts/chat-layout/rename-chat-dialog.tsx src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx src/renderer/layouts/chat-layout/nav-projects.tsx src/renderer/layouts/chat-layout/nav-histories.tsx src/renderer/layouts/chat-layout/nav-footer.tsx
git add src/renderer/layouts/chat-layout/rename-chat-dialog.tsx src/renderer/layouts/chat-layout/chat-deletion-confirmation-dialog.tsx src/renderer/layouts/chat-layout/nav-projects.tsx src/renderer/layouts/chat-layout/nav-histories.tsx src/renderer/layouts/chat-layout/nav-footer.tsx
git commit -m "feat(i18n): extract common strings in the chat sidebar (5 files)"
```

---

### Task 5: Extract `common` strings — remaining files (5 files)

**Files:**

- Modify: `src/renderer/components/sheet-panel.tsx`
- Modify: `src/renderer/components/web-search/image-lightbox.tsx`
- Modify: `src/renderer/containers/skills-market/index.tsx`
- Modify: `src/renderer/containers/skills-market/skill-cards.tsx`
- Modify: `src/renderer/components/composer-tools.tsx`

**Interfaces:**

- Consumes: `common.action.{close,retry,add}`, `common.state.local` (Task 1 + Phase 1 scaffold).
- Produces: nothing new for later tasks. This is the last extraction batch for the `common` namespace.

- [ ] **Step 1: `sheet-panel.tsx` — 1 site**

  - Line ~40: `<span className="sr-only">Close</span>` → replace the `Close` child with `{t('action.close')}`. This is a generic, shared `SheetPanel` component used by multiple features (member panels, sources panel) — the hook belongs on `SheetPanel` itself, not its callers.

- [ ] **Step 2: `image-lightbox.tsx` — 1 site**

  - Line ~169: `aria-label="Close"` → `aria-label={t('action.close')}`.

- [ ] **Step 3: `skills-market/index.tsx` — 1 site**

  - Line ~316: `<Button variant="outline" size="sm" onClick={() => mutateRegistry()}>Retry</Button>` → replace the `Retry` child with `{t('action.retry')}`.

- [ ] **Step 4: `skills-market/skill-cards.tsx` — 1 site**

  - Line ~247: `<Badge variant="secondary" ...>Local</Badge>` → replace the `Local` child with `{t('state.local')}`.

- [ ] **Step 5: `composer-tools.tsx` — 1 site**

  - Line ~113: `aria-label="Add"` → `aria-label={t('action.add')}`.

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green.

- [ ] **Step 7: Manual smoke (if a dev environment is available)**

Open the composer's "+" tools menu, an image gallery lightbox, the Skills market page (trigger a registry-load failure to see the Retry button if feasible, or just confirm the button text by reading the rendered DOM), and an installed skill card's "Local" badge. Expected: identical text to before.

- [ ] **Step 8: Format & commit**

```bash
npx oxfmt src/renderer/components/sheet-panel.tsx src/renderer/components/web-search/image-lightbox.tsx src/renderer/containers/skills-market/index.tsx src/renderer/containers/skills-market/skill-cards.tsx src/renderer/components/composer-tools.tsx
git add src/renderer/components/sheet-panel.tsx src/renderer/components/web-search/image-lightbox.tsx src/renderer/containers/skills-market/index.tsx src/renderer/containers/skills-market/skill-cards.tsx src/renderer/components/composer-tools.tsx
git commit -m "feat(i18n): extract common strings in sheet panel, lightbox, skills market, composer (5 files)"
```

---

### Task 6: Verify the namespace is fully extracted

**Files:**

- None modified — verification only.

**Interfaces:**

- Consumes: the `pnpm i18n:audit` script (Phase 1).
- Produces: a confirmation the `common` namespace pass reduced the un-i18n'd baseline; no new artifacts for later tasks.

- [ ] **Step 1: Re-run the audit**

Run: `pnpm i18n:audit`
Expected: the reported JSX-text-node and toast-title counts are lower than Phase 1's baseline (229 JSX text nodes / 58 toast titles) by roughly the ~35 call sites this plan touched. (The audit is a regex heuristic, not exact — a rough reduction confirms progress; it will still report many remaining sites, since the other 12 namespaces are future passes.)

- [ ] **Step 2: Full gate one more time**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: everything green across all 5 commits in this plan combined.

- [ ] **Step 3: No commit** — this task is verification-only; nothing to stage.

---

## Self-Review

**1. Spec coverage:** the design spec's Phase 2 description ("move that domain's literals into `en/<ns>.json`, swap call sites to `t()`") is fully covered for the `common` namespace: every direct-match candidate site the survey found is assigned to a task, and every near-miss/composite is explicitly excluded with a stated reason (not a silent gap).

**2. Placeholder scan:** every step names an exact file, an exact (approximate, read-first-to-confirm) line, the exact current literal, and the exact replacement code. No step says "similar to Task N" without repeating the concrete instruction. The only intentional imprecision is line numbers ("~168") — flagged explicitly as approximate and to be located by literal text, matching the latitude Phase 1's Task 9 already established for entry-point files whose exact content the plan author hadn't re-read at commit time.

**3. Type consistency:** every `t('action.X')` / `t('state.X')` call site uses a key that exists (or is created in Task 1) in `en/common.json`; Task 2's `action.saving` addition is called out explicitly since it wasn't in the original Phase 1 scaffold or this plan's Global Constraints list of new keys — added there inline rather than left implicit.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-i18n-phase-2-common.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
