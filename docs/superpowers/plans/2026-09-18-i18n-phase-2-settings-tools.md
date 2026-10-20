# i18n Phase 2 — settings-tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the fourth, largest slice of the `settings` namespace: the
Tools tab (the built-in-tool registry + its 3 embedded config panels —
Google Maps, Image Generation, Web Search), the Voice tab, and the Amazon
S3 tab.

**Architecture:**

- `src/shared/constants/tools.ts`'s `TOOL_REGISTRY` (12 tools) and
  `ToolGroup` union (4 groups) get the exact same treatment as
  `settings-core`'s `SHORTCUT_MAP`/`NAV_TITLE_KEYS`: this is a **shared,
  non-component data file** (can't call `useTranslation()` there), so
  `label`/`description` fields become `labelKey`/`descriptionKey` fields
  typed `ParseKeys<'settings'>`, and a new `GROUP_TITLE_KEYS` lookup table
  (`as const satisfies Record<ToolGroup, ParseKeys<'settings'>>`) replaces
  rendering the raw `ToolGroup` string as a section title. The actual
  `t()` calls happen in `tools.tsx`, the real component that renders this
  data. `ToolGroup`'s own union values stay unchanged (still used as the
  `tool.group` filter key) — only the _rendered_ group title changes.
- Every technical/identifier value across this plan's 5 leaf files stays
  hardcoded, matching the established convention (`AiProviders` enum
  values, model ids, etc., from prior sub-plans): image-generation model
  ids (`gpt-image-2`), image size/quality/format/background parameter
  values (`1024x1024`, `high`, `png`, `transparent` — literal API
  parameter values, not prose), voice STT/TTS model ids
  (`gpt-4o-transcribe`), TTS voice persona names (`Alloy`, `Nova`, …), TTS
  format codes (`MP3`, `FLAC`, …), and every placeholder that's an
  API-key-format hint or a technical example value.
- `web-search.tsx`'s `countryItems`/`languageItems` (built from
  `src/shared/constants/country-codes.ts` / `language-codes.ts`, ~200 and
  ~100+ entries respectively) are explicitly **out of scope** — localizing
  a full country/language name list is its own, much larger undertaking
  (arguably better served by `Intl.DisplayNames` than hand-authored
  catalog keys) and doesn't belong folded into a Settings-tab pass. Only
  the UI chrome _around_ those lists (row labels, placeholders, empty
  states) is in scope here.
- `voice.tsx` and `s3.tsx` each have a rich-text `<Alert>` banner using
  `<strong>`/`<code>`/`<em>` — `s3.tsx`'s in particular is long, with a
  `<ul>` of 4 `<li>` items each mixing `<strong>` and one or two `<code>`
  spans, plus one `<em>`. Every one of these 7 `<Trans>` blocks (1 in
  `voice.tsx`, 6 in `s3.tsx`) in this plan has already been **empirically
  verified** — rendered via a real `react-i18next`/`renderToStaticMarkup`
  probe script during planning — to resolve to byte-identical output to
  the original JSX, so the exact JSX/catalog text below can be transcribed
  directly with no further guessing. This surfaced a subtlety worth
  recording: **`<Trans>`'s numbered placeholders (`<N>`) index the full,
  raw children array by position — including plain-text string children,
  not just element children.** A block with `[text, <code>, text, <code>,
  text]` numbers those two `<code>` children `<1>` and `<3>` (not `<1>`
  and `<2>`) — the intervening text child still occupies its own array
  slot. `<strong>` stays a literal tag per the existing convention
  (allowlisted); `<code>`/`<em>` are NOT allowlisted and must use the
  correct positional number, verified empirically, never guessed.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json`, new `tools.*`
  top-level block, dot-nested, English source text only.
- Every file in this plan is single-namespace `useTranslation('settings')`
  — none of them currently import `useTranslation` (fresh additions).
- `ParseKeys<'settings'>`-typed fields (`ToolMeta.labelKey`/
  `descriptionKey`, `GROUP_TITLE_KEYS`) follow the `as const satisfies
  Record<...>` pattern established in `settings-core` — never a plain
  `Record<X, string>` annotation, which would widen values to `string`
  and defeat the compile-time catalog-key check.
- For every `<Trans>` block in this plan: transcribe the JSX children and
  catalog string EXACTLY as given below — both were empirically verified
  during planning via a real render probe (`react-dom/server`'s
  `renderToStaticMarkup` against a real i18next instance). Do not
  "simplify" or re-derive the numbering; if a step's JSX must change for
  any reason, re-verify with the same technique before trusting it.
- Country/language display lists (`country-codes.ts`/`language-codes.ts`
  and the arrays `web-search.tsx` builds from them) are out of scope —
  do not add catalog keys for country/language names in this plan.
- Never `git commit --amend`. `git add` scoped to the exact files each
  task names — never `-A`/`.` (shared, concurrently-edited working tree).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit — as of the end of `settings-providers`, the
  ONLY standing `--no-verify` exception is the flaky PGlite WASM teardown
  in `src/main/lib/ai/context-management/index.test.ts`. If any commit in
  this plan needs `--no-verify` for a different reason, diagnose it for
  real rather than assuming a stale exception still applies.
- Commit the plan document itself before considering this plan finished.
- Run the isolated committed-tree check (`git archive HEAD | tar -x` into
  a scratch dir, symlink `node_modules`, then
  `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false`
  and the `tsconfig.node.json` equivalent, called directly — not via
  `pnpm exec`) before requesting final review.

---

## Task 1: Tools registry — `tools.ts` + `tools.tsx`

**Files:**

- Modify: `src/shared/constants/tools.ts` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/tools.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.registry.*` and `tools.groups.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:**

- Produces: `GROUP_TITLE_KEYS: Record<ToolGroup, ParseKeys<'settings'>>`
  (from `tools.ts`) and `ToolMeta.labelKey`/`descriptionKey:
  ParseKeys<'settings'>` (replacing `label`/`description: string`) —
  consumed only by `tools.tsx` in this plan, but these are the same
  stable `key`-based identifiers other future tool-related UI could reuse.

- [ ] **Step 1: Rewrite `src/shared/constants/tools.ts`**

```ts
import type { ParseKeys } from 'i18next'

export interface ToolMeta {
  key: string
  labelKey: ParseKeys<'settings'>
  descriptionKey: ParseKeys<'settings'>
  group: ToolGroup
}

export type ToolGroup = 'Web' | 'File System' | 'AI & Data' | 'Maps'

export const TOOL_REGISTRY: ToolMeta[] = [
  // Web
  {
    key: 'weather',
    labelKey: 'tools.registry.weather.label',
    descriptionKey: 'tools.registry.weather.description',
    group: 'Web'
  },
  {
    key: 'webSearch',
    labelKey: 'tools.registry.webSearch.label',
    descriptionKey: 'tools.registry.webSearch.description',
    group: 'Web'
  },
  {
    key: 'webFetch',
    labelKey: 'tools.registry.webFetch.label',
    descriptionKey: 'tools.registry.webFetch.description',
    group: 'Web'
  },

  // File System
  {
    key: 'terminal',
    labelKey: 'tools.registry.terminal.label',
    descriptionKey: 'tools.registry.terminal.description',
    group: 'File System'
  },
  {
    key: 'readFile',
    labelKey: 'tools.registry.readFile.label',
    descriptionKey: 'tools.registry.readFile.description',
    group: 'File System'
  },
  {
    key: 'writeFile',
    labelKey: 'tools.registry.writeFile.label',
    descriptionKey: 'tools.registry.writeFile.description',
    group: 'File System'
  },
  {
    key: 'editFile',
    labelKey: 'tools.registry.editFile.label',
    descriptionKey: 'tools.registry.editFile.description',
    group: 'File System'
  },
  {
    key: 'listDirectory',
    labelKey: 'tools.registry.listDirectory.label',
    descriptionKey: 'tools.registry.listDirectory.description',
    group: 'File System'
  },
  {
    key: 'findFiles',
    labelKey: 'tools.registry.findFiles.label',
    descriptionKey: 'tools.registry.findFiles.description',
    group: 'File System'
  },
  {
    key: 'grep',
    labelKey: 'tools.registry.grep.label',
    descriptionKey: 'tools.registry.grep.description',
    group: 'File System'
  },

  // AI & Data
  {
    key: 'imageGeneration',
    labelKey: 'tools.registry.imageGeneration.label',
    descriptionKey: 'tools.registry.imageGeneration.description',
    group: 'AI & Data'
  },
  {
    key: 'searchKnowledgeBase',
    labelKey: 'tools.registry.searchKnowledgeBase.label',
    descriptionKey: 'tools.registry.searchKnowledgeBase.description',
    group: 'AI & Data'
  },

  // Maps
  {
    key: 'mapItinerary',
    labelKey: 'tools.registry.mapItinerary.label',
    descriptionKey: 'tools.registry.mapItinerary.description',
    group: 'Maps'
  }
]

