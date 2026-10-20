# i18n Phase 2 — settings-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the first, foundational slice of the `settings` namespace: the
`SettingsLabel` navigation architecture (sidebar + tab title), General tab,
Keyboard Shortcuts tab, and the About/System Info tab (incl. the updater
panel) — resolving the `SettingsLabel`-enum-as-display-text architectural
issue along the way so every later `settings` sub-plan builds on a
non-broken foundation.

**Architecture:** `SettingsLabel`'s string VALUES stay unchanged and keep
serving as internal comparison identifiers (`activeTitle === SettingsLabel.X`
throughout `settings-form.tsx` and elsewhere) — that role is safe and
already decoupled from display text via the existing
`SETTINGS_TAB_SLUGS` map (`use-settings-tab.ts`, deep-link slugs). What
changes: the two sites that currently render a `SettingsLabel` value
verbatim as English text (`settings-form.tsx`'s `<h1>`,
`settings-sidebar.tsx`'s `{item.title}`) switch to a new
`NAV_TITLE_KEYS` lookup table (`settings-menu.ts`) that maps each
`SettingsLabel` member to a `settings.json` key path, and the sidebar's
client-side search filter switches from matching the raw enum value to
matching the translated title. The `menus.navMain[].label` field (5
group headings + 1 empty group) switches from literal English text to a
`settings.json` key path the same way. The same "swap a literal-text
field for a `ParseKeys<'settings'>`-typed key field, translate at the
render site" technique is reused for `use-keyboard-shortcuts.ts`'s
`SHORTCUT_MAP` (`label` → `labelKey`) and its 3-value `category` union
(new `CATEGORY_TITLE_KEYS` lookup), and for `generals.tsx`'s
`APPEARANCE_MODES` (`label` → `labelKey`).

**Tech Stack:** i18next + react-i18next (already wired), `ParseKeys<Ns>`
from `i18next` for compile-time-checked dynamic/table-driven key lookups
(precedent: `mainT()` in `src/main/lib/i18n.ts`, `computerUseCard.outcome.*`
in `computer-use-card.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json`, dot-nested.
  English is the source catalog — non-English locales are filled by the
  later machine-translation pass; never hand-edit them.
- Renderer component/hook: `const { t } = useTranslation('settings')` →
  `t('key.path')`. If a file already has `useTranslation('<otherNs>')`,
  switch to array form `useTranslation(['<otherNs>', 'settings'])` —
  existing namespace FIRST so already-written bare `t('key')` calls keep
  resolving — and prefix every new lookup `settings:key.path`.
  `update-panel.tsx` is the one file in this plan that already has
  `useTranslation('common')` and needs this treatment.
- Dynamic/table-driven key lookups (a value keyed by an enum/union, looked
  up at render time) are typed `ParseKeys<'settings'>` on the _field
  itself_ (imported `import type { ParseKeys } from 'i18next'`) — not
  `string` — so `t(someObject[key])` type-checks against the real catalog
  with **no cast**, and a typo or missing key is a compile error. Follow
  the `NAV_TITLE_KEYS` / `CATEGORY_TITLE_KEYS` pattern in Task 1 exactly
  for any new lookup table; do not invent a different technique.
- `src/renderer/hooks/use-keyboard-shortcuts.ts` has a real, currently
  **uncommitted** concurrent diff (adds the `toggle-developer-tools` /
  `force-refresh-page` shortcuts, changes one `window.location.href` to
  `navigate()`). Task 5 touches this file via small anchored find/replace
  edits keyed on unique, still-present substrings — never a full-file
  rewrite. If any anchor in Task 5's brief doesn't match byte-for-byte
  when the implementer opens the file, that's NEEDS_CONTEXT — stop and
  report, don't guess or paper over it. Re-run `git status --porcelain --
  src/renderer/hooks/use-keyboard-shortcuts.ts` immediately before
  dispatching Task 5 to catch any further drift.
- Never `git commit --amend`. Every task is its own commit(s) scoped to
  its own file list (`git add <exact files>`, never `-A`/`.`).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before any commit is considered done (matches the pre-commit gate;
  the two standing `--no-verify` exceptions in CLAUDE.md are unrelated to
  this plan's files and should not come up).
- **Before this plan is considered finished**, commit the plan document
  itself (`git add docs/superpowers/plans/2026-09-17-i18n-phase-2-settings-core.md`)
  — this has been missed at the end of both prior sub-plans (`chat-core`,
  `chat-tool-cards`) and caught only by review. Make it Task 8's first
  step, not an afterthought.
- Run the isolated committed-tree check (`git archive HEAD | tar -x` into
  a scratch dir, symlink `node_modules`, fresh `tsc --noEmit` for both
  `tsconfig.web.json` and `tsconfig.node.json`) as a standing step in
  Task 8, before requesting final review — a task's own gate passing
  against the live workspace does not prove the committed tree builds,
  since this is a shared, concurrently-edited working tree.

---

## Task 1: `settings-menu.ts` architecture fix + `nav.*` catalog + test scaffold

**Files:**

- Modify: `src/renderer/components/settings/settings-menu.ts` (full rewrite — file is currently clean, not under concurrent editing)
- Modify: `src/shared/i18n/locales/en/settings.json` (full rewrite — currently 9 lines)
- Create: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Produces: `NAV_TITLE_KEYS: Record<SettingsLabel, ParseKeys<'settings'>>`
  (exported from `settings-menu.ts`) — Tasks 2 and 3 consume this.
  `menus.navMain[].label` is now a `settings.json` key path (or `''` for
  the unlabeled group), not display text — Task 3 consumes this via
  `t(group.label)`.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Rewrite `settings-menu.ts`**

Replace the entire file with:

```ts
import type { ParseKeys } from 'i18next'
import {
  CloudIcon,
  CogIcon,
  DatabaseIcon,
  HammerIcon,
  HandCoinsIcon,
  InfoIcon,
  KeyboardIcon,
  MemoryStickIcon,
  NetworkIcon,
  ScrollTextIcon,
  TextSearch,
  ShoppingBagIcon,
  TelescopeIcon,
  UserIcon,
  WrenchIcon,
  MousePointer2Icon,
  CircleUserRoundIcon,
  MicIcon,
  CompassIcon
} from 'lucide-react'

export enum SettingsLabel {
  Profile = 'Profile',
  General = 'General',
  Personality = 'Personality',
  AiProviders = 'AI Providers',
  AmazonS3 = 'AWS S3',
  McpServers = 'MCP Servers',
  SkillsMarket = 'Skills Market',
  FullTextSearch = 'Full Text Search',
  KnowledgeBase = 'Knowledge Base',
  BuiltinTools = 'Built-in Tools',
  Memory = 'Memory',
  Discover = 'Discover',
  Voice = 'Voice',
  DeepResearch = 'Deep Research',
  ComputerUse = 'Computer Use',
  DataControls = 'Data Controls',
  Logger = 'Logger',
  KeyboardShortcuts = 'Keyboard Shortcuts',
  AboutActovia = 'About Actovia'
}

export type SettingsPage = SettingsLabel

/**
 * i18n key for each tab's display title, keyed by the same stable
 * `SettingsLabel` identifier already used for comparisons and deep-link
 * slugs (`SETTINGS_TAB_SLUGS` in `use-settings-tab.ts`). `SettingsLabel`'s
 * own string VALUES stay English display text used only as internal
 * comparison identifiers (`activeTitle === SettingsLabel.Profile` etc,
 * throughout the settings tree) — they are never rendered directly;
 * `settings-form.tsx` and `settings-sidebar.tsx` render
 * `t(NAV_TITLE_KEYS[label])` instead. `as const satisfies Record<...>`
 * keeps every value's exact literal key type (so
 * `t(NAV_TITLE_KEYS[x])` type-checks with no cast) while still forcing a
 * compile error if a member is missing or a key doesn't exist in the
 * catalog.
 */
export const NAV_TITLE_KEYS = {
  [SettingsLabel.Profile]: 'nav.profile.title',
  [SettingsLabel.General]: 'nav.general.title',
  [SettingsLabel.Personality]: 'nav.personality.title',
  [SettingsLabel.AiProviders]: 'nav.aiProviders.title',
  [SettingsLabel.AmazonS3]: 'nav.amazonS3.title',
  [SettingsLabel.McpServers]: 'nav.mcpServers.title',
  [SettingsLabel.SkillsMarket]: 'nav.skillsMarket.title',
  [SettingsLabel.FullTextSearch]: 'nav.fullTextSearch.title',
  [SettingsLabel.KnowledgeBase]: 'nav.knowledgeBase.title',
  [SettingsLabel.BuiltinTools]: 'nav.builtinTools.title',
  [SettingsLabel.Memory]: 'nav.memory.title',
  [SettingsLabel.Discover]: 'nav.discover.title',
  [SettingsLabel.Voice]: 'nav.voice.title',
  [SettingsLabel.DeepResearch]: 'nav.deepResearch.title',
  [SettingsLabel.ComputerUse]: 'nav.computerUse.title',
  [SettingsLabel.DataControls]: 'nav.dataControls.title',
  [SettingsLabel.Logger]: 'nav.logger.title',
  [SettingsLabel.KeyboardShortcuts]: 'nav.keyboardShortcuts.title',
  [SettingsLabel.AboutActovia]: 'nav.about.title'
} as const satisfies Record<SettingsLabel, ParseKeys<'settings'>>

// Flat menu — every entry is a top-level page. The content-side Cards provide
// the visual grouping, so the sidebar has no expandable second level. The final
// group has no label — it holds "About Actovia", pinned to the bottom.
// `label` holds a settings.json key path (empty string for the unlabeled
// group), not display text — settings-sidebar.tsx renders `t(group.label)`.
export const menus = {
  navMain: [
    {
      label: 'nav.group.personal',
      items: [
        { title: SettingsLabel.General, icon: CogIcon },
        { title: SettingsLabel.Profile, icon: CircleUserRoundIcon },
        { title: SettingsLabel.Personality, icon: UserIcon },
        { title: SettingsLabel.Memory, icon: MemoryStickIcon },
        { title: SettingsLabel.Discover, icon: CompassIcon },
        { title: SettingsLabel.Voice, icon: MicIcon },
        { title: SettingsLabel.KeyboardShortcuts, icon: KeyboardIcon }
      ]
    },
    {
      label: 'nav.group.aiTools',
      items: [
        { title: SettingsLabel.AiProviders, icon: HandCoinsIcon },
        { title: SettingsLabel.BuiltinTools, icon: WrenchIcon },
        { title: SettingsLabel.DeepResearch, icon: TelescopeIcon }
      ]
    },
    {
      // External, connection-backed capabilities: search backends, the
      // knowledge base, the computer-use sandbox, MCP connectors, the skills
      // marketplace.
      label: 'nav.group.integrations',
      items: [
        { title: SettingsLabel.FullTextSearch, icon: TextSearch },
        { title: SettingsLabel.KnowledgeBase, icon: NetworkIcon },
        { title: SettingsLabel.ComputerUse, icon: MousePointer2Icon },
        { title: SettingsLabel.McpServers, icon: HammerIcon },
        { title: SettingsLabel.SkillsMarket, icon: ShoppingBagIcon }
      ]
    },
    {
      // Where the user's data lives and how it moves in and out.
      label: 'nav.group.storage',
      items: [
        { title: SettingsLabel.DataControls, icon: DatabaseIcon },
        { title: SettingsLabel.AmazonS3, icon: CloudIcon }
      ]
    },
    {
      label: 'nav.group.developer',
      items: [{ title: SettingsLabel.Logger, icon: ScrollTextIcon }]
    },
    {
      label: '',
      items: [{ title: SettingsLabel.AboutActovia, icon: InfoIcon }]
    }
  ]
} as const
```

- [ ] **Step 2: Rewrite `settings.json`**

Replace the entire file with:

```json
{
  "general": {
    "language": {
      "label": "Language",
      "description": "The language Actovia's interface is shown in.",
      "auto": "Auto (detect from system)"
    }
  },
  "nav": {
    "profile": { "title": "Profile" },
    "general": { "title": "General" },
    "personality": { "title": "Personality" },
    "aiProviders": { "title": "AI Providers" },
    "amazonS3": { "title": "AWS S3" },
    "mcpServers": { "title": "MCP Servers" },
    "skillsMarket": { "title": "Skills Market" },
    "fullTextSearch": { "title": "Full Text Search" },
    "knowledgeBase": { "title": "Knowledge Base" },
    "builtinTools": { "title": "Built-in Tools" },
    "memory": { "title": "Memory" },
    "discover": { "title": "Discover" },
    "voice": { "title": "Voice" },
    "deepResearch": { "title": "Deep Research" },
    "computerUse": { "title": "Computer Use" },
    "dataControls": { "title": "Data Controls" },
    "logger": { "title": "Logger" },
    "keyboardShortcuts": { "title": "Keyboard Shortcuts" },
    "about": { "title": "About Actovia" },
    "group": {
      "personal": "Personal",
      "aiTools": "AI & Tools",
      "integrations": "Integrations",
      "storage": "Storage",
      "developer": "Developer"
    }
  }
}
```

- [ ] **Step 3: Create the test file**

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const settings = JSON.parse(
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
      'settings.json'
    ),
    'utf8'
  )
)

describe('settings namespace (en)', () => {
  it('keeps the pre-existing general.language keys untouched', () => {
    expect(settings.general.language.label).toBe('Language')
    expect(settings.general.language.description).toBe(
      "The language Actovia's interface is shown in."
    )
    expect(settings.general.language.auto).toBe('Auto (detect from system)')
  })

  it('has a nav title key for every SettingsLabel tab', () => {
    expect(settings.nav.profile.title).toBe('Profile')
    expect(settings.nav.general.title).toBe('General')
    expect(settings.nav.personality.title).toBe('Personality')
    expect(settings.nav.aiProviders.title).toBe('AI Providers')
    expect(settings.nav.amazonS3.title).toBe('AWS S3')
    expect(settings.nav.mcpServers.title).toBe('MCP Servers')
    expect(settings.nav.skillsMarket.title).toBe('Skills Market')
    expect(settings.nav.fullTextSearch.title).toBe('Full Text Search')
    expect(settings.nav.knowledgeBase.title).toBe('Knowledge Base')
    expect(settings.nav.builtinTools.title).toBe('Built-in Tools')
    expect(settings.nav.memory.title).toBe('Memory')
    expect(settings.nav.discover.title).toBe('Discover')
    expect(settings.nav.voice.title).toBe('Voice')
    expect(settings.nav.deepResearch.title).toBe('Deep Research')
    expect(settings.nav.computerUse.title).toBe('Computer Use')
    expect(settings.nav.dataControls.title).toBe('Data Controls')
    expect(settings.nav.logger.title).toBe('Logger')
    expect(settings.nav.keyboardShortcuts.title).toBe('Keyboard Shortcuts')
    expect(settings.nav.about.title).toBe('About Actovia')
  })

  it('has the nav group heading keys', () => {
    expect(settings.nav.group.personal).toBe('Personal')
    expect(settings.nav.group.aiTools).toBe('AI & Tools')
    expect(settings.nav.group.integrations).toBe('Integrations')
    expect(settings.nav.group.storage).toBe('Storage')
    expect(settings.nav.group.developer).toBe('Developer')
  })
})
```

- [ ] **Step 4: Run gate + verify**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

Expected: all pass. `pnpm typecheck` in particular verifies the
`as const satisfies Record<SettingsLabel, ParseKeys<'settings'>>` line —
if a `SettingsLabel` member is missing from `NAV_TITLE_KEYS` or a key
path doesn't exist in `settings.json`, this is a compile error here.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-menu.ts \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): decouple SettingsLabel display text via NAV_TITLE_KEYS"
```

---

## Task 2: `settings-form.tsx` — wire the `<h1>` tab title

**Files:**

- Modify: `src/renderer/components/settings/settings-form.tsx`
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (no new keys — no change needed unless Task 1's assertions don't already cover this; they do, skip)

**Interfaces:**

- Consumes: `NAV_TITLE_KEYS` from Task 1 (`./settings-menu`).

- [ ] **Step 1: Anchored edit — add the `useTranslation` import**

Find:

```
import { useForm } from 'react-hook-form'

import { useSettings } from '@/hooks/use-settings'
```

Replace with:

```
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSettings } from '@/hooks/use-settings'
```

- [ ] **Step 2: Anchored edit — import `NAV_TITLE_KEYS`**

Find:

```
import { SettingsLabel } from './settings-menu'
```

Replace with:

```
import { NAV_TITLE_KEYS, SettingsLabel } from './settings-menu'
```

- [ ] **Step 3: Anchored edit — get `t` in the component**

Find:

```
export function SettingsForm() {
  const { data: settings } = useSettings()
```

Replace with:

```
export function SettingsForm() {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
```

- [ ] **Step 4: Anchored edit — the `<h1>` itself**

Find:

```
      <h1 className="text-xl">{activeTitle}</h1>
```

Replace with:

```
      <h1 className="text-xl">{t(NAV_TITLE_KEYS[activeTitle])}</h1>
```

- [ ] **Step 5: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/settings-form.tsx
git commit -m "feat(i18n): translate the settings tab heading"
```

---

## Task 3: `settings-sidebar.tsx` — nav labels, search filter, chrome text

**Files:**

- Modify: `src/renderer/components/settings/settings-sidebar.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json` (add `common.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a `common` block assertion)

**Interfaces:**

- Consumes: `NAV_TITLE_KEYS`, `menus` from Task 1.

- [ ] **Step 1: Anchored edit — add the `useTranslation` import**

Find:

```
import { ArrowLeftIcon, Search } from 'lucide-react'
import { ComponentProps, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
```

Replace with:

```
import { ArrowLeftIcon, Search } from 'lucide-react'
import { ComponentProps, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
```

- [ ] **Step 2: Anchored edit — import `NAV_TITLE_KEYS`**

Find:

```
import { menus } from './settings-menu'
```

Replace with:

```
import { menus, NAV_TITLE_KEYS } from './settings-menu'
```

- [ ] **Step 3: Anchored edit — `t`, and fix the search filter to match translated text**

Find:

```
export function SettingsSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const [active, setActive] = useSettingsTab()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const isFullscreen = useIsFullscreen()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return menus.navMain

    return menus.navMain
      .map((group) => ({
        label: group.label,
        items: group.items.filter((item) =>
          item.title.toLowerCase().includes(q)
        )
      }))
      .filter((group) => group.items.length > 0)
  }, [query])
```

Replace with:

```
export function SettingsSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation('settings')
  const [active, setActive] = useSettingsTab()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const isFullscreen = useIsFullscreen()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return menus.navMain

    return menus.navMain
      .map((group) => ({
        label: group.label,
        items: group.items.filter((item) =>
          t(NAV_TITLE_KEYS[item.title]).toLowerCase().includes(q)
        )
      }))
      .filter((group) => group.items.length > 0)
  }, [query, t])
```

(Note the `t` dependency added to the `useMemo` array — `t`'s identity is
stable in i18next's steady state but changes on a locale switch, which
should re-run this filter once Phase 4 wires up live switching.)

- [ ] **Step 4: Anchored edit — "Back to app"**

Find:

```
          <ArrowLeftIcon />
          Back to app
        </Button>
```

Replace with:

```
          <ArrowLeftIcon />
          {t('common.backToApp')}
        </Button>
```

- [ ] **Step 5: Anchored edit — search placeholder**

Find:

```
            placeholder="Search settings…"
```

Replace with:

```
            placeholder={t('common.searchPlaceholder')}
```

- [ ] **Step 6: Anchored edit — group label + item title render**

Find:

```
            {group.label && (
              <SidebarGroupLabel className="text-muted-foreground/70 px-2 text-[11px] font-medium tracking-wider uppercase">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={item.title === active}
                    onClick={() => setActive(item.title)}
                  >
                    {item.icon && <item.icon />}
                    {item.title}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
```

Replace with:

```
            {group.label && (
              <SidebarGroupLabel className="text-muted-foreground/70 px-2 text-[11px] font-medium tracking-wider uppercase">
                {t(group.label)}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={item.title === active}
                    onClick={() => setActive(item.title)}
                  >
                    {item.icon && <item.icon />}
                    {t(NAV_TITLE_KEYS[item.title])}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
```

(`group.label` is `''` for the unlabeled last group — the `{group.label &&
(...)}` guard short-circuits before `t()` is ever called with an empty
string, and TypeScript's control-flow narrowing removes `''` from
`group.label`'s type inside that branch, so `t(group.label)` type-checks
against the 5 real `nav.group.*` keys with no cast.)

- [ ] **Step 7: Add `common.*` to `settings.json`**

Find (the `nav` object's closing, right after the `group` sub-object):

```
    "group": {
      "personal": "Personal",
      "aiTools": "AI & Tools",
      "integrations": "Integrations",
      "storage": "Storage",
      "developer": "Developer"
    }
  }
}
```

Replace with:

```
    "group": {
      "personal": "Personal",
      "aiTools": "AI & Tools",
      "integrations": "Integrations",
      "storage": "Storage",
      "developer": "Developer"
    }
  },
  "common": {
    "searchPlaceholder": "Search settings…",
    "backToApp": "Back to app"
  }
}
```

- [ ] **Step 8: Add a test assertion**

Find (in `tests/unit/i18n/settings-namespace.test.ts`, the end of the
`'has the nav group heading keys'` test body, just before its closing
`})`):

```
    expect(settings.nav.group.developer).toBe('Developer')
  })
