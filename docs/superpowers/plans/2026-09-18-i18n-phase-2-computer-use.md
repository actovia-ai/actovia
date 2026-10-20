# i18n Phase 2 — computerUse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `computerUse` i18next namespace (currently an empty
Phase-1 scaffold, `src/shared/i18n/locales/en/computerUse.json` = `{}`)
with the Computer Use settings tab's strings — the first of the 8
remaining "the rest" namespaces (`philharmonic`, `discover`,
`knowledgeBase`, `deepResearch`, `computerUse`, `lock`, `webSearch`,
`audio`) per the standing Phase 2 rollout authorization.

**Why this namespace, and in this order:** surveyed all 8 remaining
namespaces' file scopes against the current (heavily concurrently-edited)
working tree before picking one. Two are confirmed or highly likely
blocked by unrelated in-flight work: `lock` (`lock-privacy.tsx` is
actively dirty, 9992c09e-era note already flagged this) and `philharmonic`
(a `tone-init.js` deletion plus other Philharmonic-adjacent files in the
dirty set, consistent with the already-approved
"Philharmonic layout consolidation" design that's presumably mid-
implementation). `discover`, `knowledgeBase`, `deepResearch` all have
clean files but a broader surface (a settings tab PLUS a separate
non-settings page/panel each — `home/discover-feed.tsx`,
`components/deep-research/` (3 files), respectively; `knowledgeBase` is
settings-only). `computerUse` has the smallest, cleanest, most contained
scope: its chat-bubble card (`calling-tools/computer-use/
computer-use-card.tsx`) was ALREADY translated under the `chat`
namespace's `chat-tool-cards` sub-plan, so only ONE file remains for this
whole namespace — `settings-form/computer-use.tsx` — and it's confirmed
clean. Picked as the lowest-risk, fastest sub-plan to unblock forward
progress; the other three ready-to-go namespaces (`discover`,
`knowledgeBase`, `deepResearch`) and the two blocked ones (`lock`,
`philharmonic`, `webSearch`/`audio` not yet surveyed) follow in
subsequent plans.

**Architecture:**

- `computer-use.tsx` has NO existing `useTranslation` call and uses no
  other namespace — single-namespace `useTranslation('computerUse')`,
  bare (unprefixed) keys throughout.
- The intro `<Alert>` is PLAIN prose — no `<strong>`/`<code>`/links, no
  `<Trans>` needed at all. It embeds a literal keyboard-shortcut glyph
  sequence (`⌥⇧⎋`, i.e. Option+Shift+Escape) mid-sentence; this stays
  embedded in the translated string as-is (keyboard-shortcut symbols are
  universal Unicode glyphs, not natural-language words, matching how
  `settings-core`'s `keyboardShortcuts` accelerator symbols were already
  treated as technical/non-prose). The JSX source also has a React-escaped
  apostrophe (`isn&apos;t`) — that's a JSX-syntax artifact only; the
  catalog string uses a plain literal `'` like any other JS string.
