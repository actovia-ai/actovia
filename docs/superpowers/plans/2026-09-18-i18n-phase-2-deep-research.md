# i18n Phase 2 — deepResearch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `deepResearch` i18next namespace (currently an
empty Phase-1 scaffold, `{}`) — the fourth of the 8 "the rest"
namespaces. Spans FOUR files: the settings tab, and the three files
making up the Deep Research process panel (the chat-bubble card,
`calling-tools/deep-research/deep-research-card.tsx`, was ALREADY
translated under `chat`'s `chat-tool-cards` sub-plan and is NOT touched
here).

**Architecture:**

- None of the four files has an existing `useTranslation` call — each
  gets a fresh, single-namespace `useTranslation('deepResearch')`.
- No `<Trans>`/rich-text markup anywhere in this plan — every string is
  plain prose or a simple interpolated template, so this is a
  lower-risk plan than most recent ones (no numbered-placeholder
  derivation needed at all).
- `index.tsx`'s `{allWebSearchResults.length} Sources` tab label is
  ALWAYS plural in the current code regardless of count (a real, minor
  pre-existing grammar bug — "1 Sources" would render at count 1) — this
  pass fixes it for free via real i18next pluralization (`_one`/
  `_other` + `{{count}}`), the same "extraction is the last cheap moment
  to fix a copy/grammar bug" lesson from `knowledgeBase`.
- `message-item.tsx` has FOUR count-or-query-interpolated template
  literals, three of which need real pluralization (`learnings`,
  `queriesDeeper`, `queriesForTopic`) and one of which needs only
  `{{query}}` interpolation with no count (`searchedFor`). The quoted
  topic string (`"${payload.query}"`) keeps its literal quote marks
  inside the catalog string (`\"{{query}}\"`), matching the
  `mcpServers.toast.updated`-style quoted-interpolation precedent.
- Every dynamic/upstream value stays untouched: `payload.query`,
  `item.title`/`item.link`/`item.snippet`, `hostname`, individual
  `learning`/`query` list items, and `finalReport` — none of these are
  static UI prose.