```

Replace with:

```
    expect(settings.nav.group.developer).toBe('Developer')
  })

  it('has the sidebar chrome keys', () => {
    expect(settings.common.searchPlaceholder).toBe('Search settings…')
    expect(settings.common.backToApp).toBe('Back to app')
  })
```

- [ ] **Step 9: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/settings/settings-sidebar.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the settings sidebar and fix its search filter"
```

---

## Task 4: `generals.tsx` — Theme, Run on startup, Menu bar

**Files:**

- Modify: `src/renderer/components/settings/settings-form/generals.tsx` (full rewrite — file is clean)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `general.theme` / `general.runOnStartup` / `general.menuBar`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Produces: nothing new consumed by later tasks.
- Consumes: nothing from earlier tasks besides the catalog file shape.

- [ ] **Step 1: Rewrite `generals.tsx`**

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import type { ParseKeys } from 'i18next'
import { Moon, Sun, SunMoon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Theme } from '@/components/theme-provider'
import { Switch } from '@/components/ui/switch'
import { setLoginItem, setMenuBar } from '@/lib/ipc'

import { SettingsRow, SettingsSection } from '../settings-row'
import { LockPrivacy } from './lock-privacy'

const APPEARANCE_MODES: {
  value: Theme
  labelKey: ParseKeys<'settings'>
  icon: typeof Sun
}[] = [
  { value: 'system', labelKey: 'general.theme.system', icon: SunMoon },
  { value: 'light', labelKey: 'general.theme.light', icon: Sun },
  { value: 'dark', labelKey: 'general.theme.dark', icon: Moon }
]