- The two numeric input placeholders (`"25"`, `"800"`) are default-value
  hints that exactly restate the description text's own "Default 25"/
  "Default 800" — bare numerals, not prose, so they stay hardcoded per
  the established technical-value convention (same reasoning as
  `settings-tools`' numeric defaults).
- No pluralization needed anywhere in this file (no count-driven noun).

**Tech Stack:** i18next + react-i18next (already wired). This is the
first namespace outside `common`/`errors`/`menu`/`chat`/`settings` to get
real content — `computerUse.json` currently exists as an empty `{}`
Phase-1 scaffold (confirmed via `src/shared/i18n/types.d.ts`, which
already imports and types it), and no `tests/unit/i18n/
computerUse-namespace.test.ts` exists yet — this plan creates it,
mirroring the exact structure of `tests/unit/i18n/chat-namespace.test.ts`
(the smallest existing namespace test file).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/computerUse.json` (currently
  `{}`) — populate it directly with the full flat/nested structure below,
  do not nest it under any wrapper key.
- Other locales' `computerUse.json` files stay `{}` — Phase 3's job, not
  this plan's. `pnpm i18n:check` reports missing-translation counts as
  informational only (`·` level), not failures — confirmed by reading
  `scripts/i18n-check.ts`.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.` (the working tree has substantial unrelated
  concurrent changes — re-run `git status --porcelain` before Task 1 and
  confirm `computer-use.tsx` is still clean).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is a
  flaky PGlite WASM-teardown abort under parallel test isolation — it is
  NOT scoped to one test file (observed in both
  `context-management/index.test.ts` and `jobs/worker.test.ts` on
  different runs of an otherwise fully-passing suite); confirm the
  reported test count shows 100% passing with only this teardown-time
  unhandled-rejection pattern, then retry `pnpm test` once (it's
  intermittent) before reaching for `--no-verify`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Computer Use settings tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/computer-use.tsx`
- Modify: `src/shared/i18n/locales/en/computerUse.json`
- Create: `tests/unit/i18n/computerUse-namespace.test.ts`

**Interfaces:**

- Consumes: `t` from `react-i18next`, `useTranslation('computerUse')`
  (single-namespace, bare keys).
- Produces: nothing consumed elsewhere — this is the only file in this
  namespace's current scope.

- [ ] **Step 1: Write `computerUse.json`**

```json
{
  "alert": "Computer Use lets the AI operate one window on your Mac with a virtual mouse and keyboard — it sees a screenshot each step and acts like a person. It needs a vision-capable AI model. It only touches apps you add to the allowlist below (and will open one that isn't already running), you can stop it any time with ⌥⇧⎋, and every session is logged. Off by default.",
  "enable": {
    "label": "Enable Computer Use",
    "description": "Let the AI drive an allowlisted window."
  },
  "allowlist": {
    "label": "Allowlisted apps",
    "description": "Computer Use only touches these apps. Pick from the ones installed on this Mac.",
    "searchPlaceholder": "Search installed apps…",
    "loading": "Loading apps…",
    "noAppFound": "No app found."
  },
  "maxSteps": {
    "label": "Max steps",
    "description": "Stop a session after this many actions. Default 25."
  },
  "settleDelay": {
    "label": "Settle delay (ms)",
    "description": "Wait this long after each action before the next screenshot. Default 800."
  }
}
```

- [ ] **Step 2: Rewrite `computer-use.tsx`**

Add the import and hook:

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import type { InstalledApp } from '@shared/types/computer-use'
import { AlertCircleIcon } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useInstalledApps } from '@/hooks/use-installed-apps'

import { SettingsRow, SettingsSection } from '../settings-row'
```

```tsx
export function ComputerUse({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('computerUse')
  const allowlist: string[] = form.watch('computerUse.targetAllowlist') ?? []
```

Update the JSX body:

```tsx
  return (
    <>
      <Alert className="mb-4">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertDescription className="inline">{t('alert')}</AlertDescription>
      </Alert>

      <SettingsSection>
        <SettingsRow
          label={t('enable.label')}
          description={t('enable.description')}
        >
          <Controller
            control={form.control}
            name="computerUse.enabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                data-testid={TEST_IDS.computerUse.enableToggle}
              />
            )}
          />
        </SettingsRow>

        <SettingsRow
          label={t('allowlist.label')}
          description={t('allowlist.description')}
          layout="vertical"
        >
          <Combobox
            multiple
            value={selected}
            onValueChange={(items: InstalledApp[]) =>
              form.setValue(
                'computerUse.targetAllowlist',
                items.map((i) => i.name),
                { shouldDirty: true }
              )
            }
            items={options}
            itemToStringValue={(item: InstalledApp) => item.name}
          >
            <ComboboxChips ref={chipsAnchor}>
              {selected.map((app) => (
                <ComboboxChip key={app.bundleId || app.name} className="gap-1">
                  <AppIcon app={app} className="size-3.5 rounded-[3px]" />
                  {app.name}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={
                  selected.length === 0 ? t('allowlist.searchPlaceholder') : ''
                }
                data-testid={TEST_IDS.computerUse.allowlistInput}
              />
            </ComboboxChips>
            <ComboboxContent anchor={chipsAnchor}>
              <ComboboxEmpty>
                {isLoading ? t('allowlist.loading') : t('allowlist.noAppFound')}
              </ComboboxEmpty>
              <ComboboxList>
                {(app: InstalledApp) => (
                  <ComboboxItem key={app.bundleId || app.name} value={app}>
                    <AppIcon app={app} className="size-4 rounded-[4px]" />
                    <span className="truncate">{app.name}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </SettingsRow>

        <Controller
          control={form.control}
          name="computerUse.maxSteps"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('maxSteps.label')}
              description={t('maxSteps.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={1}
                max={100}
                className="w-20"
                placeholder="25"
                {...field}
                value={field.value ?? ''}
                onChange={(e) =>
                  field.onChange(
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="computerUse.settleMs"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settleDelay.label')}
              description={t('settleDelay.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={100}
                max={5000}
                className="w-24"
                placeholder="800"
                {...field}
                value={field.value ?? ''}
                onChange={(e) =>
                  field.onChange(
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
```

`AppIcon`, the `allowlist`/`byName`/`options`/`selected`/`chipsAnchor`
derivations at the top of the component, and every prop/handler not shown
above stay exactly as-is.

- [ ] **Step 3: Create the namespace test file**

Create `tests/unit/i18n/computerUse-namespace.test.ts`, mirroring
`tests/unit/i18n/chat-namespace.test.ts`'s structure exactly:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const computerUse = JSON.parse(
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
      'computerUse.json'
    ),
    'utf8'
  )
)

describe('computerUse namespace (en)', () => {
  it('has the alert text', () => {
    expect(computerUse.alert).toContain('Computer Use lets the AI operate')
    expect(computerUse.alert).toContain('⌥⇧⎋')
  })

  it('has the enable toggle keys', () => {
    expect(computerUse.enable).toMatchObject({
      label: 'Enable Computer Use',
      description: 'Let the AI drive an allowlisted window.'
    })
  })

  it('has the allowlist keys', () => {
    expect(computerUse.allowlist).toMatchObject({
      label: 'Allowlisted apps',
      searchPlaceholder: 'Search installed apps…',
      loading: 'Loading apps…',
      noAppFound: 'No app found.'
    })
  })

  it('has the maxSteps and settleDelay keys', () => {
    expect(computerUse.maxSteps).toMatchObject({
      label: 'Max steps',
      description: 'Stop a session after this many actions. Default 25.'
    })
    expect(computerUse.settleDelay).toMatchObject({
      label: 'Settle delay (ms)',
      description:
        'Wait this long after each action before the next screenshot. Default 800.'
    })
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (or, if the known flaky PGlite teardown fires, retry
`pnpm test` once before treating it as real).

```bash
git add src/renderer/components/settings/settings-form/computer-use.tsx \
  src/shared/i18n/locales/en/computerUse.json \
  tests/unit/i18n/computerUse-namespace.test.ts
git commit -m "i18n: populate computerUse namespace from the settings tab"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-computer-use.md
git commit -m "docs: add computerUse i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