export const TOOL_GROUPS: ToolGroup[] = [
  'Web',
  'File System',
  'AI & Data',
  'Maps'
]

/**
 * i18n key for each group's section title, keyed by `ToolGroup` the same
 * way `settings-menu.ts`'s `NAV_TITLE_KEYS` keys off `SettingsLabel` —
 * `as const satisfies Record<...>` keeps each value's exact literal key
 * type so `t(GROUP_TITLE_KEYS[group])` type-checks with no cast.
 */
export const GROUP_TITLE_KEYS = {
  Web: 'tools.groups.web',
  'File System': 'tools.groups.fileSystem',
  'AI & Data': 'tools.groups.aiData',
  Maps: 'tools.groups.maps'
} as const satisfies Record<ToolGroup, ParseKeys<'settings'>>
```

- [ ] **Step 2: Rewrite `tools.tsx`**

```tsx
import {
  GROUP_TITLE_KEYS,
  TOOL_GROUPS,
  TOOL_REGISTRY,
  ToolGroup
} from '@shared/constants/tools'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import type { ParseKeys } from 'i18next'
import { ChevronRightIcon } from 'lucide-react'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'

import { SettingsSection } from '../settings-row'
import { GoogleMaps } from './google-maps'
import { ImageGeneration } from './image-generation'
import { WebSearch } from './web-search'

/** Tools whose config panel expands inline under their row. */
const TOOL_CONFIG: Record<
  string,
  (props: { form: UseFormReturnType }) => React.ReactNode
> = {
  webSearch: WebSearch,
  imageGeneration: ImageGeneration,
  mapItinerary: GoogleMaps
}

function ToolRow({
  toolKey,
  labelKey,
  descriptionKey,
  enabled,
  onToggle,
  form
}: {
  toolKey: string
  labelKey: ParseKeys<'settings'>
  descriptionKey: ParseKeys<'settings'>
  enabled: boolean
  onToggle: (enabled: boolean) => void
  form: UseFormReturnType
}) {
  const { t } = useTranslation('settings')
  const Config = TOOL_CONFIG[toolKey]

  if (!Config) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t(labelKey)}</div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t(descriptionKey)}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
      </div>
    )
  }

  return (
    <Collapsible defaultOpen>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CollapsibleTrigger className="group/ct -ml-1 flex items-center gap-1 rounded text-left">
            <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-data-panel-open/ct:rotate-90" />
            <span className="text-sm font-medium">{t(labelKey)}</span>
          </CollapsibleTrigger>
          <p className="text-muted-foreground mt-0.5 pl-[18px] text-sm">
            {t(descriptionKey)}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
      </div>
      <CollapsibleContent>
        <div className="bg-muted/50 mt-3 rounded-xl px-3.5 py-3.5">
          <Config form={form} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function Tools({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const disabledTools: string[] =
    useWatch({ control: form.control, name: 'tools.disabledTools' }) ?? []

  function toggle(key: string, enabled: boolean) {
    const current: string[] =
      (form.getValues('tools.disabledTools') as string[] | null) ?? []
    const next = enabled
      ? current.filter((k) => k !== key)
      : [...current.filter((k) => k !== key), key]
    form.setValue('tools.disabledTools', next, { shouldDirty: true })
  }

  const grouped = TOOL_GROUPS.map((group) => ({
    group,
    tools: TOOL_REGISTRY.filter((t) => t.group === group)
  })) satisfies { group: ToolGroup; tools: typeof TOOL_REGISTRY }[]

  return (
    <div className="flex flex-col gap-6">
      {grouped.map(({ group, tools }) => (
        <SettingsSection key={group} title={t(GROUP_TITLE_KEYS[group])}>
          {tools.map((tool) => (
            <ToolRow
              key={tool.key}
              toolKey={tool.key}
              labelKey={tool.labelKey}
              descriptionKey={tool.descriptionKey}
              enabled={!disabledTools.includes(tool.key)}
              onToggle={(checked) => toggle(tool.key, checked)}
              form={form}
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  )
}
```

Note: `TOOL_REGISTRY.filter((t) => t.group === group)` inside `grouped`
shadows the outer `t` (translation function) with the array's loop
variable — pre-existing in this file, and safe for the exact same reason
as `providers-tabs.tsx`'s analogous case from the prior sub-plan: this
particular callback never calls the translation function, only compares
`t.group`. Leave it exactly as shown; do not add a `t('...')` call inside
this specific `.filter()` callback without first renaming its parameter.

- [ ] **Step 3: Add `tools.registry.*` and `tools.groups.*` to `settings.json`**

Find (the end of the file, `providers.model`'s closing):

```
      "fetchErrorTitle": "Could not fetch model list",
      "fetchErrorFallback": "Failed to fetch model list"
    }
  }
}
```

Replace with:

```
      "fetchErrorTitle": "Could not fetch model list",
      "fetchErrorFallback": "Failed to fetch model list"
    }
  },
  "tools": {
    "groups": {
      "web": "Web",
      "fileSystem": "File System",
      "aiData": "AI & Data",
      "maps": "Maps"
    },
    "registry": {
      "weather": {
        "label": "Weather",
        "description": "Look up current weather and forecasts by location"
      },
      "webSearch": {
        "label": "Web Search",
        "description": "Search the web via Brave Search API (requires API key)"
      },
      "webFetch": {
        "label": "Web Fetch",
        "description": "Fetch the content of a URL (docs, APIs, GitHub files)"
      },
      "terminal": {
        "label": "Terminal",
        "description": "Execute shell commands on your machine"
      },
      "readFile": {
        "label": "Read File",
        "description": "Read file contents by path"
      },
      "writeFile": {
        "label": "Write File",
        "description": "Create or overwrite files"
      },
      "editFile": {
        "label": "Edit File",
        "description": "Targeted string replacement in existing files"
      },
      "listDirectory": {
        "label": "List Directory",
        "description": "List files and folders in a directory"
      },
      "findFiles": {
        "label": "Find Files",
        "description": "Search for files by glob pattern"
      },
      "grep": {
        "label": "Grep",
        "description": "Search file contents by regex pattern"
      },
      "imageGeneration": {
        "label": "Image Generation",
        "description": "Generate images via DALL-E (requires OpenAI API key)"
      },
      "searchKnowledgeBase": {
        "label": "Knowledge Base",
        "description": "Retrieve context from your knowledge base (requires a configured LightRAG URL)"
      },
      "mapItinerary": {
        "label": "Map Itinerary",
        "description": "Render places, routes, and multi-day trips on a single interactive map card"
      }
    }
  }
}
```

- [ ] **Step 4: Add a test**

Find (the end of `tests/unit/i18n/settings-namespace.test.ts`'s last test body):

```
    expect(settings.providers.model.fetchErrorFallback).toBe(
      'Failed to fetch model list'
    )
  })
})
```

Replace with:

```
    expect(settings.providers.model.fetchErrorFallback).toBe(
      'Failed to fetch model list'
    )
  })

  it('has the tools registry and group-title keys', () => {
    expect(settings.tools.groups).toMatchObject({
      web: 'Web',
      fileSystem: 'File System',
      aiData: 'AI & Data',
      maps: 'Maps'
    })
    expect(settings.tools.registry.weather).toMatchObject({
      label: 'Weather',
      description: 'Look up current weather and forecasts by location'
    })
    expect(settings.tools.registry.webSearch).toMatchObject({
      label: 'Web Search',
      description: 'Search the web via Brave Search API (requires API key)'
    })
    expect(settings.tools.registry.webFetch).toMatchObject({
      label: 'Web Fetch',
      description: 'Fetch the content of a URL (docs, APIs, GitHub files)'
    })
    expect(settings.tools.registry.terminal).toMatchObject({
      label: 'Terminal',
      description: 'Execute shell commands on your machine'
    })
    expect(settings.tools.registry.readFile).toMatchObject({
      label: 'Read File',
      description: 'Read file contents by path'
    })
    expect(settings.tools.registry.writeFile).toMatchObject({
      label: 'Write File',
      description: 'Create or overwrite files'
    })
    expect(settings.tools.registry.editFile).toMatchObject({
      label: 'Edit File',
      description: 'Targeted string replacement in existing files'
    })
    expect(settings.tools.registry.listDirectory).toMatchObject({
      label: 'List Directory',
      description: 'List files and folders in a directory'
    })
    expect(settings.tools.registry.findFiles).toMatchObject({
      label: 'Find Files',
      description: 'Search for files by glob pattern'
    })
    expect(settings.tools.registry.grep).toMatchObject({
      label: 'Grep',
      description: 'Search file contents by regex pattern'
    })
    expect(settings.tools.registry.imageGeneration).toMatchObject({
      label: 'Image Generation',
      description: 'Generate images via DALL-E (requires OpenAI API key)'
    })
    expect(settings.tools.registry.searchKnowledgeBase).toMatchObject({
      label: 'Knowledge Base',
      description:
        'Retrieve context from your knowledge base (requires a configured LightRAG URL)'
    })
    expect(settings.tools.registry.mapItinerary).toMatchObject({
      label: 'Map Itinerary',
      description:
        'Render places, routes, and multi-day trips on a single interactive map card'
    })
  })
})
```

- [ ] **Step 5: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

`pnpm typecheck` validates the `satisfies Record<ToolGroup, ParseKeys<'settings'>>` clause and every `ToolMeta` entry's `labelKey`/`descriptionKey` against the real catalog.

- [ ] **Step 6: Commit**

```bash
git add src/shared/constants/tools.ts \
  src/renderer/components/settings/settings-form/tools.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the tools registry and Tools tab chrome"