function AppearanceSwitcher() {
  const { t } = useTranslation('settings')
  const { theme, setTheme } = useTheme()

  return (
    <div className="bg-muted inline-flex w-fit gap-0.5 rounded-full p-0.5">
      {APPEARANCE_MODES.map(({ value, labelKey, icon: Icon }) => (
        <span key={value}>
          <input
            className="peer sr-only"
            type="radio"
            id={`appearance-mode-${value}`}
            name="appearance-mode"
            value={value}
            checked={theme === value}
            onChange={(event) => setTheme(event.target.value)}
          />
          <label
            htmlFor={`appearance-mode-${value}`}
            data-testid={`${TEST_IDS.settings.themeMode}-${value}`}
            aria-label={t(labelKey)}
            className="text-muted-foreground peer-checked:bg-background peer-checked:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors peer-checked:shadow-sm"
          >
            <Icon className="size-4" />
          </label>
        </span>
      ))}
    </div>
  )
}

export function General({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const runOnStartup = form.watch('runOnStartup') ?? false
  const menuBarEnabled = form.watch('menuBar') ?? true

  useEffect(() => {
    setLoginItem(runOnStartup)
  }, [runOnStartup])

  useEffect(() => {
    setMenuBar(menuBarEnabled)
  }, [menuBarEnabled])

  return (
    <>
      <SettingsSection>
        <SettingsRow
          label={t('general.theme.label')}
          description={t('general.theme.description')}
        >
          <AppearanceSwitcher />
        </SettingsRow>

        <SettingsRow
          label={t('general.runOnStartup.label')}
          description={t('general.runOnStartup.description')}
        >
          <Switch
            checked={runOnStartup}
            onCheckedChange={(checked) =>
              form.setValue('runOnStartup', checked)
            }
          />
        </SettingsRow>

        <SettingsRow
          label={t('general.menuBar.label')}
          description={t('general.menuBar.description')}
        >
          <Switch
            checked={menuBarEnabled}
            onCheckedChange={(checked) => form.setValue('menuBar', checked)}
          />
        </SettingsRow>
      </SettingsSection>

      <LockPrivacy />
    </>
  )
}
```

- [ ] **Step 2: Add keys to `settings.json`**

Find:

```
  "general": {
    "language": {
      "label": "Language",
      "description": "The language Actovia's interface is shown in.",
      "auto": "Auto (detect from system)"
    }
  },
```

Replace with:

```
  "general": {
    "language": {
      "label": "Language",
      "description": "The language Actovia's interface is shown in.",
      "auto": "Auto (detect from system)"
    },
    "theme": {
      "label": "Theme",
      "description": "Choose light, dark, or match your system preference",
      "system": "System",
      "light": "Light",
      "dark": "Dark"
    },
    "runOnStartup": {
      "label": "Run on startup",
      "description": "Automatically start Actovia when you log in"
    },
    "menuBar": {
      "label": "Menu bar",
      "description": "Show Actovia in the menu bar"
    }
  },
```

- [ ] **Step 3: Add a test**

Find (end of the `'keeps the pre-existing general.language keys untouched'` test body):

```
    expect(settings.general.language.auto).toBe('Auto (detect from system)')
  })