- `deep-research.tsx`'s `"4"`/`"2"` numeric default placeholders
  (restating each description's own "Default: N" text) stay hardcoded,
  per the established technical-value convention. The `id=
  "deep-research-breadth-input"`/`"deep-research-depth-input"` DOM ids
  and `autoFocus` are untouched (not user-facing text).

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/deepResearch.json`
  (currently `{}`) — populate directly, no wrapper key.
- Real, single-count values get real i18next pluralization
  (`_one`/`_other` + `{{count}}`) — never a hand-rolled template that's
  always singular or always plural. Applies to `tabs.sources`,
  `messages.learnings`, `messages.queriesDeeper`,
  `messages.queriesForTopic`.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm all four files are still clean.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file — confirm the reported test
  count shows 100% passing with only that teardown-time
  unhandled-rejection pattern, then retry `pnpm test` once before
  reaching for `--no-verify`. If `pnpm test` instead shows "Invalid hook
  call"/"Cannot read properties of null (reading 'useMemo'/etc.)" with a
  stack frame pointing outside this repo (e.g. containing `../actovia/`),
  that is NOT a defect in this plan's code — check
  `ls -la node_modules/node_modules` first; if a stray symlink exists
  there, remove it (`rm node_modules/node_modules`) and retest. See
  memory `stray-node-modules-symlink-incident` for the full incident
  this recurrence check is based on.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Deep Research settings tab and process panel

**Files:**

- Modify: `src/renderer/components/settings/settings-form/deep-research.tsx`
- Modify: `src/renderer/components/deep-research/index.tsx`
- Modify: `src/renderer/components/deep-research/message-item.tsx`
- Modify: `src/renderer/components/deep-research/source-item.tsx`
- Modify: `src/shared/i18n/locales/en/deepResearch.json`
- Create: `tests/unit/i18n/deepResearch-namespace.test.ts`

**Interfaces:**

- Consumes: `t` from `react-i18next`, `useTranslation('deepResearch')` in
  all four components.
- Produces: nothing consumed elsewhere — these four files are this
  namespace's whole current scope.

- [ ] **Step 1: Write `deepResearch.json`**

```json
{
  "form": {
    "breadth": {
      "label": "Breadth",
      "description": "Generate multiple search queries to explore different aspects of your topic at each level. Default: 4."
    },
    "depth": {
      "label": "Depth",
      "description": "Recursively dive deeper, following leads and uncovering connections for each branch. Default: 2."
    }
  },
  "tabs": {
    "activity": "Activity",
    "sources_one": "{{count}} Source",
    "sources_other": "{{count}} Sources"
  },
  "messages": {
    "start": {
      "title": "Start deep researching...",
      "description": "The deep research process may take a while. Feel free to chat with Actovia in other conversations. Actovia will notify you as soon as the final report is ready."
    },
    "learnings_one": "Deep researched {{count}} item from the previous web resources",
    "learnings_other": "Deep researched {{count}} items from the previous web resources",
    "queriesDeeper_one": "Generated {{count}} search query for the previous researches",
    "queriesDeeper_other": "Generated {{count}} search queries for the previous researches",
    "queriesForTopic_one": "Generated {{count}} search query for \"{{query}}\"",
    "queriesForTopic_other": "Generated {{count}} search queries for \"{{query}}\"",
    "searchedFor": "Searched for \"{{query}}\"",
    "writingReport": {
      "title": "Start writing final report...",
      "description": "The deep research phase is completed. Your final report is being generated and will be presented shortly."
    },
    "complete": {
      "title": "Completed deep research",
      "description": "The in-depth report for \"{{query}}\" has been fully generated. Hope it's helpful to you!"
    }
  },
  "sources": {
    "citations": "Citations",
    "more": "More"
  }
}
```

- [ ] **Step 2: Rewrite `deep-research.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'

export function DeepResearch({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('deepResearch')
  return (
    <SettingsSection>
      <Controller
        control={form.control}
        name="deepResearch.breadth"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('form.breadth.label')}
            description={t('form.breadth.description')}
            error={fieldState.error}
          >
            <Input
              placeholder="4"
              type="number"
              id="deep-research-breadth-input"
              autoFocus
              {...field}
              value={field.value ?? ''}
              className="w-fit"
            />
          </SettingsRow>
        )}
      />
      <Controller
        control={form.control}
        name="deepResearch.depth"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('form.depth.label')}
            description={t('form.depth.description')}
            error={fieldState.error}
          >
            <Input
              placeholder="2"
              type="number"
              id="deep-research-depth-input"
              {...field}
              value={field.value ?? ''}
              className="w-fit"
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
```

- [ ] **Step 3: Rewrite `index.tsx`'s tab labels**

Add the import and hook:

```tsx
import { useTranslation } from 'react-i18next'
```

```tsx
export function DeepResearchProcess() {
  const { t } = useTranslation('deepResearch')
  const ref = useRef<HTMLDivElement | null>(null)
```

Update the two tab buttons:

```tsx
            <Button
              variant="ghost"
              className={cn(
                'min-w-20 rounded-full p-2 select-none',
                tab === Tab.Activity
                  ? 'bg-background hover:bg-background dark:bg-background-foreground hover:dark:bg-background-foreground font-semibold shadow-sm'
                  : 'bg-transparent'
              )}
              onClick={() => setTab(Tab.Activity)}
            >
              {t('tabs.activity')}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                'min-w-20 rounded-full p-2 select-none',
                tab === Tab.Source
                  ? 'bg-background hover:bg-background dark:bg-background-foreground hover:dark:bg-background-foreground font-semibold shadow-sm'
                  : 'bg-transparent'
              )}
              onClick={() => setTab(Tab.Source)}
            >
              {t('tabs.sources', { count: allWebSearchResults.length })}
            </Button>