```

---

## Task 2: Google Maps panel

**Files:**

- Modify: `src/renderer/components/settings/settings-form/google-maps.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.googleMaps.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Independent of Task 1.

- [ ] **Step 1: Rewrite `google-maps.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'

export function GoogleMaps({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection plain>
      <Controller
        control={form.control}
        name="googleCloud.googleApiKey"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.googleMaps.apiKey.label')}
            description={t('tools.googleMaps.apiKey.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <Input
              placeholder={t('tools.googleMaps.apiKey.placeholder')}
              type="password"
              autoComplete="current-password"
              id="google-search-api-key-input"
              {...field}
              value={field.value ?? ''}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
```

- [ ] **Step 2: Add `tools.googleMaps.*` to `settings.json`**

Find (the `tools.registry.mapItinerary` block Task 1 added, closing the file):

```
      "mapItinerary": {
        "label": "Map Itinerary",
        "description": "Render places, routes, and multi-day trips on a single interactive map card"
      }
    }
  }
}
```

Replace with:

```
      "mapItinerary": {
        "label": "Map Itinerary",
        "description": "Render places, routes, and multi-day trips on a single interactive map card"
      }
    },
    "googleMaps": {
      "apiKey": {
        "label": "Google API Key",
        "description": "Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.",
        "placeholder": "Enter your Google API key"
      }
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the tools registry and group-title keys'` test body):

```
    expect(settings.tools.registry.mapItinerary).toMatchObject({
      label: 'Map Itinerary',
      description:
        'Render places, routes, and multi-day trips on a single interactive map card'
    })
  })
})
```

Replace with:

```
    expect(settings.tools.registry.mapItinerary).toMatchObject({
      label: 'Map Itinerary',
      description:
        'Render places, routes, and multi-day trips on a single interactive map card'
    })
  })

  it('has the Google Maps tool-config panel keys', () => {
    expect(settings.tools.googleMaps.apiKey).toMatchObject({
      label: 'Google API Key',
      description:
        'Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.',
      placeholder: 'Enter your Google API key'
    })
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/google-maps.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Google Maps tool-config panel"
```

---

## Task 3: Image Generation panel

**Files:**