```

Replace with:

```
    expect(settings.general.language.auto).toBe('Auto (detect from system)')
  })

  it('has the general.theme / runOnStartup / menuBar keys', () => {
    expect(settings.general.theme.label).toBe('Theme')
    expect(settings.general.theme.description).toBe(
      'Choose light, dark, or match your system preference'
    )
    expect(settings.general.theme.system).toBe('System')
    expect(settings.general.theme.light).toBe('Light')
    expect(settings.general.theme.dark).toBe('Dark')
    expect(settings.general.runOnStartup.label).toBe('Run on startup')
    expect(settings.general.runOnStartup.description).toBe(
      'Automatically start Actovia when you log in'
    )
    expect(settings.general.menuBar.label).toBe('Menu bar')
    expect(settings.general.menuBar.description).toBe(
      'Show Actovia in the menu bar'
    )
  })
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/generals.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the General settings tab"
```

---

## Task 5: Keyboard Shortcuts — `use-keyboard-shortcuts.ts` + `keyboard-shortcuts.tsx`

**Files:**

- Modify: `src/renderer/hooks/use-keyboard-shortcuts.ts` (**small anchored edits only** — this file has a real uncommitted concurrent diff; see Global Constraints)
- Modify: `src/renderer/components/settings/settings-form/keyboard-shortcuts.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `keyboardShortcuts.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Produces: `CATEGORY_TITLE_KEYS: Record<ShortcutDef['category'], ParseKeys<'settings'>>`
  and `ShortcutDef.labelKey: ParseKeys<'settings'>` (replaces `label:
  string`) — consumed by `keyboard-shortcuts.tsx` only, nothing later in
  this plan.

**Before starting:** run
`git status --porcelain -- src/renderer/hooks/use-keyboard-shortcuts.ts`.
If it's no longer dirty (someone committed the concurrent work), or the
diff has changed further, re-read the file fresh and confirm each "Find"
block below still matches byte-for-byte before editing. If any doesn't
match, stop and report NEEDS_CONTEXT rather than guessing at the new
shape.

- [ ] **Step 1: Anchored edit — add the `ParseKeys` import**

Find:

```
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
```

Replace with:

```
import type { ParseKeys } from 'i18next'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
```

- [ ] **Step 2: Anchored edit — `ShortcutDef.label` → `labelKey`**

Find:

```
export type ShortcutDef = {
  id: string
  keys: string[]
  label: string
  category: 'General' | 'Chat' | 'Search'
```

Replace with:

```
export type ShortcutDef = {
  id: string
  keys: string[]
  labelKey: ParseKeys<'settings'>
  category: 'General' | 'Chat' | 'Search'
```

- [ ] **Step 3: Anchored edits — each `SHORTCUT_MAP` entry's `label` → `labelKey`**

Each of these 12 is a small, independent find/replace on a unique line.
Apply all 12 (order doesn't matter, they don't overlap):

| Find                                   | Replace                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `    label: 'New chat',`               | `    labelKey: 'keyboardShortcuts.shortcuts.new-chat.label',`               |
| `    label: 'Open settings',`          | `    labelKey: 'keyboardShortcuts.shortcuts.open-settings.label',`          |
| `    label: 'Toggle sidebar',`         | `    labelKey: 'keyboardShortcuts.shortcuts.toggle-sidebar.label',`         |
| `    label: 'Toggle developer tools',` | `    labelKey: 'keyboardShortcuts.shortcuts.toggle-developer-tools.label',` |
| `    label: 'Force refresh page',`     | `    labelKey: 'keyboardShortcuts.shortcuts.force-refresh-page.label',`     |
| `    label: 'Find in page',`           | `    labelKey: 'keyboardShortcuts.shortcuts.find-in-page.label',`           |
| `    label: 'Search chat history',`    | `    labelKey: 'keyboardShortcuts.shortcuts.search-chat-history.label',`    |
| `    label: 'Close find bar',`         | `    labelKey: 'keyboardShortcuts.shortcuts.close-find-bar.label',`         |
| `    label: 'Close current tab',`      | `    labelKey: 'keyboardShortcuts.shortcuts.close-tab.label',`              |
| `    label: 'Focus chat input',`       | `    labelKey: 'keyboardShortcuts.shortcuts.focus-chat-input.label',`       |
| `    label: 'Send message',`           | `    labelKey: 'keyboardShortcuts.shortcuts.send-message.label',`           |
| `    label: 'New line',`               | `    labelKey: 'keyboardShortcuts.shortcuts.new-line.label',`               |

If a 13th `SHORTCUT_MAP` entry has appeared (someone else's concurrent
addition) with its own `label: '...'` line, leave it as `label` and note
it in your report — do not guess a key path for content this plan didn't
survey. That entry stays untranslated until a follow-up task, it does
not block this one.

- [ ] **Step 4: Anchored edit — add `CATEGORY_TITLE_KEYS` after `SHORTCUT_MAP`**

Find (the `SHORTCUT_MAP` array's closing bracket, immediately followed by
the `isModKey` helper — this exact two-line adjacency is unique in the
file):

```
]

function isModKey(e: KeyboardEvent) {
```

Replace with:

```
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

function isModKey(e: KeyboardEvent) {
```

- [ ] **Step 5: Rewrite `keyboard-shortcuts.tsx`**

```tsx
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import {
  CATEGORY_TITLE_KEYS,
  SHORTCUT_MAP,
  ShortcutDef
} from '@/hooks/use-keyboard-shortcuts'
import { useSettings } from '@/hooks/use-settings'

import { SettingsSection } from '../settings-row'

function ShortcutRow({
  shortcut,
  disabled,
  onToggle
}: {
  shortcut: ShortcutDef
  disabled: boolean
  onToggle: (id: string, enabled: boolean) => void
}) {
  const { t } = useTranslation('settings')

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex w-9 shrink-0">
        {shortcut.toggleable !== false && (
          <Switch
            checked={!disabled}
            onCheckedChange={(checked) => onToggle(shortcut.id, checked)}
          />
        )}
      </div>
      <span className="flex-1 text-sm">{t(shortcut.labelKey)}</span>
      <Kbd>{shortcut.keys.join(' + ')}</Kbd>
    </div>
  )
}

function ShortcutGroup({
  title,
  shortcuts,
  disabledIds,
  onToggle
}: {
  title: string
  shortcuts: ShortcutDef[]
  disabledIds: Set<string>
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wider uppercase">
        {title}
      </h3>
      <div className="divide-border divide-y">
        {shortcuts.map((s) => (
          <ShortcutRow
            key={s.id}
            shortcut={s}
            disabled={disabledIds.has(s.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

export function KeyboardShortcuts() {
  const { t } = useTranslation('settings')
  const { data: settings, updateSettings } = useSettings()

  const disabledIds = useMemo(
    () => new Set(settings?.keyboardShortcuts?.disabled ?? []),
    [settings?.keyboardShortcuts?.disabled]
  )

  const grouped = useMemo(() => {
    const map = new Map<ShortcutDef['category'], ShortcutDef[]>()
    for (const s of SHORTCUT_MAP) {
      const list = map.get(s.category) ?? []
      list.push(s)
      map.set(s.category, list)
    }
    return map
  }, [])

  const handleToggle = (id: string, enabled: boolean) => {
    if (!settings) return
    const next = new Set(disabledIds)
    if (enabled) {
      next.delete(id)
    } else {
      next.add(id)
    }
    updateSettings({
      ...settings,
      keyboardShortcuts: { disabled: Array.from(next) }
    })
  }

  return (
    <SettingsSection plain>
      <div className="flex flex-col gap-6">
        {Array.from(grouped.entries()).map(([category, shortcuts]) => (
          <ShortcutGroup
            key={category}
            title={t(CATEGORY_TITLE_KEYS[category])}
            shortcuts={shortcuts}
            disabledIds={disabledIds}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </SettingsSection>
  )
}
```

- [ ] **Step 6: Add `keyboardShortcuts.*` to `settings.json`**

Find (the top-level `common` object added in Task 3, closing the file):

```
  "common": {
    "searchPlaceholder": "Search settings…",
    "backToApp": "Back to app"
  }
}
```

Replace with:

```
  "common": {
    "searchPlaceholder": "Search settings…",
    "backToApp": "Back to app"
  },
  "keyboardShortcuts": {
    "category": {
      "general": "General",
      "chat": "Chat",
      "search": "Search"
    },
    "shortcuts": {
      "new-chat": { "label": "New chat" },
      "open-settings": { "label": "Open settings" },
      "toggle-sidebar": { "label": "Toggle sidebar" },
      "toggle-developer-tools": { "label": "Toggle developer tools" },
      "force-refresh-page": { "label": "Force refresh page" },
      "find-in-page": { "label": "Find in page" },
      "search-chat-history": { "label": "Search chat history" },
      "close-find-bar": { "label": "Close find bar" },
      "close-tab": { "label": "Close current tab" },
      "focus-chat-input": { "label": "Focus chat input" },
      "send-message": { "label": "Send message" },
      "new-line": { "label": "New line" }
    }
  }
}
```

If Step 3 found and reported an extra 13th shortcut entry, add its
`"<id>": { "label": "..." }` line to `shortcuts` here too, using its
existing `label` text.

- [ ] **Step 7: Add a test**

Find (end of the `'has the sidebar chrome keys'` test body):

```
    expect(settings.common.backToApp).toBe('Back to app')
  })
```

Replace with:

```
    expect(settings.common.backToApp).toBe('Back to app')
  })

  it('has a keyboard shortcut label for every SHORTCUT_MAP entry', () => {
    expect(settings.keyboardShortcuts.category.general).toBe('General')
    expect(settings.keyboardShortcuts.category.chat).toBe('Chat')
    expect(settings.keyboardShortcuts.category.search).toBe('Search')
    expect(settings.keyboardShortcuts.shortcuts['new-chat'].label).toBe(
      'New chat'
    )
    expect(settings.keyboardShortcuts.shortcuts['open-settings'].label).toBe(
      'Open settings'
    )
    expect(settings.keyboardShortcuts.shortcuts['toggle-sidebar'].label).toBe(
      'Toggle sidebar'
    )
    expect(
      settings.keyboardShortcuts.shortcuts['toggle-developer-tools'].label
    ).toBe('Toggle developer tools')
    expect(
      settings.keyboardShortcuts.shortcuts['force-refresh-page'].label
    ).toBe('Force refresh page')
    expect(settings.keyboardShortcuts.shortcuts['find-in-page'].label).toBe(
      'Find in page'
    )
    expect(
      settings.keyboardShortcuts.shortcuts['search-chat-history'].label
    ).toBe('Search chat history')
    expect(settings.keyboardShortcuts.shortcuts['close-find-bar'].label).toBe(
      'Close find bar'
    )
    expect(settings.keyboardShortcuts.shortcuts['close-tab'].label).toBe(
      'Close current tab'
    )
    expect(
      settings.keyboardShortcuts.shortcuts['focus-chat-input'].label
    ).toBe('Focus chat input')
    expect(settings.keyboardShortcuts.shortcuts['send-message'].label).toBe(
      'Send message'
    )
    expect(settings.keyboardShortcuts.shortcuts['new-line'].label).toBe(
      'New line'
    )
  })
```

- [ ] **Step 8: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

`pnpm typecheck` verifies the `satisfies Record<ShortcutDef['category'],
ParseKeys<'settings'>>` line and every `SHORTCUT_MAP` entry's `labelKey`
against the real catalog.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/hooks/use-keyboard-shortcuts.ts \
  src/renderer/components/settings/settings-form/keyboard-shortcuts.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Keyboard Shortcuts settings tab"
```

Do **not** include any of the concurrent, unrelated hunks already present
in `use-keyboard-shortcuts.ts`'s working-tree diff in this commit's
intent — they're a different agent's in-flight work that happens to sit
in the same file. Since this task's edits are anchored substring
replacements applied on top of whatever is currently in the file, `git
add` on the whole file will naturally include those neighboring
uncommitted lines too (there's no way to stage only this task's hunks in
this environment) — that's expected and matches how every prior i18n
sub-plan has handled a shared dirty tree; just don't rewrite or revert
those neighboring lines yourself.

---

## Task 6: `system-info.tsx` — About tab labels

**Files:**

- Modify: `src/renderer/components/settings/settings-form/system-info.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `about.*`, excluding `about.update.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Produces: `settings.json`'s `about` object exists after this task, with
  `update` added by Task 7 as a sibling key inside it — Task 7's anchor
  targets the `about` object's closing brace this task creates.

- [ ] **Step 1: Rewrite `system-info.tsx`**

```tsx
import {
  ACTOVIA_REPO,
  ACTOVIA_TWITTER,
  ACTOVIA_WEBSITE
} from '@shared/constants/external-urls'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { ExternalLinkIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@/components/ui/switch'
import { useUpdater } from '@/hooks/use-updater'
import { updaterSetAutoDownload } from '@/lib/ipc'

import { version } from '../../../../../package.json'
import { SettingsRow, SettingsSection } from '../settings-row'
import { UpdatePanel } from './update-panel'

function ExternalLink({
  href,
  children
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ring inline-flex items-center gap-1 text-sm hover:underline"
    >
      {children}
      <ExternalLinkIcon size={12} />
    </a>
  )
}

export function SystemInfo({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const { versions } = window.electron.process
  const { os } = window.api
  const { payload } = useUpdater()
  const autoUpdate = form.watch('autoUpdate') ?? true

  useEffect(() => {
    updaterSetAutoDownload(autoUpdate)
  }, [autoUpdate])

  return (
    <SettingsSection>
      <SettingsRow label={t('about.version')}>
        <span className="text-ring text-sm">v{version}</span>
      </SettingsRow>
      <SettingsRow label={t('about.electron')}>
        <span className="text-ring text-sm">v{versions.electron}</span>
      </SettingsRow>
      <SettingsRow label={t('about.chromium')}>
        <span className="text-ring text-sm">v{versions.chrome}</span>
      </SettingsRow>
      <SettingsRow label={t('about.node')}>
        <span className="text-ring text-sm">v{versions.node}</span>
      </SettingsRow>
      <SettingsRow label={t('about.v8')}>
        <span className="text-ring text-sm">v{versions.v8}</span>
      </SettingsRow>
      <SettingsRow label={t('about.os')}>
        <span className="text-ring text-sm">{os}</span>
      </SettingsRow>

      <SettingsRow label={t('about.github')}>
        <ExternalLink href={ACTOVIA_REPO}>actovia-ai/actovia</ExternalLink>
      </SettingsRow>
      <SettingsRow label={t('about.twitter')}>
        <ExternalLink href={ACTOVIA_TWITTER}>@YanceyOfficial</ExternalLink>
      </SettingsRow>
      <SettingsRow label={t('about.website')}>
        <ExternalLink href={ACTOVIA_WEBSITE}>actovia.yancey.app</ExternalLink>
      </SettingsRow>
      <SettingsRow label={t('about.license')}>
        <span className="text-ring text-sm">MIT</span>
      </SettingsRow>

      <SettingsRow
        label={t('about.autoUpdate.label')}
        description={t('about.autoUpdate.description')}
      >
        <Switch
          checked={autoUpdate}
          onCheckedChange={(checked) => form.setValue('autoUpdate', checked)}
        />
      </SettingsRow>

      <UpdatePanel payload={payload} autoUpdate={autoUpdate} />
    </SettingsSection>
  )
}
```

`actovia-ai/actovia`, `@YanceyOfficial`, `actovia.yancey.app`, and `MIT`
stay hardcoded — they're identifiers/proper nouns (a repo path, a handle,
a hostname, an SPDX license id), not language-dependent text.

- [ ] **Step 2: Add `about.*` to `settings.json`**

Find (the `keyboardShortcuts` object Task 5 added, closing the file):

```
    "shortcuts": {
      "new-chat": { "label": "New chat" },
      "open-settings": { "label": "Open settings" },
      "toggle-sidebar": { "label": "Toggle sidebar" },
      "toggle-developer-tools": { "label": "Toggle developer tools" },
      "force-refresh-page": { "label": "Force refresh page" },
      "find-in-page": { "label": "Find in page" },
      "search-chat-history": { "label": "Search chat history" },
      "close-find-bar": { "label": "Close find bar" },
      "close-tab": { "label": "Close current tab" },
      "focus-chat-input": { "label": "Focus chat input" },
      "send-message": { "label": "Send message" },
      "new-line": { "label": "New line" }
    }
  }
}
```

Replace with:

```
    "shortcuts": {
      "new-chat": { "label": "New chat" },
      "open-settings": { "label": "Open settings" },
      "toggle-sidebar": { "label": "Toggle sidebar" },
      "toggle-developer-tools": { "label": "Toggle developer tools" },
      "force-refresh-page": { "label": "Force refresh page" },
      "find-in-page": { "label": "Find in page" },
      "search-chat-history": { "label": "Search chat history" },
      "close-find-bar": { "label": "Close find bar" },
      "close-tab": { "label": "Close current tab" },
      "focus-chat-input": { "label": "Focus chat input" },
      "send-message": { "label": "Send message" },
      "new-line": { "label": "New line" }
    }
  },
  "about": {
    "version": "Version",
    "electron": "Electron",
    "chromium": "Chromium",
    "node": "Node.js",
    "v8": "V8",
    "os": "OS",
    "github": "GitHub",
    "twitter": "X (Twitter)",
    "website": "Website",
    "license": "License",
    "autoUpdate": {
      "label": "Auto Update",
      "description": "Automatically download and install updates when available"
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (end of the `'has a keyboard shortcut label for every SHORTCUT_MAP entry'` test body):

```
    expect(settings.keyboardShortcuts.shortcuts['new-line'].label).toBe(
      'New line'
    )
  })
```

Replace with:

```
    expect(settings.keyboardShortcuts.shortcuts['new-line'].label).toBe(
      'New line'
    )
  })

  it('has the About tab labels', () => {
    expect(settings.about.version).toBe('Version')
    expect(settings.about.electron).toBe('Electron')
    expect(settings.about.chromium).toBe('Chromium')
    expect(settings.about.node).toBe('Node.js')
    expect(settings.about.v8).toBe('V8')
    expect(settings.about.os).toBe('OS')
    expect(settings.about.github).toBe('GitHub')
    expect(settings.about.twitter).toBe('X (Twitter)')
    expect(settings.about.website).toBe('Website')
    expect(settings.about.license).toBe('License')
    expect(settings.about.autoUpdate.label).toBe('Auto Update')
    expect(settings.about.autoUpdate.description).toBe(
      'Automatically download and install updates when available'
    )
  })
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/system-info.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the About settings tab"
```

---

## Task 7: `update-panel.tsx` — updater states

**Files:**

- Modify: `src/renderer/components/settings/settings-form/update-panel.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `about.update.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Consumes: `about` object created by Task 6 (this task adds `update` as
  a nested sibling of `about.autoUpdate`).

- [ ] **Step 1: Rewrite `update-panel.tsx`**

```tsx
import {
  AlertCircleIcon,
  CheckCircleIcon,
  DownloadIcon,
  LoaderIcon,
  RefreshCwIcon,
  ZapIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { UpdaterPayload } from '@/hooks/use-updater'
import { updaterCheck, updaterDownload, updaterInstall } from '@/lib/ipc'

interface UpdatePanelProps {
  payload: UpdaterPayload
  autoUpdate: boolean
}

export function UpdatePanel({ payload, autoUpdate }: UpdatePanelProps) {
  const { t } = useTranslation(['common', 'settings'])
  const { state, availableVersion, downloadProgress, errorMessage } = payload

  if (state === 'idle') {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3">
        <span className="text-muted-foreground text-sm">
          {t('settings:about.update.checkPrompt')}
        </span>
        <Button variant="outline" size="sm" onClick={() => updaterCheck()}>
          <RefreshCwIcon className="mr-1.5 size-3.5" data-icon />
          {t('settings:about.update.checkButton')}
        </Button>
      </div>
    )
  }

  if (state === 'checking') {
    return (
      <div className="flex items-center gap-3 rounded-lg px-4 py-3">
        <LoaderIcon className="text-muted-foreground size-4 animate-spin" />
        <span className="text-muted-foreground text-sm">
          {t('settings:about.update.checking')}
        </span>
      </div>
    )
  }

  if (state === 'up-to-date') {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <CheckCircleIcon className="size-4 text-green-500" />
          <span className="text-sm">{t('settings:about.update.upToDate')}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => updaterCheck()}>
          <RefreshCwIcon className="mr-1.5 size-3.5" data-icon />
          {t('settings:about.update.checkAgain')}
        </Button>
      </div>
    )
  }

  if (state === 'available') {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <ZapIcon className="size-4 text-blue-500" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {t('settings:about.update.available')}
            </span>
            {availableVersion && (
              <span className="text-muted-foreground text-xs">
                {t('settings:about.update.availableVersion', {
                  version: availableVersion
                })}
              </span>
            )}
          </div>
        </div>
        {!autoUpdate && (
          <Button size="sm" onClick={() => updaterDownload()}>
            <DownloadIcon className="mr-1.5 size-3.5" data-icon />
            {t('settings:about.update.download')}
          </Button>
        )}
      </div>
    )
  }

  if (state === 'downloading') {
    return (
      <div className="flex flex-col gap-2 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DownloadIcon className="text-muted-foreground size-4" />
            <span className="text-sm">
              {t('settings:about.update.downloading')}
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {downloadProgress}%
          </span>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
      </div>
    )
  }

  if (state === 'ready') {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <CheckCircleIcon className="size-4 text-green-500" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {t('settings:about.update.ready')}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('settings:about.update.readyDescription')}
            </span>
          </div>
        </div>
        <Button size="sm" onClick={() => updaterInstall()}>
          {t('settings:about.update.restartAndInstall')}
        </Button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <AlertCircleIcon className="text-destructive size-4" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {t('settings:about.update.failed')}
            </span>
            {errorMessage && (
              <span className="text-muted-foreground max-w-xs truncate text-xs">
                {errorMessage}
              </span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => updaterCheck()}>
          <RefreshCwIcon className="mr-1.5 size-3.5" data-icon />
          {t('action.retry')}
        </Button>
      </div>
    )
  }

  return null
}
```

`t('action.retry')` stays a bare, unprefixed lookup — it resolves against
`common` (the app-level `common` namespace, listed first in the array),
unchanged from before this task. `{downloadProgress}%` and
`{errorMessage}` stay as-is: the former is a raw number, the latter is
dynamic text the updater itself supplies (not a catalog string).

- [ ] **Step 2: Add `about.update.*` to `settings.json`**

Find (the `about` object Task 6 added, closing the file):

```
    "autoUpdate": {
      "label": "Auto Update",
      "description": "Automatically download and install updates when available"
    }
  }
}
```

Replace with:

```
    "autoUpdate": {
      "label": "Auto Update",
      "description": "Automatically download and install updates when available"
    },
    "update": {
      "checkPrompt": "Check for the latest version",
      "checkButton": "Check for Updates",
      "checking": "Checking for updates…",
      "upToDate": "You're on the latest version",
      "checkAgain": "Check again",
      "available": "Update available",
      "availableVersion": "Version {{version}}",
      "download": "Download",
      "downloading": "Downloading update…",
      "ready": "Update ready to install",
      "readyDescription": "Restart to apply the update",
      "restartAndInstall": "Restart & Install",
      "failed": "Update failed"
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (end of the `'has the About tab labels'` test body):

```
    expect(settings.about.autoUpdate.description).toBe(
      'Automatically download and install updates when available'
    )
  })
```

Replace with:

```
    expect(settings.about.autoUpdate.description).toBe(
      'Automatically download and install updates when available'
    )
  })

  it('has the updater panel keys for every state', () => {
    expect(settings.about.update.checkPrompt).toBe(
      'Check for the latest version'
    )
    expect(settings.about.update.checkButton).toBe('Check for Updates')
    expect(settings.about.update.checking).toBe('Checking for updates…')
    expect(settings.about.update.upToDate).toBe("You're on the latest version")
    expect(settings.about.update.checkAgain).toBe('Check again')
    expect(settings.about.update.available).toBe('Update available')
    expect(settings.about.update.availableVersion).toBe('Version {{version}}')
    expect(settings.about.update.download).toBe('Download')
    expect(settings.about.update.downloading).toBe('Downloading update…')
    expect(settings.about.update.ready).toBe('Update ready to install')
    expect(settings.about.update.readyDescription).toBe(
      'Restart to apply the update'
    )
    expect(settings.about.update.restartAndInstall).toBe('Restart & Install')
    expect(settings.about.update.failed).toBe('Update failed')
  })
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/update-panel.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the updater panel"
```

---

## Task 8: Final verification, isolated committed-tree check, plan doc commit

**Files:** none new — verification only, plus committing this plan document.

- [ ] **Step 1: Commit the plan document itself**

```bash
git add docs/superpowers/plans/2026-09-17-i18n-phase-2-settings-core.md
git commit -m "docs(i18n): Phase 2 settings-core implementation plan"
```

- [ ] **Step 2: Full gate on the live workspace**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass. If `pnpm test` fails only on the two standing,
already-documented `--no-verify` exceptions in CLAUDE.md's pre-commit-gate
bullet, verify that's really the cause (per CLAUDE.md's own instruction:
check `test-ids.linkage.test.ts`'s failure output and `git status`/`grep`
yourself) before treating it as pre-existing and unrelated to this plan.

