# i18n Phase 2 — philharmonic-container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the FIRST slice of the `philharmonic` i18next
namespace (currently an empty Phase-1 scaffold, `{}`) — the root
container that ties the whole Philharmonic feature together. This is
sub-plan 1 of an expected multi-plan series for `philharmonic` (~24
files, ~3,900 lines — comparable in scope to the whole `settings`
namespace, which took 6 sub-plans), split the same way: by directory/
feature area.

**Scope for this sub-plan — surveyed 4 candidate files, only 1 has
real strings:**

- `containers/philharmonic.tsx` (`PhilharmonicContainer`) — the root
  orchestrator. Has real hardcoded UI strings (toasts, tab labels, an
  empty-chat-state block, a default conversation title). **In scope.**
- `layouts/philharmonic-layout/index.tsx` (`PhilharmonicLayout`) — pure
  structural JSX (a `SidebarProvider` + the container + a toaster), zero
  UI strings. **Not in scope**, not modified.
- `layouts/philharmonic-layout/philharmonic-content-header.tsx`
  (`PhilharmonicContentHeader`) — a chrome bar holding only a sidebar
  toggle icon button, zero text. **Not in scope**, not modified.
- `components/philharmonic/empty-state.tsx` (`PhilharmonicEmptyState`)
  — a REUSABLE presentational component: `title`/`description`/
  `action.label` are all PROPS, not hardcoded strings. The component
  itself has nothing to translate — its 4 real call sites
  (`chat/group-members-panel.tsx`, `chat/conversation-list.tsx`,
  `chat/group-chat.tsx`, `workforce/workforce-page.tsx`) are where the
  actual title/description text lives, and those belong to the LATER
  `chat`- and `workforce`-area sub-plans, not this one. **Not in
  scope**, not modified.

**Architecture:**

- `containers/philharmonic.tsx` has no existing `useTranslation` call —
  fresh `useTranslation('philharmonic')`.
- Top-level catalog key `container.*` — this namespace will grow many
  top-level sections across future sub-plans (`schedule.*`, `chat.*`,
  `workforce.*`, `employees.*`, `teams.*`, ...), matching the
  `settings.json` precedent (`tools.*`, `dataControls.*`, etc. as
  sibling top-level sections within one namespace file).
- `createConversation({ title: 'New group' })`'s default title IS
  real, user-visible UI text (the initial name shown for a newly
  created group, analogous to "New chat" elsewhere) — NOT a technical
  identifier — so it gets translated
  (`container.newGroupDefaultTitle`), even though an ANALOGOUS
  pre-existing default (`chatTitle="New chat"` in
  `containers/home.tsx`/`chat-detail.tsx`, part of the ALREADY-DONE
  `chat` namespace) was apparently left hardcoded — that's a
  pre-existing gap in a different, already-shipped namespace, not a
  precedent to copy forward into new work; doing the correct thing here
  doesn't require also going back to fix unrelated prior work in the
  same commit.
- The delete-group error toast's description (`err instanceof Error ?
  err.message : String(err)`) stays untouched — it surfaces the actual
  error object's message, not static UI prose.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/philharmonic.json`
  (currently `{}`) — this sub-plan adds only the `container.*`
  top-level section; later `philharmonic` sub-plans will add their own
  sibling sections to the same file.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm `containers/philharmonic.tsx` is still clean.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file. If `pnpm test` instead shows
  "Invalid hook call"/"Cannot read properties of null" with a stack
  frame pointing outside this repo, check
  `ls -la node_modules/node_modules` first — see memory
  `stray-node-modules-symlink-incident`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Philharmonic root container

**Files:**

- Modify: `src/renderer/containers/philharmonic.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Create: `tests/unit/i18n/philharmonic-namespace.test.ts`

**Interfaces:**

- Consumes: `t` from `react-i18next`, `useTranslation('philharmonic')`.
- Produces: nothing consumed elsewhere — the `container.*` catalog
  section is used only by this file. Later `philharmonic` sub-plans
  will add their own sibling sections, not touch `container.*`.

- [ ] **Step 1: Write `philharmonic.json`**

```json
{
  "container": {
    "toast": {
      "groupDeleted": "Group deleted",
      "deleteGroupFailed": "Could not delete the group"
    },
    "tabs": {
      "costs": "Costs",
      "schedule": "Schedule"
    },
    "noGroupSelected": {
      "title": "No group selected",
      "description": "Pick a group from the left, or start a new one to message your virtual team.",
      "createButton": "Create a group"
    },
    "newGroupDefaultTitle": "New group"
  }
}
```

- [ ] **Step 2: Rewrite `containers/philharmonic.tsx`**

Add the import and hook:

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { MessageSquarePlus } from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'
```