- Modify: `src/renderer/components/settings/settings-form/image-generation.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.imageGeneration.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Independent of Tasks 1-2. Model ids (`gpt-image-2`, etc.)
and every size/quality/format/background parameter value stay hardcoded
— they're literal values sent to the OpenAI API, not prose.

- [ ] **Step 1: Rewrite `image-generation.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { useEffect, useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type ModelParamValues = {
  [index: string]: {
    sizes: string[]
    qualities: string[]
    outputFormats?: string[]
    generatedCounts: { min: number; max: number }
    backgrounds?: string[]
  }
}

const gptImageParams = {
  sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
  qualities: ['high', 'medium', 'low', 'auto'],
  outputFormats: ['png', 'jpeg', 'webp'],
  generatedCounts: { min: 1, max: 10 },
  backgrounds: ['transparent', 'opaque', 'auto']
}

const modelParams: ModelParamValues = {
  'gpt-image-2': gptImageParams,
  'gpt-image-1.5': gptImageParams,
  'gpt-image-1-mini': gptImageParams
}

export function ImageGeneration({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const background = form.watch('image.background')
  const model = form.watch('image.model')
  const paramsOfModel = useMemo(
    () => (model ? modelParams[model] : null),
    [model]
  )

  useEffect(() => {
    form.setValue('image.size', 'auto')
    form.setValue('image.quality', 'auto')
    form.setValue('image.outputFormat', '')
    form.setValue('image.background', '')
    form.setValue('image.generatedCounts', 1)
  }, [form, model])

  useEffect(() => {
    if (model?.startsWith('gpt-image-')) {
      if (background === 'transparent') {
        form.setValue('image.outputFormat', 'png')
      }
    }
  }, [background, form, model])

  return (
    <SettingsSection plain>
      <Controller
        control={form.control}
        name="image.model"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.imageGeneration.model.label')}
            description={t('tools.imageGeneration.model.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? ''}
              onValueChange={field.onChange}
              placeholder={t('tools.imageGeneration.model.placeholder')}
              options={[
                { value: 'gpt-image-2', label: 'gpt-image-2' },
                { value: 'gpt-image-1.5', label: 'gpt-image-1.5' },
                { value: 'gpt-image-1-mini', label: 'gpt-image-1-mini' }
              ]}
            />
          </SettingsRow>
        )}
      />

      {paramsOfModel?.sizes ? (
        <Controller
          control={form.control}
          name="image.size"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.size.label')}
              description={t('tools.imageGeneration.size.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel.sizes[0]}
                options={paramsOfModel.sizes.map((size) => ({
                  value: size,
                  label: size
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.qualities ? (
        <Controller
          control={form.control}
          name="image.quality"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.quality.label')}
              description={t('tools.imageGeneration.quality.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel.qualities[0]}
                options={paramsOfModel.qualities.map((quality) => ({
                  value: quality,
                  label: quality
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.outputFormats ? (
        <Controller
          control={form.control}
          name="image.outputFormat"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.outputFormat.label')}
              description={t('tools.imageGeneration.outputFormat.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel?.outputFormats?.[0]}
                options={(paramsOfModel?.outputFormats ?? []).map((fmt) => ({
                  value: fmt,
                  label: fmt,
                  disabled: background === 'transparent' && fmt === 'jpeg'
                }))}
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.generatedCounts ? (
        <Controller
          control={form.control}
          name="image.generatedCounts"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.generatedCounts.label')}
              description={t(
                'tools.imageGeneration.generatedCounts.description'
              )}
              error={fieldState.error}
            >
              <Input
                type="number"
                id="max-steps-input"
                {...field}
                min={paramsOfModel?.generatedCounts.min}
                max={paramsOfModel?.generatedCounts.max}
                value={field.value ?? ''}
                className="w-fit"
              />
            </SettingsRow>
          )}
        />
      ) : null}

      {paramsOfModel?.backgrounds ? (
        <Controller
          control={form.control}
          name="image.background"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.imageGeneration.background.label')}
              description={t('tools.imageGeneration.background.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                placeholder={paramsOfModel?.backgrounds?.[0]}
                options={
                  paramsOfModel?.backgrounds?.map((bg) => ({
                    value: bg,
                    label: bg
                  })) ?? []
                }
              />
            </SettingsRow>
          )}
        />
      ) : null}
    </SettingsSection>
  )
}
```

- [ ] **Step 2: Add `tools.imageGeneration.*` to `settings.json`**

Find (the `tools.googleMaps` block Task 2 added, closing the file):

```
    "googleMaps": {
      "apiKey": {
        "label": "Google API Key",
        "description": "Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.",
        "placeholder": "Enter your Google API key"
      }
    }
  }
}
```

Replace with:

```
    "googleMaps": {
      "apiKey": {
        "label": "Google API Key",
        "description": "Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.",
        "placeholder": "Enter your Google API key"
      }
    },
    "imageGeneration": {
      "model": {
        "label": "Model",
        "description": "OpenAI only — uses your configured OpenAI API key.",
        "placeholder": "Select a model"
      },
      "size": {
        "label": "Size",
        "description": "The dimensions of the generated image."
      },
      "quality": {
        "label": "Quality",
        "description": "The quality level of the generated image."
      },
      "outputFormat": {
        "label": "Output Format",
        "description": "If the background is transparent, the output format should be set to either png (default) or webp."
      },
      "generatedCounts": {
        "label": "Generated Counts",
        "description": "The number of images to generate. Must be between 1 and 10."
      },
      "background": {
        "label": "Background",
        "description": "Set the background style for the generated image."
      }
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the Google Maps tool-config panel keys'` test body):

```
    expect(settings.tools.googleMaps.apiKey).toMatchObject({
      label: 'Google API Key',
      description:
        'Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.',
      placeholder: 'Enter your Google API key'
    })
  })
})
```

Replace with:

```
    expect(settings.tools.googleMaps.apiKey).toMatchObject({
      label: 'Google API Key',
      description:
        'Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.',
      placeholder: 'Enter your Google API key'
    })
  })

  it('has the Image Generation tool-config panel keys', () => {
    expect(settings.tools.imageGeneration.model).toMatchObject({
      label: 'Model',
      description: 'OpenAI only — uses your configured OpenAI API key.',
      placeholder: 'Select a model'
    })
    expect(settings.tools.imageGeneration.size).toMatchObject({
      label: 'Size',
      description: 'The dimensions of the generated image.'
    })
    expect(settings.tools.imageGeneration.quality).toMatchObject({
      label: 'Quality',
      description: 'The quality level of the generated image.'
    })
    expect(settings.tools.imageGeneration.outputFormat).toMatchObject({
      label: 'Output Format',
      description:
        'If the background is transparent, the output format should be set to either png (default) or webp.'
    })
    expect(settings.tools.imageGeneration.generatedCounts).toMatchObject({
      label: 'Generated Counts',
      description: 'The number of images to generate. Must be between 1 and 10.'
    })
    expect(settings.tools.imageGeneration.background).toMatchObject({
      label: 'Background',
      description: 'Set the background style for the generated image.'
    })
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/image-generation.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Image Generation tool-config panel"
```

---

## Task 4: Web Search panel

**Files:**

- Modify: `src/renderer/components/settings/settings-form/web-search.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.webSearch.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block)

**Interfaces:** Independent of Tasks 1-3. `RECENCY_OPTIONS` (6 items,
single-consumer) is built via `useMemo(() => [...], [t])`, the same
lighter-weight alternative to a `ParseKeys` lookup table established in
`settings-profile` for `personality.tsx`'s `BASE_STYLES`/`LEVELS`.
`countryItems`/`languageItems` (from `country-codes.ts`/`language-codes.ts`)
are untouched — out of scope per this plan's Architecture section.

- [ ] **Step 1: Rewrite `web-search.tsx`**

```tsx
import { countryCodes } from '@shared/constants/country-codes'
import { languageCodes } from '@shared/constants/language-codes'
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type OptionItem = { label: string; value: string }

const countryItems: OptionItem[] = countryCodes.map((c) => ({
  label: `${c.flag} ${c.country}`,
  value: c.countryCode
}))

const languageItems: OptionItem[] = languageCodes.map((l) => ({
  label: l.language,
  value: l.languageCode
}))

export function WebSearch({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const languageChipsAnchor = useComboboxAnchor()

  const recencyOptions = useMemo(
    () => [
      { value: 'none', label: t('tools.webSearch.recency.options.none') },
      { value: 'hour', label: t('tools.webSearch.recency.options.hour') },
      { value: 'day', label: t('tools.webSearch.recency.options.day') },
      { value: 'week', label: t('tools.webSearch.recency.options.week') },
      { value: 'month', label: t('tools.webSearch.recency.options.month') },
      { value: 'year', label: t('tools.webSearch.recency.options.year') }
    ],
    [t]
  )

  return (
    <SettingsSection plain>
      {/* API Key */}
      <Controller
        control={form.control}
        name="webSearch.braveApiKey"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.apiKey.label')}
            description={t('tools.webSearch.apiKey.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="BSA..."
              {...field}
              value={field.value ?? ''}
            />
          </SettingsRow>
        )}
      />

      {/* Country */}
      <Controller
        control={form.control}
        name="webSearch.country"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.country.label')}
            description={t('tools.webSearch.country.description')}
            error={fieldState.error}
          >
            <Combobox
              items={countryItems}
              itemToStringValue={(item) => item.label}
              value={
                field.value
                  ? (countryItems.find((c) => c.value === field.value) ?? null)
                  : null
              }
              onValueChange={(item) =>
                form.setValue('webSearch.country', item?.value ?? null)
              }
            >
              <ComboboxInput
                placeholder={t('tools.webSearch.country.placeholder')}
                showClear
                className="w-52"
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {t('tools.webSearch.country.empty')}
                </ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </SettingsRow>
        )}
      />

      {/* Languages (multi-select with chips) */}
      <Controller
        control={form.control}
        name="webSearch.languages"
        render={({ field, fieldState }) => {
          const selectedItems = (field.value ?? []).flatMap((code: string) => {
            const item = languageItems.find((l) => l.value === code)
            return item ? [item] : []
          }) as OptionItem[]
          return (
            <SettingsRow
              label={t('tools.webSearch.languages.label')}
              description={t('tools.webSearch.languages.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Combobox
                multiple
                value={selectedItems}
                onValueChange={(items) =>
                  form.setValue(
                    'webSearch.languages',
                    items.length > 0 ? items.map((i) => i.value) : null
                  )
                }
                items={languageItems}
                itemToStringValue={(item) => item.label}
              >
                <ComboboxChips ref={languageChipsAnchor}>
                  {selectedItems.map((item) => (
                    <ComboboxChip key={item.value}>{item.label}</ComboboxChip>
                  ))}
                  <ComboboxChipsInput
                    placeholder={t('tools.webSearch.languages.placeholder')}
                  />
                </ComboboxChips>
                <ComboboxContent anchor={languageChipsAnchor}>
                  <ComboboxEmpty>
                    {t('tools.webSearch.languages.empty')}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </SettingsRow>
          )
        }}
      />

      {/* Max Results */}
      <Controller
        control={form.control}
        name="webSearch.maxResults"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.maxResults.label')}
            description={t('tools.webSearch.maxResults.description')}
            error={fieldState.error}
          >
            <Input
              type="number"
              min={1}
              max={50}
              className="w-20"
              placeholder="10"
              {...field}
              value={field.value ?? ''}
              onChange={(e) => {
                const v = e.target.value
                field.onChange(v === '' ? null : Number(v))
              }}
            />
          </SettingsRow>
        )}
      />

      {/* Deep Recall */}
      <Controller
        control={form.control}
        name="webSearch.deepRecall"
        render={({ field }) => (
          <SettingsRow
            label={t('tools.webSearch.deepRecall.label')}
            description={t('tools.webSearch.deepRecall.description')}
          >
            <Switch
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
          </SettingsRow>
        )}
      />

      {/* Recency Filter */}
      <Controller
        control={form.control}
        name="webSearch.recencyFilter"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.recency.label')}
            description={t('tools.webSearch.recency.description')}
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? 'none'}
              onValueChange={(val) =>
                form.setValue(
                  'webSearch.recencyFilter',
                  val === 'none'
                    ? null
                    : (val as 'hour' | 'day' | 'week' | 'month' | 'year')
                )
              }
              options={recencyOptions}
              placeholder={t('tools.webSearch.recency.options.none')}
            />
          </SettingsRow>
        )}
      />

      {/* Domain Filter */}
      <Controller
        control={form.control}
        name="webSearch.domainFilter"
        render={({ field, fieldState }) => (
          <SettingsRow
            label={t('tools.webSearch.domainFilter.label')}
            description={t('tools.webSearch.domainFilter.description')}
            error={fieldState.error}
            layout="vertical"
          >
            <Input
              placeholder="e.g. nature.com, .edu, -reddit.com"
              {...field}
              value={field.value ?? ''}
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
```

- [ ] **Step 2: Add `tools.webSearch.*` to `settings.json`**

Find (the `tools.imageGeneration` block Task 3 added, closing the file):

```
      "background": {
        "label": "Background",
        "description": "Set the background style for the generated image."
      }
    }
  }
}
```

Replace with:

```
      "background": {
        "label": "Background",
        "description": "Set the background style for the generated image."
      }
    },
    "webSearch": {
      "apiKey": {
        "label": "Brave Search API Key",
        "description": "Required for web search. Get yours at api-dashboard.search.brave.com"
      },
      "country": {
        "label": "Country",
        "description": "Bias results toward a specific region",
        "placeholder": "Select country...",
        "empty": "No country found."
      },
      "languages": {
        "label": "Languages",
        "description": "Filter search results by language",
        "placeholder": "Search languages...",
        "empty": "No language found."
      },
      "maxResults": {
        "label": "Max Results",
        "description": "Number of search results per query (1-50). Default: 10."
      },
      "deepRecall": {
        "label": "Deep recall",
        "description": "Run a second, broader web search alongside the grounding call and merge in the extra results — forums, news, and pages the grounding filter drops. Higher recall, ~2× Brave API usage per search."
      },
      "recency": {
        "label": "Recency Filter",
        "description": "Only return results from a recent time period.",
        "options": {
          "none": "No filter",
          "hour": "Past hour",
          "day": "Past 24 hours",
          "week": "Past week",
          "month": "Past month",
          "year": "Past year"
        }
      },
      "domainFilter": {
        "label": "Domain Filter",
        "description": "Comma-separated. Prefix with - to exclude. e.g. \"nature.com, .edu\" or \"-reddit.com\""
      }
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the Image Generation tool-config panel keys'` test body):

```
    expect(settings.tools.imageGeneration.background).toMatchObject({
      label: 'Background',
      description: 'Set the background style for the generated image.'
    })
  })
})
```

Replace with:

```
    expect(settings.tools.imageGeneration.background).toMatchObject({
      label: 'Background',
      description: 'Set the background style for the generated image.'
    })
  })

  it('has the Web Search tool-config panel keys', () => {
    expect(settings.tools.webSearch.apiKey).toMatchObject({
      label: 'Brave Search API Key',
      description:
        'Required for web search. Get yours at api-dashboard.search.brave.com'
    })
    expect(settings.tools.webSearch.country).toMatchObject({
      label: 'Country',
      description: 'Bias results toward a specific region',
      placeholder: 'Select country...',
      empty: 'No country found.'
    })
    expect(settings.tools.webSearch.languages).toMatchObject({
      label: 'Languages',
      description: 'Filter search results by language',
      placeholder: 'Search languages...',
      empty: 'No language found.'
    })
    expect(settings.tools.webSearch.maxResults).toMatchObject({
      label: 'Max Results',
      description: 'Number of search results per query (1-50). Default: 10.'
    })
    expect(settings.tools.webSearch.deepRecall).toMatchObject({
      label: 'Deep recall',
      description:
        'Run a second, broader web search alongside the grounding call and merge in the extra results — forums, news, and pages the grounding filter drops. Higher recall, ~2× Brave API usage per search.'
    })
    expect(settings.tools.webSearch.recency.label).toBe('Recency Filter')
    expect(settings.tools.webSearch.recency.description).toBe(
      'Only return results from a recent time period.'
    )
    expect(settings.tools.webSearch.recency.options).toMatchObject({
      none: 'No filter',
      hour: 'Past hour',
      day: 'Past 24 hours',
      week: 'Past week',
      month: 'Past month',
      year: 'Past year'
    })
    expect(settings.tools.webSearch.domainFilter).toMatchObject({
      label: 'Domain Filter',
      description:
        'Comma-separated. Prefix with - to exclude. e.g. "nature.com, .edu" or "-reddit.com"'
    })
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/web-search.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Web Search tool-config panel"
```

---

## Task 5: Voice tab

> **SUPERSEDED — structural detail only, the catalog/indices below are
> correct.** This task's alert has only one child (`<strong>`, allowlisted,
> matched by tag name, position-independent), so it was never at risk of
> the numbered-placeholder bug Task 6 hit — but per Task 6's own fix and
> its re-reviewer's explicit recommendation, this alert was ALSO later
> extracted into its own exported component (`OpenAiOnlyNotice`, not
> inlined into `Voice`'s JSX as Step 1 below shows) in a follow-up commit
> (`035e2440`), and Step 3's test was updated to import and render it
> directly instead of hand-copying its children into `createElement()`
> calls. See Task 6's own superseded-note for the full story. Read the
> current `voice.tsx`/test file directly rather than transcribing Steps
> 1/3 below if you need the exact current shape.

**Files:**

- Modify: `src/renderer/components/settings/settings-form/voice.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.voice.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a test block, incl. a real `<Trans>` render test)

**Interfaces:** Independent of Tasks 1-4. `STT_MODELS`/`TTS_MODELS` (model
ids), `TTS_VOICES` (OpenAI's own voice-persona proper nouns: Alloy, Ash,
Ballad, …), and `TTS_FORMATS` (codec names: MP3, Opus, AAC, FLAC, WAV,
PCM) all stay hardcoded — technical/proper-noun values, not prose.

- [ ] **Step 1: Rewrite `voice.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AlertCircleIcon } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

const STT_MODELS = [
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
  {
    value: 'gpt-4o-transcribe-diarize',
    label: 'gpt-4o-transcribe-diarize'
  },
  { value: 'whisper-1', label: 'whisper-1' }
]

const TTS_MODELS = [
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
  { value: 'tts-1', label: 'tts-1' },
  { value: 'tts-1-hd', label: 'tts-1-hd' }
]

const TTS_VOICES = [
  'Alloy',
  'Ash',
  'Ballad',
  'Coral',
  'Echo',
  'Fable',
  'Onyx',
  'Nova',
  'Sage',
  'Shimmer',
  'Verse'
].map((v) => ({ value: v.toLowerCase(), label: v }))

const TTS_FORMATS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'opus', label: 'Opus' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
  { value: 'pcm', label: 'PCM' }
]

export function Voice({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const ttsModel = form.watch('voice.textToSpeechModel')

  return (
    <>
      <Alert className="mb-4">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertDescription className="inline">
          <Trans ns="settings" i18nKey="tools.voice.alert">
            The Text-to-Speech and Speech-to-Text services{' '}
            <strong>only support OpenAI</strong>. Please make sure you have
            configured the OpenAI API setting correctly before using these
            features.
          </Trans>
        </AlertDescription>
      </Alert>

      <SettingsSection>
        <Controller
          control={form.control}
          name="voice.speechToTextModel"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.speechToTextModel.label')}
              description={t('tools.voice.speechToTextModel.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={STT_MODELS}
                placeholder="gpt-4o-mini-transcribe"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechModel"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.textToSpeechModel.label')}
              description={t('tools.voice.textToSpeechModel.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_MODELS}
                placeholder="gpt-4o-mini-tts"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechVoice"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.textToSpeechVoice.label')}
              description={t('tools.voice.textToSpeechVoice.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_VOICES}
                placeholder="Alloy"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechFormat"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.outputFormat.label')}
              description={t('tools.voice.outputFormat.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_FORMATS}
                placeholder="MP3"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechSpeed"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.speed.label')}
              description={t('tools.voice.speed.description')}
              error={fieldState.error}
            >
              <Input
                placeholder="1.0"
                type="number"
                step={0.25}
                min={0.25}
                max={4.0}
                {...field}
                value={field.value ?? ''}
                className="w-20"
              />
            </SettingsRow>
          )}
        />
        {ttsModel === 'gpt-4o-mini-tts' && (
          <Controller
            control={form.control}
            name="voice.textToSpeechInstructions"
            render={({ field, fieldState }) => (
              <SettingsRow
                label={t('tools.voice.instructions.label')}
                description={t('tools.voice.instructions.description')}
                error={fieldState.error}
              >
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  placeholder={t('tools.voice.instructions.placeholder')}
                  className="min-h-16 resize-y"
                />
              </SettingsRow>
            )}
          />
        )}
      </SettingsSection>
    </>
  )
}
```

Catalog key `tools.voice.alert` (below) uses a literal `<strong>` — the
JSX above matches it exactly (verified during planning via a real render
probe): `<strong>` is in `transKeepBasicHtmlNodesFor`, so it's matched by
tag name, not position; there's only one non-text child here so there's
no numbering to get wrong.

- [ ] **Step 2: Add `tools.voice.*` to `settings.json`**

Find (the `tools.webSearch.domainFilter` block Task 4 added, closing the file):

```
      "domainFilter": {
        "label": "Domain Filter",
        "description": "Comma-separated. Prefix with - to exclude. e.g. \"nature.com, .edu\" or \"-reddit.com\""
      }
    }
  }
}
```

Replace with:

```
      "domainFilter": {
        "label": "Domain Filter",
        "description": "Comma-separated. Prefix with - to exclude. e.g. \"nature.com, .edu\" or \"-reddit.com\""
      }
    },
    "voice": {
      "alert": "The Text-to-Speech and Speech-to-Text services <strong>only support OpenAI</strong>. Please make sure you have configured the OpenAI API setting correctly before using these features.",
      "speechToTextModel": {
        "label": "Speech to Text Model",
        "description": "Transcribes audio input into text"
      },
      "textToSpeechModel": {
        "label": "Text to Speech Model",
        "description": "Generates spoken audio from text responses. gpt-4o-mini-tts supports tone/style instructions."
      },
      "textToSpeechVoice": {
        "label": "Text to Speech Voice",
        "description": "Voice persona for generated speech"
      },
      "outputFormat": {
        "label": "Output Format",
        "description": "Audio format for generated speech"
      },
      "speed": {
        "label": "Speed",
        "description": "Playback speed (0.25 – 4.0, default 1.0)"
      },
      "instructions": {
        "label": "Voice Instructions",
        "description": "Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)",
        "placeholder": "e.g. Speak in a warm, friendly tone with a slight British accent"
      }
    }
  }
}
```

- [ ] **Step 3: Add tests, including a real `<Trans>` render test**

Find (the end of the `'has the Web Search tool-config panel keys'` test body):

```
    expect(settings.tools.webSearch.domainFilter).toMatchObject({
      label: 'Domain Filter',
      description:
        'Comma-separated. Prefix with - to exclude. e.g. "nature.com, .edu" or "-reddit.com"'
    })
  })
})
```

Replace with:

```
    expect(settings.tools.webSearch.domainFilter).toMatchObject({
      label: 'Domain Filter',
      description:
        'Comma-separated. Prefix with - to exclude. e.g. "nature.com, .edu" or "-reddit.com"'
    })
  })

  it('has the Voice tab keys', () => {
    expect(settings.tools.voice.alert).toBe(
      'The Text-to-Speech and Speech-to-Text services <strong>only support OpenAI</strong>. Please make sure you have configured the OpenAI API setting correctly before using these features.'
    )
    expect(settings.tools.voice.speechToTextModel).toMatchObject({
      label: 'Speech to Text Model',
      description: 'Transcribes audio input into text'
    })
    expect(settings.tools.voice.textToSpeechModel).toMatchObject({
      label: 'Text to Speech Model',
      description:
        'Generates spoken audio from text responses. gpt-4o-mini-tts supports tone/style instructions.'
    })
    expect(settings.tools.voice.textToSpeechVoice).toMatchObject({
      label: 'Text to Speech Voice',
      description: 'Voice persona for generated speech'
    })
    expect(settings.tools.voice.outputFormat).toMatchObject({
      label: 'Output Format',
      description: 'Audio format for generated speech'
    })
    expect(settings.tools.voice.speed).toMatchObject({
      label: 'Speed',
      description: 'Playback speed (0.25 – 4.0, default 1.0)'
    })
    expect(settings.tools.voice.instructions).toMatchObject({
      label: 'Voice Instructions',
      description:
        'Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)',
      placeholder: 'e.g. Speak in a warm, friendly tone with a slight British accent'
    })
  })
})
```

Now add a SEPARATE `describe` block to the SAME test file for the
`<Trans>` render check, following the exact pattern established in
`tests/unit/i18n/chat-namespace.test.ts`'s
`composerTools.mcpDialog.description` test (real i18next instance +
`createElement` + `renderToStaticMarkup`, since this file's own glob is
`*.test.ts` and can't contain JSX). Append this after the file's closing
`})` of the `describe('settings namespace (en)', ...)` block (i.e., as a
new top-level block in the same file):

```ts
describe('settings namespace tools.voice.alert renders correctly via Trans', () => {
  it('keeps <strong>only support OpenAI</strong> literal, not a numbered placeholder', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, Trans, initReactI18next } =
      await import('react-i18next')
    const i18next = (await import('i18next')).default

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    const element = createElement(
      I18nextProvider,
      { i18n },
      createElement(
        Trans,
        { ns: 'settings', i18nKey: 'tools.voice.alert' },
        'The Text-to-Speech and Speech-to-Text services ',
        createElement('strong', null, 'only support OpenAI'),
        '. Please make sure you have configured the OpenAI API setting correctly before using these features.'
      )
    )

    const html = renderToStaticMarkup(element)
    expect(html).toBe(
      'The Text-to-Speech and Speech-to-Text services <strong>only support OpenAI</strong>. Please make sure you have configured the OpenAI API setting correctly before using these features.'
    )
  })
})
```

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/voice.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Voice settings tab"
```

