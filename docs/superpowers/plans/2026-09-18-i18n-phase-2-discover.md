# i18n Phase 2 — discover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `discover` i18next namespace (currently an empty
Phase-1 scaffold, `{}`) — the third of the 8 "the rest" namespaces.
Unlike `computerUse`/`knowledgeBase`, this namespace spans TWO files: the
Discover settings tab AND the actual Discover feed panel shown on the
home page.

**Architecture:**

- `settings-form/discover.tsx` has NO existing `useTranslation` call —
  fresh single-namespace `useTranslation('discover')`.
- `home/discover-feed.tsx` already calls `useTranslation('errors')` just
  to feed `toErrorI18n(i18n)` into `getHttpErrorMessage` — becomes
  array-form `useTranslation(['errors', 'discover'])`.
- The settings tab's intro `<Alert>` is plain prose — no rich-text markup
  at all, plain `t('alert')`, same treatment as `computerUse`'s alert.
- The "needs a Brave Search API key" hint has an embedded `<button>`
  (navigates to the Built-in Tools tab via `useSettingsTab()`) — `button`
  is NOT in the `<Trans>` allowlist (`strong`/`i`/`p`/`br`), so it needs
  the full established treatment: extracted into its own exported
  `BraveKeyHint` component (taking the navigate handler as a prop, since
  the component doesn't have direct access to `useSettingsTab()`'s
  setter otherwise), with an empirically-verified numbered placeholder.
  Verified this planning session: raw children are `[text, {' '}, button,
  text]`, so `<button>` sits at index `2`. Cross-checking the render
  hit an unrelated, environment-specific Node ESM module-resolution
  quirk in the ad-hoc verification script (a duplicate-React-copy error
  traced to a stray, unrelated, empty-but-git-initialized directory one
  level up from this repo — NOT a bug in the extracted component or the
  catalog) — the children-array dump itself (via `esbuild.transform` +
  `React.Children.forEach`, no `react-dom/server` involved) completed
  successfully and is what the index below is based on; the render-based
  cross-check is deferred to this plan's own real `vitest` test (Step 5
  below), which has been reliable all session and is the authoritative
  gate regardless.
- `discover-feed.tsx`'s "Discover" `<h2>` heading, the "updated {relative
  time}" caption, the `title="Refresh"` button, and the 'Failed to
  refresh' toast all get real catalog keys. The `· {age}` separator in
  `ArticleRow` and `group.topic` (an AI-generated, dynamic topic label)
  are NOT touched — the bullet is decorative punctuation and `age`/
  `topic` are already-formatted or dynamic upstream values, not static
  UI prose.
- Every technical/identifier value stays hardcoded: the `"4"`/`"3"`
  numeric default placeholders (restating each description's own
  "Default N" text).

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/discover.json` (currently
  `{}`) — populate directly, no wrapper key.
- For the one `<Trans>` block in this plan (`braveKeyHint`): transcribe
  the JSX and catalog string EXACTLY as given in Task 1 — the `<button>`
  placeholder index (`<2>`) was empirically derived via a real compiled-
  children dump this planning session. If the JSX changes for any
  reason, re-verify with the same technique (format first via `oxfmt`,
  then dump real children via `React.Children.forEach`) before trusting
  a new number — and if the standalone verification script hits a
  module-resolution error again, don't fight it: fall back to writing
  the real `vitest` test and letting that be the verification (it has
  been reliable all session; the ad-hoc script is a convenience, not the
  actual gate).
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm both `discover.tsx` and `discover-feed.tsx` are
  still clean.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file — confirm the reported test
  count shows 100% passing with only that teardown-time
  unhandled-rejection pattern, then retry `pnpm test` once before
  reaching for `--no-verify`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Discover settings tab and home feed panel

**Files:**

- Modify: `src/renderer/components/settings/settings-form/discover.tsx`
- Modify: `src/renderer/components/home/discover-feed.tsx`
- Modify: `src/shared/i18n/locales/en/discover.json`
- Create: `tests/unit/i18n/discover-namespace.test.ts`

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`, `useTranslation('discover')`
  (settings tab) and `useTranslation(['errors', 'discover'])` (home
  feed).