- [ ] **Step 3: Isolated committed-tree check**

```bash
rm -rf /tmp/settings-core-verify
git archive HEAD | (mkdir -p /tmp/settings-core-verify && tar -x -C /tmp/settings-core-verify)
ln -s "$(pwd)/node_modules" /tmp/settings-core-verify/node_modules
cd /tmp/settings-core-verify
pnpm exec tsc -p tsconfig.web.json --noEmit
pnpm exec tsc -p tsconfig.node.json --noEmit
cd -
```

Expected: both exit 0. This is the check that caught `chat-core`'s
Critical finding (a committed tree silently missing files that only
existed in the live workspace) — run it before, not after, requesting
final review.

- [ ] **Step 4: Dispatch final review**

Dispatch a final whole-branch code review on the most capable available
model, covering every commit this plan produced
(`git log --oneline <task-1-base>..HEAD`). Point it at:

- This plan document, as the spec of record.
- The same failure classes that bit earlier i18n sub-plans: wrong
  `ns:key` separator or missing namespace prefix, catalog/key desync
  (a `t()` call referencing a key that doesn't exist, or a catalog key
  nothing calls), a `ParseKeys`-typed field whose value doesn't
  type-check without noticing (would already be a compile error, but
  confirm no one added an `as never`/`any` cast to route around it),
  and ambient-bundling of unrelated concurrent work into a commit
  (`use-keyboard-shortcuts.ts` is the one file in this plan where that
  risk is real — confirm Task 5's commit touched only the anchored
  substrings this plan specified, not the neighboring concurrent hunks).
- Confirm the `SettingsLabel` architectural fix is complete: no remaining
  render site displays a raw `SettingsLabel`/`item.title`/`group.label`
  value as literal English text, and the sidebar search filter matches
  translated text, not the enum value.

- [ ] **Step 5: Address findings, one fix wave**

If the final review finds issues: one fix dispatch addressing all of
them, then one scoped re-review of just the fix diff. Adjudicate any
residual disagreement yourself and record the ruling.

- [ ] **Step 6: Push**

Once final review is clean, push directly to `origin/dev` (this project's
established practice — no worktree, no PR, work commits straight to
`dev`, matching every prior i18n sub-plan).

```bash
git push origin dev
```

- [ ] **Step 7: Update memory**

Update the `i18n-rollout-progress` memory file: mark `settings-core`
complete with its commit range, note the `NAV_TITLE_KEYS`/`ParseKeys`
lookup-table pattern as the established technique for any future
enum-keyed or union-keyed display text, and confirm whether
`use-keyboard-shortcuts.ts`'s concurrent diff landed (committed) by
the time this sub-plan finished — if it's still uncommitted, note that
the next `settings` sub-plan touching that file needs the same
re-check-before-touching treatment.