---

## Task 6: Amazon S3 tab

> **SUPERSEDED — do not transcribe this task's Step 1/2/3 code verbatim.**
> This plan's own pre-verification of the S3 alert's `<Trans>` blocks was
> wrong: the empirically-checked catalog indices below (`<2>`/`<4>` for
> `cors`, `iamCredentials`, and `objectAcl`) matched the JSX as drafted
> during planning, but the pre-commit hook's `oxfmt` reflowed the actual
> committed `s3.tsx`, inserting/repositioning `{' '}` whitespace
> expressions that shifted `<Trans>`'s positional numbering — and this
> task's own Step 3 tests (a hand-copied children array) didn't catch it,
> because they verified the copy, not the real source. The bug shipped in
> commit `1fc47009` with a fully green test suite and was caught only by
> a post-commit manual render check, then fixed in `7867ef4f`.
>
> The ACTUAL correct, shipped state (verify against the real files, not
> this document, if the two ever disagree again):
>
> - `cors`: `<2>PUT</2>` / `<5>*</5>` (not `<4>`)
> - `iamCredentials`: `<2>s3:PutObject</2>` / `<5>s3:PutObjectAcl</5>` (not `<4>`)
> - `objectAcl`: `<3>public-read</3>` / `<6>...</6>` (not `<2>`/`<4>`)
> - `publicReadAccess`'s `<2>`/`<4>` below happened to already be correct.
> - Each `<Trans>` block is a separate EXPORTED component in `s3.tsx`
>   (`EncodingNotice`, `RequirementsHeading`, `PublicReadAccessNotice`,
>   `CorsNotice`, `IamCredentialsNotice`, `ObjectAclNotice`), not inlined
>   into `S3`'s JSX as Step 1 below shows — this is what actually let the
>   fix's tests catch the bug: they import and render the real component
>   (`await import('@/components/settings/settings-form/s3')`) instead of
>   hand-copying its children array into `createElement()` calls the way
>   Step 3 below does.
>
> If you ever need to redo work like this task's, don't transcribe Steps
> 1-3 below — read the current `s3.tsx`/`settings.json`/test file
> directly, and follow the exported-component-plus-real-render-test
> pattern from the start. The general indexing rule in this plan's
> Architecture section above (children arrays are indexed by full
> position including text nodes and explicit `{' '}`) is correct; only
> this task's own concrete transcription of it was wrong.