```

Everything else in the file (the SSE wiring, the `useEffect`s, `enum
Tab`, `allWebSearchResults`) stays exactly as-is.

- [ ] **Step 4: Rewrite `message-item.tsx`**

Add the import and hook:

```tsx
import { useTranslation } from 'react-i18next'
```

```tsx
export function MessageItem({
  deepResearchMessage
}: {
  deepResearchMessage: DeepResearchMessage
}) {
  const { t } = useTranslation('deepResearch')
  const payload = (
```

Update each message block's text:

```tsx
{
  payload.type === DeepResearchProgress.StartDeepResearch && (
    <div className="flex gap-2">
      <BotIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {t('messages.start.title')}
        <div className="m-0! text-sm">{t('messages.start.description')}</div>
      </div>
    </div>
  )
}

{
  payload.type === DeepResearchProgress.EmitLearnings && (
    <div className="flex gap-2">
      <BotIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {t('messages.learnings', {
          count: payload.learnings?.length ?? 0
        })}
        <ul className="m-0! text-sm">
          {payload.learnings?.map((item) => (
            <li key={item.learning} className="last:mb-0">
              {item.learning}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

{
  payload.type === DeepResearchProgress.EmitSearchQueries && (
    <div className="flex gap-2">
      <BotIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {payload.deeper
          ? t('messages.queriesDeeper', {
              count: payload.searchQueries?.length ?? 0
            })
          : t('messages.queriesForTopic', {
              count: payload.searchQueries?.length ?? 0,
              query: payload.query
            })}
        <ul className="m-0! text-sm">
          {payload.searchQueries?.map((item) => (
            <li key={item.query} className="last:mb-0">
              {item.query}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

{
  payload.type === DeepResearchProgress.EmitSearchResults && (
    <div className="flex gap-2">
      <SearchIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {t('messages.searchedFor', { query: payload.query })}
        <SourceItem webSearchResults={payload.webSearchResults} />
      </div>
    </div>
  )
}

{
  payload.type === DeepResearchProgress.StartWritingFinalReport && (
    <div className="flex gap-2">
      <BotIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {t('messages.writingReport.title')}
        <div className="m-0! text-sm">
          {t('messages.writingReport.description')}
        </div>
      </div>
    </div>
  )
}

{
  payload.type === DeepResearchProgress.CompleteDeepResearch && (
    <div className="flex gap-2">
      <CheckIcon
        className="mt-px shrink-0 rounded-full border p-1"
        size={24}
        strokeWidth={2.5}
      />
      <div className="flex flex-col gap-2">
        {t('messages.complete.title')}
        <div className="m-0! text-sm">
          {t('messages.complete.description', { query: payload.query })}
        </div>
      </div>
    </div>
  )
}
```

The `payload` destructuring, the outer `<>...</>` wrapper, and every icon/
className stay exactly as-is.

- [ ] **Step 5: Rewrite `source-item.tsx`**

Add the import and hook:

```tsx
import { useTranslation } from 'react-i18next'
```

```tsx
export function SourceItem({
  webSearchResults,
  finalReport
}: {
  finalReport?: string
  webSearchResults: WebSearchResult[]
}) {
  const { t } = useTranslation('deepResearch')
  const citedRanks = useMemo(() => {
```

Update the two headings:

```tsx
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-0! ml-3 font-bold">{t('sources.citations')}</p>
      {cited.map((item) => (
        <SourceItemLink key={item.link} item={item} />
      ))}
      {more.length > 0 && (
        <>
          <Separator className="mt-3" />
          <p className="mt-3 mb-0! ml-3 font-bold">{t('sources.more')}</p>
          {more.map((item) => (
            <SourceItemLink key={item.link} item={item} />
          ))}
        </>
      )}
    </div>
  )
}
```

`SourceItemLink` and the `citedRanks`/`cited`/`more` derivations stay
exactly as-is.

- [ ] **Step 6: Create the namespace test file**

Create `tests/unit/i18n/deepResearch-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const deepResearch = JSON.parse(
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
      'deepResearch.json'
    ),
    'utf8'
  )
)

describe('deepResearch namespace (en)', () => {
  it('has the settings form keys', () => {
    expect(deepResearch.form.breadth.description).toBe(
      'Generate multiple search queries to explore different aspects of your topic at each level. Default: 4.'
    )
    expect(deepResearch.form.depth.description).toBe(
      'Recursively dive deeper, following leads and uncovering connections for each branch. Default: 2.'
    )
  })

  it('has real pluralization for the sources tab', () => {
    expect(deepResearch.tabs).toMatchObject({
      activity: 'Activity',
      sources_one: '{{count}} Source',
      sources_other: '{{count}} Sources'
    })
  })

  it('has real pluralization and query interpolation for progress messages', () => {
    expect(deepResearch.messages).toMatchObject({
      learnings_one:
        'Deep researched {{count}} item from the previous web resources',
      learnings_other:
        'Deep researched {{count}} items from the previous web resources',
      queriesDeeper_one:
        'Generated {{count}} search query for the previous researches',
      queriesDeeper_other:
        'Generated {{count}} search queries for the previous researches',
      queriesForTopic_one: 'Generated {{count}} search query for "{{query}}"',
      queriesForTopic_other:
        'Generated {{count}} search queries for "{{query}}"',
      searchedFor: 'Searched for "{{query}}"'
    })
    expect(deepResearch.messages.complete.description).toBe(
      'The in-depth report for "{{query}}" has been fully generated. Hope it\'s helpful to you!'
    )
  })

  it('has the source-list headings', () => {
    expect(deepResearch.sources).toMatchObject({
      citations: 'Citations',
      more: 'More'
    })
  })
})
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires; if you see "Invalid hook call" errors instead,
check for the stray `node_modules/node_modules` symlink first — see
Global Constraints above).

```bash
git add src/renderer/components/settings/settings-form/deep-research.tsx \
  src/renderer/components/deep-research/index.tsx \
  src/renderer/components/deep-research/message-item.tsx \
  src/renderer/components/deep-research/source-item.tsx \
  src/shared/i18n/locales/en/deepResearch.json \
  tests/unit/i18n/deepResearch-namespace.test.ts
git commit -m "i18n: populate deepResearch namespace from the settings tab and process panel"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-deep-research.md
git commit -m "docs: add deepResearch i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