- Produces: the exported `BraveKeyHint` component, consumed only by
  `discover.tsx`'s own JSX and this task's own render test.

- [ ] **Step 1: Write `discover.json`**

```json
{
  "alert": "Discover turns your saved Memory into a personalized news feed on the home page — enabling it sends your memory topics to your AI provider (to turn them into search queries) and the resulting queries to Brave (the same provider used for Web Search) roughly once a day. Off by default; nothing leaves your machine until you turn it on.",
  "enable": {
    "label": "Enable Discover",
    "description": "Show a personalized news feed on the home page."
  },
  "braveKeyHint": "Discover needs a Brave Search API key. <2>Add one under Built-in Tools</2>.",
  "topicCount": {
    "label": "Topics",
    "description": "How many memory-derived topics to show. Default 4."
  },
  "articlesPerTopic": {
    "label": "Articles per topic",
    "description": "How many articles per topic row. Default 3."
  },
  "heading": "Discover",
  "updatedAgo": "updated {{time}}",
  "refreshButton": "Refresh",
  "toast": {
    "refreshFailed": "Failed to refresh"
  }
}
```

- [ ] **Step 2: Rewrite `discover.tsx`**

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AlertCircleIcon } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsTab } from '@/hooks/use-settings-tab'

import { SettingsLabel } from '../settings-menu'
import { SettingsRow, SettingsSection } from '../settings-row'

export function BraveKeyHint({ onNavigate }: { onNavigate: () => void }) {
  return (
    <p className="text-muted-foreground -mt-1 text-xs">
      <Trans ns="discover" i18nKey="braveKeyHint">
        Discover needs a Brave Search API key.{' '}
        <button
          type="button"
          className="text-primary underline underline-offset-2"
          onClick={onNavigate}
        >
          Add one under Built-in Tools
        </button>
        .
      </Trans>
    </p>
  )
}

export function Discover({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('discover')
  const hasBraveKey = !!form.watch('webSearch.braveApiKey')
  const [, setActiveSection] = useSettingsTab()

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
            name="discover.enabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                data-testid={TEST_IDS.discover.enableToggle}
              />
            )}
          />
        </SettingsRow>

        {!hasBraveKey && (
          <BraveKeyHint
            onNavigate={() => setActiveSection(SettingsLabel.BuiltinTools)}
          />
        )}

        <Controller
          control={form.control}
          name="discover.topicCount"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('topicCount.label')}
              description={t('topicCount.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={1}
                max={8}
                className="w-20"
                placeholder="4"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="discover.articlesPerTopic"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('articlesPerTopic.label')}
              description={t('articlesPerTopic.description')}
              error={fieldState.error}
            >
              <Input
                type="number"
                min={1}
                max={5}
                className="w-20"
                placeholder="3"
                {...field}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
```

- [ ] **Step 3: Run the formatter and re-verify `BraveKeyHint`'s Trans block**

Run: `pnpm format` (or `./node_modules/.bin/oxfmt src/renderer/components/settings/settings-form/discover.tsx`)

Read the file back and confirm `BraveKeyHint`'s JSX still has `{' '}` in
exactly the one position shown above (after "API key."). If `oxfmt`
changed it, stop and re-derive the index empirically before trusting the
catalog's `<2>`.

- [ ] **Step 4: Rewrite `discover-feed.tsx`**

Change the `react-i18next` import and hook:

```tsx
const { t, i18n } = useTranslation(['errors', 'discover'])
```

Update `handleRefresh`'s toast:

```tsx
const handleRefresh = async () => {
  setRefreshing(true)
  try {
    await mutate(refreshDiscoverFeed(), { revalidate: false })
  } catch (e) {
    sileo.error({
      title: t('discover:toast.refreshFailed'),
      description: getHttpErrorMessage(e, toErrorI18n(i18n))
    })
  } finally {
    setRefreshing(false)
  }
}
```

Update the JSX heading/caption/button:

```tsx
<div className="mb-3 flex items-center justify-between">
  <div className="flex items-baseline gap-2.5">
    <h2 className="text-2xl font-bold tracking-tight">
      {t('discover:heading')}
    </h2>
    {updatedAgo && (
      <span className="text-muted-foreground text-xs">
        {t('discover:updatedAgo', { time: updatedAgo })}
      </span>
    )}
  </div>
  <Button
    variant="ghost"
    size="icon"
    disabled={isBusy}
    onClick={handleRefresh}
    title={t('discover:refreshButton')}
  >
    <RefreshCwIcon className={cn('size-4', isBusy && 'animate-spin')} />
  </Button>
</div>
```

Everything else in the file (`articleAge`, `DiscoverThumb`, `ArticleRow`,
`TopicSection`, the `useEffect`s, `handleRefresh`'s try/finally shape,
the early-return guard) stays exactly as-is.

- [ ] **Step 5: Create the namespace test file (this is the authoritative
      Trans verification — see the module-resolution note in Architecture
      above)**

Create `tests/unit/i18n/discover-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const discover = JSON.parse(
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
      'discover.json'
    ),
    'utf8'
  )
)