**Files:**

- Modify: `src/renderer/components/settings/settings-form/s3.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `tools.s3.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add tests, incl. 6 real `<Trans>` render tests)

**Interfaces:** Independent of Tasks 1-5. This is the plan's most
`<Trans>`-heavy file — 6 blocks, all pre-verified during planning (see
this plan's Architecture section for the general indexing rule the
verification surfaced). Placeholder values (`ap-northeast-1`, `Your S3
bucket`) are technical examples, but `"Your S3 bucket"` reads as prose —
translate it; `ap-northeast-1` is an AWS region code, stays hardcoded.

- [ ] **Step 1: Rewrite `s3.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AlertCircleIcon } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'

export function S3({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')

  return (
    <>
      <Alert className="mb-4">
        <AlertCircleIcon className="size-4" data-icon />
        <AlertDescription className="flex flex-col gap-2 text-sm">
          <p>
            <Trans ns="settings" i18nKey="tools.s3.alert.encoding">
              By default, Actovia encodes attachments as <strong>base64</strong>{' '}
              inline in the prompt. For large files or vision-heavy workflows,
              uploading to S3 and passing a URL is more efficient and reliable.
            </Trans>
          </p>
          <p>
            <Trans ns="settings" i18nKey="tools.s3.alert.requirementsHeading">
              <strong>Requirements before configuring:</strong>
            </Trans>
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>
              <Trans ns="settings" i18nKey="tools.s3.alert.publicReadAccess">
                <strong>Public read access</strong> — AWS blocks public access
                by default. You must disable "Block all public access" on the
                bucket and attach a bucket policy granting{' '}
                <code>s3:GetObject</code> to <code>*</code>, so the AI provider
                can fetch the URL without credentials.
              </Trans>
            </li>
            <li>
              <Trans ns="settings" i18nKey="tools.s3.alert.cors">
                <strong>CORS</strong> — Add a CORS rule allowing{' '}
                <code>PUT</code> from <code>*</code> (or your app origin) so
                Actovia can upload directly from the desktop.
              </Trans>
            </li>
            <li>
              <Trans ns="settings" i18nKey="tools.s3.alert.iamCredentials">
                <strong>IAM credentials</strong> — The Access Key ID / Secret
                Access Key must belong to an IAM user or role with at least{' '}
                <code>s3:PutObject</code> and <code>s3:PutObjectAcl</code>{' '}
                permissions on the configured bucket.
              </Trans>
            </li>
            <li>
              <Trans ns="settings" i18nKey="tools.s3.alert.objectAcl">
                <strong>Object ACL</strong> — Each uploaded object is set to{' '}
                <code>public-read</code>. Your bucket must not have ACLs
                disabled (i.e., Object Ownership must be set to{' '}
                <em>ACLs enabled / Bucket owner preferred</em>).
              </Trans>
            </li>
          </ul>
        </AlertDescription>
      </Alert>
      <SettingsSection>
        <Controller
          control={form.control}
          name="s3.region"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.region.label')}
              description={t('tools.s3.region.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="input"
                id="s3-region-input"
                placeholder="ap-northeast-1"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.bucket"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.bucket.label')}
              description={t('tools.s3.bucket.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="input"
                id="s3-bucket-input"
                placeholder={t('tools.s3.bucket.placeholder')}
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.accessKeyId"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.accessKeyId.label')}
              description={t('tools.s3.accessKeyId.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="input"
                id="s3-accessKeyId-input"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="s3.secretAccessKey"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.s3.secretAccessKey.label')}
              description={t('tools.s3.secretAccessKey.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="password"
                id="s3-secretAccessKey-input"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />
      </SettingsSection>
    </>
  )
}
```