```tsx
export function PhilharmonicContainer({
  activePage,
  onNavigate
}: {
  activePage: PhilharmonicPage
  onNavigate: (p: PhilharmonicPage) => void
}) {
  const { t } = useTranslation('philharmonic')
  const [conversations, setConversations] = useState<ConversationData[]>([])
```

Update `handleCreate`, `handleDelete`, and the JSX:

```tsx
const handleCreate = useCallback(async () => {
  const conv = await createConversation({
    title: t('container.newGroupDefaultTitle')
  })
  setConversations((p) => [{ ...conv, latestMessage: null }, ...p])
  setActiveId(conv.id)
  onNavigate('chat')
}, [onNavigate, t])
```

```tsx
const handleDelete = useCallback(
  async (id: string) => {
    try {
      await deleteConversation(id)
      setConversations((p) => p.filter((c) => c.id !== id))
      setActiveId((cur) => (cur === id ? null : cur))
      sileo.success({ title: t('container.toast.groupDeleted') })
    } catch (err) {
      sileo.error({
        title: t('container.toast.deleteGroupFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  },
  [t]
)
```

```tsx
        <Tabs defaultValue="costs" className="flex h-full min-h-0 flex-col">
          <TabsList className="mx-4 mt-3 w-fit shrink-0">
            <TabsTrigger value="costs">{t('container.tabs.costs')}</TabsTrigger>
            <TabsTrigger value="schedule" data-testid={TEST_IDS.schedule.tab}>
              {t('container.tabs.schedule')}
            </TabsTrigger>
          </TabsList>
```

```tsx
return (
  <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <MessageSquarePlus className="h-12 w-12 opacity-30" />
    <div className="text-foreground text-sm font-medium">
      {t('container.noGroupSelected.title')}
    </div>
    <div className="max-w-xs text-xs">
      {t('container.noGroupSelected.description')}
    </div>
    <Button size="sm" onClick={handleCreate}>
      {t('container.noGroupSelected.createButton')}
    </Button>
  </div>
)
```

Everything else in the file (the `agentsById`/`teamsById` memoization,
`handleSelect`/`handleRename`/`handleNavigateConfig`, the
`useConversationStream` wiring, `showMembers`/`groupChatOwnsHeader`
derivations, the `ResizableSidebarShell`/`SheetPanel` composition)
stays exactly as-is.

- [ ] **Step 3: Create the namespace test file**

Create `tests/unit/i18n/philharmonic-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const philharmonic = JSON.parse(
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
      'philharmonic.json'
    ),
    'utf8'
  )
)

describe('philharmonic namespace (en)', () => {
  it('has the container toast keys', () => {
    expect(philharmonic.container.toast).toMatchObject({
      groupDeleted: 'Group deleted',
      deleteGroupFailed: 'Could not delete the group'
    })
  })

  it('has the container tab keys', () => {
    expect(philharmonic.container.tabs).toMatchObject({
      costs: 'Costs',
      schedule: 'Schedule'
    })
  })

  it('has the no-group-selected empty state keys', () => {
    expect(philharmonic.container.noGroupSelected).toMatchObject({
      title: 'No group selected',
      description:
        'Pick a group from the left, or start a new one to message your virtual team.',
      createButton: 'Create a group'
    })
  })

  it('has the new-group default title', () => {
    expect(philharmonic.container.newGroupDefaultTitle).toBe('New group')
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

```bash
git add src/renderer/containers/philharmonic.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's root container (sub-plan 1/N)"
```

---

### Task 2: Final verification and plan commit

**Files:** none modified — verification only, plus committing this plan
document.

- [ ] **Step 1: Isolated committed-tree check**

```bash
rm -rf /tmp/actovia-committed-check
git archive HEAD | (mkdir -p /tmp/actovia-committed-check && tar -x -C /tmp/actovia-committed-check)
ln -s /Users/yanceyleo/Code/actovia/universal-client/node_modules /tmp/actovia-committed-check/node_modules
cd /tmp/actovia-committed-check
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
cd /Users/yanceyleo/Code/actovia/universal-client
rm -rf /tmp/actovia-committed-check
```

Expected: no errors.

- [ ] **Step 2: Full suite one more time**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-philharmonic-container.md
git commit -m "docs: add philharmonic-container i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