describe('discover namespace (en)', () => {
  it('has the alert and enable toggle keys', () => {
    expect(discover.alert).toContain(
      'Discover turns your saved Memory into a personalized news feed'
    )
    expect(discover.enable).toMatchObject({
      label: 'Enable Discover',
      description: 'Show a personalized news feed on the home page.'
    })
  })

  it('has the topicCount and articlesPerTopic keys', () => {
    expect(discover.topicCount.description).toBe(
      'How many memory-derived topics to show. Default 4.'
    )
    expect(discover.articlesPerTopic.description).toBe(
      'How many articles per topic row. Default 3.'
    )
  })

  it('has the feed panel keys', () => {
    expect(discover.heading).toBe('Discover')
    expect(discover.updatedAgo).toBe('updated {{time}}')
    expect(discover.refreshButton).toBe('Refresh')
    expect(discover.toast.refreshFailed).toBe('Failed to refresh')
  })
})

describe('discover namespace braveKeyHint renders correctly via Trans', () => {
  it('braveKeyHint — <button> at index 2, correct position', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { BraveKeyHint } =
      await import('@/components/settings/settings-form/discover')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { discover } },
      ns: ['discover'],
      defaultNS: 'discover',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(BraveKeyHint, { onNavigate: () => {} })
      )
    )
    expect(html).toBe(
      '<p class="text-muted-foreground -mt-1 text-xs">Discover needs a Brave Search API key. <button type="button" class="text-primary underline underline-offset-2">Add one under Built-in Tools</button>.</p>'
    )
  })
})
```

This test is the REAL verification for the `<2>` index (per the
Architecture note above, the standalone planning-time script hit an
unrelated environment issue rendering via `react-dom/server` directly —
this real `vitest` test is what actually gates the commit, and if the
index is wrong, this test's exact-string assertion will fail with a
visibly garbled/dropped `<button>` in the diff).

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires). **Pay special attention to the new
`braveKeyHint` render test** — if it fails, do not force the assertion
to match a wrong index; re-derive the index empirically instead.

```bash
git add src/renderer/components/settings/settings-form/discover.tsx \
  src/renderer/components/home/discover-feed.tsx \
  src/shared/i18n/locales/en/discover.json \
  tests/unit/i18n/discover-namespace.test.ts
git commit -m "i18n: populate discover namespace from the settings tab and home feed"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-discover.md
git commit -m "docs: add discover i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