**IMPORTANT — the 4 `<li>` `<Trans>` blocks each have TWO non-allowlisted
children** (`<code>`/`<code>`, or `<code>`/`<em>`), and their catalog
strings (Step 2 below) use numbered placeholders `<2>` and `<4>` — NOT
`<1>`/`<2>` — because the positional index counts the intervening text
child too (`[<strong>, text, <code>, text, <code>, text]` → indices
0,1,2,3,4,5 → the two `<code>` elements sit at indices 2 and 4). This was
empirically verified during planning; transcribe the catalog strings in
Step 2 exactly as given, and confirm with Step 3's render tests before
trusting any manual edit to either the JSX or the catalog text.

- [ ] **Step 2: Add `tools.s3.*` to `settings.json`**

Find (the `tools.voice.instructions` block Task 5 added, closing the file):

```
      "instructions": {
        "label": "Voice Instructions",
        "description": "Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)",
        "placeholder": "e.g. Speak in a warm, friendly tone with a slight British accent"
      }
    }
  }
}
```

Replace with:

```
      "instructions": {
        "label": "Voice Instructions",
        "description": "Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)",
        "placeholder": "e.g. Speak in a warm, friendly tone with a slight British accent"
      }
    },
    "s3": {
      "alert": {
        "encoding": "By default, Actovia encodes attachments as <strong>base64</strong> inline in the prompt. For large files or vision-heavy workflows, uploading to S3 and passing a URL is more efficient and reliable.",
        "requirementsHeading": "<strong>Requirements before configuring:</strong>",
        "publicReadAccess": "<strong>Public read access</strong> — AWS blocks public access by default. You must disable \"Block all public access\" on the bucket and attach a bucket policy granting <2>s3:GetObject</2> to <4>*</4>, so the AI provider can fetch the URL without credentials.",
        "cors": "<strong>CORS</strong> — Add a CORS rule allowing <2>PUT</2> from <4>*</4> (or your app origin) so Actovia can upload directly from the desktop.",
        "iamCredentials": "<strong>IAM credentials</strong> — The Access Key ID / Secret Access Key must belong to an IAM user or role with at least <2>s3:PutObject</2> and <4>s3:PutObjectAcl</4> permissions on the configured bucket.",
        "objectAcl": "<strong>Object ACL</strong> — Each uploaded object is set to <2>public-read</2>. Your bucket must not have ACLs disabled (i.e., Object Ownership must be set to <4>ACLs enabled / Bucket owner preferred</4>)."
      },
      "region": {
        "label": "Region",
        "description": "The AWS region where your S3 bucket is hosted."
      },
      "bucket": {
        "label": "Bucket",
        "description": "The name of your S3 bucket for file uploads.",
        "placeholder": "Your S3 bucket"
      },
      "accessKeyId": {
        "label": "Access Key ID",
        "description": "The IAM access key ID with S3 write permissions."
      },
      "secretAccessKey": {
        "label": "Secret Access Key",
        "description": "The IAM secret access key paired with the access key ID above."
      }
    }
  }
}
```

- [ ] **Step 3: Add tests, including 6 real `<Trans>` render tests**

Find (the end of the `'has the Voice tab keys'` test body, BEFORE the
`describe('settings namespace tools.voice.alert renders correctly via Trans', ...)` block Task 5 added):

```
    expect(settings.tools.voice.instructions).toMatchObject({
      label: 'Voice Instructions',
      description:
        'Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)',
      placeholder: 'e.g. Speak in a warm, friendly tone with a slight British accent'
    })
  })
})
```

Replace with:

```
    expect(settings.tools.voice.instructions).toMatchObject({
      label: 'Voice Instructions',
      description:
        'Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)',
      placeholder: 'e.g. Speak in a warm, friendly tone with a slight British accent'
    })
  })

  it('has the S3 tab keys', () => {
    expect(settings.tools.s3.region).toMatchObject({
      label: 'Region',
      description: 'The AWS region where your S3 bucket is hosted.'
    })
    expect(settings.tools.s3.bucket).toMatchObject({
      label: 'Bucket',
      description: 'The name of your S3 bucket for file uploads.',
      placeholder: 'Your S3 bucket'
    })
    expect(settings.tools.s3.accessKeyId).toMatchObject({
      label: 'Access Key ID',
      description: 'The IAM access key ID with S3 write permissions.'
    })
    expect(settings.tools.s3.secretAccessKey).toMatchObject({
      label: 'Secret Access Key',
      description:
        'The IAM secret access key paired with the access key ID above.'
    })
  })
})
```

Now append a new top-level `describe` block to the end of the file (after
Task 5's `tools.voice.alert` Trans-render `describe` block) for the 6 S3
`<Trans>` render checks:

```ts
describe('settings namespace tools.s3.alert.* renders correctly via Trans', () => {
  async function renderTrans(
    i18nKey: string,
    children: Parameters<typeof import('react').createElement>[2][]
  ) {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, Trans, initReactI18next } =
      await import('react-i18next')
    const i18next = (await import('i18next')).default

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    return renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(Trans, { ns: 'settings', i18nKey }, ...children)
      )
    )
  }

  it('encoding — one literal <strong>, no numbered placeholders', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.encoding', [
      'By default, Actovia encodes attachments as ',
      createElement('strong', null, 'base64'),
      ' inline in the prompt. For large files or vision-heavy workflows, uploading to S3 and passing a URL is more efficient and reliable.'
    ])
    expect(html).toBe(
      'By default, Actovia encodes attachments as <strong>base64</strong> inline in the prompt. For large files or vision-heavy workflows, uploading to S3 and passing a URL is more efficient and reliable.'
    )
  })

  it('requirementsHeading — whole text wrapped in one literal <strong>', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.requirementsHeading', [
      createElement('strong', null, 'Requirements before configuring:')
    ])
    expect(html).toBe('<strong>Requirements before configuring:</strong>')
  })

  it('publicReadAccess — <strong> plus two <code> at positions 2 and 4', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.publicReadAccess', [
      createElement('strong', null, 'Public read access'),
      ' — AWS blocks public access by default. You must disable "Block all public access" on the bucket and attach a bucket policy granting ',
      createElement('code', null, 's3:GetObject'),
      ' to ',
      createElement('code', null, '*'),
      ', so the AI provider can fetch the URL without credentials.'
    ])
    expect(html).toBe(
      '<strong>Public read access</strong> — AWS blocks public access by default. You must disable &quot;Block all public access&quot; on the bucket and attach a bucket policy granting <code>s3:GetObject</code> to <code>*</code>, so the AI provider can fetch the URL without credentials.'
    )
  })

  it('cors — <strong> plus two <code> at positions 2 and 4', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.cors', [
      createElement('strong', null, 'CORS'),
      ' — Add a CORS rule allowing ',
      createElement('code', null, 'PUT'),
      ' from ',
      createElement('code', null, '*'),
      ' (or your app origin) so Actovia can upload directly from the desktop.'
    ])
    expect(html).toBe(
      '<strong>CORS</strong> — Add a CORS rule allowing <code>PUT</code> from <code>*</code> (or your app origin) so Actovia can upload directly from the desktop.'
    )
  })

  it('iamCredentials — <strong> plus two <code> at positions 2 and 4', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.iamCredentials', [
      createElement('strong', null, 'IAM credentials'),
      ' — The Access Key ID / Secret Access Key must belong to an IAM user or role with at least ',
      createElement('code', null, 's3:PutObject'),
      ' and ',
      createElement('code', null, 's3:PutObjectAcl'),
      ' permissions on the configured bucket.'
    ])
    expect(html).toBe(
      '<strong>IAM credentials</strong> — The Access Key ID / Secret Access Key must belong to an IAM user or role with at least <code>s3:PutObject</code> and <code>s3:PutObjectAcl</code> permissions on the configured bucket.'
    )
  })

  it('objectAcl — <strong>, one <code> at position 2, one <em> at position 4', async () => {
    const { createElement } = await import('react')
    const html = await renderTrans('tools.s3.alert.objectAcl', [
      createElement('strong', null, 'Object ACL'),
      ' — Each uploaded object is set to ',
      createElement('code', null, 'public-read'),
      '. Your bucket must not have ACLs disabled (i.e., Object Ownership must be set to ',
      createElement('em', null, 'ACLs enabled / Bucket owner preferred'),
      ').'
    ])
    expect(html).toBe(
      '<strong>Object ACL</strong> — Each uploaded object is set to <code>public-read</code>. Your bucket must not have ACLs disabled (i.e., Object Ownership must be set to <em>ACLs enabled / Bucket owner preferred</em>).'
    )
  })
})
```

Note the `renderTrans` helper takes `children` as an array and spreads
them into `createElement(Trans, ...)` — this exactly mirrors how JSX
`<Trans>...</Trans>` compiles its children, so the array's element order
IS the same positional index the catalog's `<N>` placeholders reference.

- [ ] **Step 4: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace
```

All 6 new Trans-render tests must pass with the EXACT expected HTML
given above — if any fails, the catalog string or the JSX children order
has drifted from what this plan verified; do not adjust the test's
expected value to make it pass, fix whichever of the two actually
regressed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/settings-form/s3.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Amazon S3 settings tab"
```

---

## Task 7: Final verification, isolated committed-tree check, plan doc commit, push

**Files:** none new — verification and the plan document commit.

- [ ] **Step 1: Commit the plan document itself**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-tools.md
git commit -m "docs(i18n): Phase 2 settings-tools implementation plan"
```

- [ ] **Step 2: Full gate on the live workspace**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test
```

Expected: fully green, no `--no-verify` needed (matching the state
`settings-providers` left the branch in — only the PGlite teardown flake
is a standing exception, and this plan's files don't touch that test).

- [ ] **Step 3: Isolated committed-tree check**

```bash
rm -rf /tmp/settings-tools-verify
mkdir -p /tmp/settings-tools-verify
git archive HEAD | tar -x -C /tmp/settings-tools-verify
ln -s "$(pwd)/node_modules" /tmp/settings-tools-verify/node_modules
cd /tmp/settings-tools-verify
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
cd -
rm -rf /tmp/settings-tools-verify
```

Expected: both exit 0.

- [ ] **Step 4: Dispatch final review**

Dispatch a final whole-branch code review on the most capable available
model, covering every commit this plan produced. Point it at:

- This plan document, as the spec of record.
- The same failure classes that have bitten prior i18n sub-plans: wrong
  `ns:key` separator, catalog/key desync, ambient over-bundling, and this
  plan's own specific new risk — **every one of the 7 `<Trans>` blocks'
  numbered placeholders** (6 in `s3.tsx`, 1 trivial one in `voice.tsx`).
  Have it independently re-derive the expected HTML for at least the 4
  `<li>` blocks in `s3.tsx` (the ones with two numbered placeholders each)
  by reading the catalog string and the JSX side by side, not just by
  trusting the test file's own expected-output strings (which came from
  the same planning pass that wrote the catalog — an independent
  derivation is the real check here).
- Confirm every technical/proper-noun value this plan declared out of
  scope (model ids, image parameter values, TTS voice/format names,
  country/language lists) is still hardcoded, nothing crept into `t()`.
- Confirm `ToolGroup`'s union values are unchanged and `TOOL_REGISTRY`'s
  `key` fields (used for `disabledTools` persistence) are unchanged.

- [ ] **Step 5: Address findings, one fix wave**

If the final review finds issues: one fix dispatch addressing all of
them, then one scoped re-review of just the fix diff. Adjudicate any
residual disagreement yourself and record the ruling.

- [ ] **Step 6: Push**

Once final review is clean, push directly to `origin/dev`.

```bash
git push origin dev
```

- [ ] **Step 7: Update memory**

Update the `i18n-rollout-progress` memory file: mark `settings-tools`
complete with its commit range, note the empirically-verified `<Trans>`
numbered-placeholder indexing rule (positional across ALL children,
including text nodes) as a durable fact for any future rich-text
extraction in this codebase, and record the country/language list
localization gap as explicit future work (not silently dropped).
