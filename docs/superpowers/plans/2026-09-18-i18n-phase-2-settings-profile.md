# i18n Phase 2 — settings-profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the second slice of the `settings` namespace: the Profile
tab (avatar, usage stats, activity heatmap, insights) and the Personality
tab (tone/style controls, "about you" fields), plus their shared
`avatar-uploader.tsx` component.

**Architecture:** Both tabs are self-contained, single-consumer components
with no architectural wrinkle like `settings-core`'s `SettingsLabel` issue.
Two small option-array cases need the same care as before: `personality.tsx`'s
`BASE_STYLES`/`LEVELS` arrays (currently module-scope literals fed straight
to `SettingsSelect`, which takes `{ value, label }[]`) move inside the
component and get built via `useMemo(() => [...], [t])`, calling `t()`
directly at each entry — no `ParseKeys`-typed lookup table is needed here
since (unlike `settings-core`'s `SHORTCUT_MAP`/`NAV_TITLE_KEYS`) these
arrays are consumed by nothing outside this one component. `profile.tsx`'s
daily/cumulative mode toggle (2 values) is handled with a plain ternary for
the same reason — over-engineering a lookup table for 2 call sites used in
one place buys nothing. `profile.tsx` also introduces one CLDR-free
interpolated template (`profile.activity.cellTooltip`, `{{date}}`/`{{count}}`)
and reuses a new shared `common:state.you` fallback-name key (the string
"You" already appears as a nickname fallback in `nav-footer.tsx`,
`memory.tsx`, and two Philharmonic chat files outside this plan's scope —
those stay hardcoded for now, to be picked up when their own namespace
passes land; this plan only wires the one already inside `profile.tsx`,
and the new key exists precisely so those later passes can reuse it
instead of inventing their own).

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json` (new `profile.*`
  and `personality.*` top-level blocks) and `src/shared/i18n/locales/en/common.json`
  (one new key, `state.you`), dot-nested, English source text only.
- `personality.tsx` and `avatar-uploader.tsx` are single-namespace
  (`useTranslation('settings')`) — neither currently imports `useTranslation`
  at all, so this is a fresh addition, not an array-form conversion.
- `profile.tsx` already imports `useTranslation('common')` (added when the
  `state.runOnLocal` fix landed) — this task converts it to array form
  `useTranslation(['common', 'settings'])`, keeping `common` FIRST so the
  existing bare `t('state.runOnLocal')` call keeps resolving unchanged, and
  prefixing every new lookup `settings:`. The one exception:
  `t('state.you')` (the new shared fallback-name key) stays bare/unprefixed
  since it lives in `common`, not `settings`.
- Never `git commit --amend`. `git add` scoped to the exact files each task
  names — never `-A`/`.` (shared, concurrently-edited working tree).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must pass
  before any commit (the two standing `--no-verify` exceptions documented
  in CLAUDE.md — the PGlite WASM teardown flake and the orphan
  `TEST_IDS.providerModels.modelSelect` id — are unrelated to this plan's
  files; verify that's really the only failure cause before invoking the
  exception, per CLAUDE.md's own instruction).
- Commit the plan document itself before considering this plan finished
  (explicit checklist item, not left to memory — this was missed twice in
  earlier sub-plans before becoming a standing step).
- Run the isolated committed-tree check (`git archive HEAD | tar -x` into
  a scratch dir, symlink `node_modules`, then run `./node_modules/.bin/tsc
  --noEmit -p tsconfig.web.json --composite false` and the `tsconfig.node.json`
  equivalent directly — going through `pnpm exec tsc` from outside the real
  project root fails pnpm's own workspace-root sanity check, use the binary
  directly) before requesting final review.

---

## Task 1: Personality tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/personality.tsx` (full rewrite — file is clean, not under concurrent editing)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `personality.*`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a `personality` test block)

**Interfaces:** Produces nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Rewrite `personality.tsx`**

```tsx
import type { UseFormReturnType } from '@shared/schemas/settings-schema'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

type BaseStyle =
  | 'default'
  | 'professional'
  | 'friendly'
  | 'candid'
  | 'quirky'
  | 'efficient'
  | 'cynical'
type Level = 'default' | 'more' | 'less'

export function Personality({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const baseStyle = form.watch('personality.baseStyle') ?? 'default'
  const warm = form.watch('personality.warm') ?? 'default'
  const enthusiastic = form.watch('personality.enthusiastic') ?? 'default'
  const headersAndLists = form.watch('personality.headersAndLists') ?? 'default'
  const emoji = form.watch('personality.emoji') ?? 'default'

  const baseStyleOptions = useMemo(
    () => [
      { value: 'default', label: t('personality.baseStyle.options.default') },
      {
        value: 'professional',
        label: t('personality.baseStyle.options.professional')
      },
      {
        value: 'friendly',
        label: t('personality.baseStyle.options.friendly')
      },
      { value: 'candid', label: t('personality.baseStyle.options.candid') },
      { value: 'quirky', label: t('personality.baseStyle.options.quirky') },
      {
        value: 'efficient',
        label: t('personality.baseStyle.options.efficient')
      },
      { value: 'cynical', label: t('personality.baseStyle.options.cynical') }
    ],
    [t]
  )

  const levelOptions = useMemo(
    () => [
      { value: 'default', label: t('personality.level.default') },
      { value: 'more', label: t('personality.level.more') },
      { value: 'less', label: t('personality.level.less') }
    ],
    [t]
  )

  return (
    <SettingsSection>
      {/* Personalization */}
      <SettingsRow
        label={t('personality.baseStyle.label')}
        description={t('personality.baseStyle.description')}
      >
        <SettingsSelect
          value={baseStyle}
          onValueChange={(v) =>
            form.setValue('personality.baseStyle', v as BaseStyle)
          }
          options={baseStyleOptions}
        />
      </SettingsRow>

      <SettingsRow label={t('personality.warm')}>
        <SettingsSelect
          value={warm}
          onValueChange={(v) => form.setValue('personality.warm', v as Level)}
          options={levelOptions}
        />
      </SettingsRow>

      <SettingsRow label={t('personality.enthusiastic')}>
        <SettingsSelect
          value={enthusiastic}
          onValueChange={(v) =>
            form.setValue('personality.enthusiastic', v as Level)
          }
          options={levelOptions}
        />
      </SettingsRow>

      <SettingsRow label={t('personality.headersAndLists')}>
        <SettingsSelect
          value={headersAndLists}
          onValueChange={(v) =>
            form.setValue('personality.headersAndLists', v as Level)
          }
          options={levelOptions}
        />
      </SettingsRow>

      <SettingsRow label={t('personality.emoji')}>
        <SettingsSelect
          value={emoji}
          onValueChange={(v) => form.setValue('personality.emoji', v as Level)}
          options={levelOptions}
        />
      </SettingsRow>

      <SettingsRow
        label={t('personality.customInstructions.label')}
        layout="vertical"
      >
        <Textarea
          placeholder={t('personality.customInstructions.placeholder')}
          className="min-h-20"
          value={form.watch('personality.customInstructions') ?? ''}
          onChange={(e) =>
            form.setValue('personality.customInstructions', e.target.value)
          }
        />
      </SettingsRow>

      {/* About you */}
      <SettingsRow label={t('personality.nickname.label')} layout="vertical">
        <Input
          placeholder={t('personality.nickname.placeholder')}
          value={form.watch('personality.nickname') ?? ''}
          onChange={(e) =>
            form.setValue('personality.nickname', e.target.value)
          }
        />
      </SettingsRow>

      <SettingsRow label={t('personality.occupation.label')} layout="vertical">
        <Input
          placeholder={t('personality.occupation.placeholder')}
          value={form.watch('personality.occupation') ?? ''}
          onChange={(e) =>
            form.setValue('personality.occupation', e.target.value)
          }
        />
      </SettingsRow>

      <SettingsRow label={t('personality.aboutYou.label')} layout="vertical">
        <Textarea
          placeholder={t('personality.aboutYou.placeholder')}
          className="min-h-[80px]"
          value={form.watch('personality.aboutYou') ?? ''}
          onChange={(e) =>
            form.setValue('personality.aboutYou', e.target.value)
          }
        />
      </SettingsRow>
    </SettingsSection>
  )
}
```

- [ ] **Step 2: Add `personality.*` to `settings.json`**

Find (the `about` object's `update` block closing, currently the end of the file):

```
      "restartAndInstall": "Restart & Install",
      "failed": "Update failed"
    }
  }
}
```

Replace with:

```
      "restartAndInstall": "Restart & Install",
      "failed": "Update failed"
    }
  },
  "personality": {
    "baseStyle": {
      "label": "Base style and tone",
      "description": "Set the style and tone of how Actovia responds to you",
      "options": {
        "default": "Default",
        "professional": "Professional",
        "friendly": "Friendly",
        "candid": "Candid",
        "quirky": "Quirky",
        "efficient": "Efficient",
        "cynical": "Cynical"
      }
    },
    "level": {
      "default": "Default",
      "more": "More",
      "less": "Less"
    },
    "warm": "Warm",
    "enthusiastic": "Enthusiastic",
    "headersAndLists": "Headers & Lists",
    "emoji": "Emoji",
    "customInstructions": {
      "label": "Custom instructions",
      "placeholder": "Additional behavior, style, and tone preferences"
    },
    "nickname": {
      "label": "Nickname",
      "placeholder": "What should Actovia call you?"
    },
    "occupation": {
      "label": "Occupation",
      "placeholder": "e.g., Software engineer, Designer"
    },
    "aboutYou": {
      "label": "More about you",
      "placeholder": "Interests, values, or preferences to keep in mind"
    }
  }
}
```

- [ ] **Step 3: Add a test**

Find (the end of the `'has the updater panel keys for every state'` test body):

```
    expect(settings.about.update.failed).toBe('Update failed')
  })
})
```

Replace with:

```
    expect(settings.about.update.failed).toBe('Update failed')
  })

  it('has the Personality tab keys', () => {
    expect(settings.personality.baseStyle.label).toBe('Base style and tone')
    expect(settings.personality.baseStyle.description).toBe(
      'Set the style and tone of how Actovia responds to you'
    )
    expect(settings.personality.baseStyle.options).toMatchObject({
      default: 'Default',
      professional: 'Professional',
      friendly: 'Friendly',
      candid: 'Candid',
      quirky: 'Quirky',
      efficient: 'Efficient',
      cynical: 'Cynical'
    })
    expect(settings.personality.level).toMatchObject({
      default: 'Default',
      more: 'More',
      less: 'Less'
    })
    expect(settings.personality.warm).toBe('Warm')
    expect(settings.personality.enthusiastic).toBe('Enthusiastic')
    expect(settings.personality.headersAndLists).toBe('Headers & Lists')
    expect(settings.personality.emoji).toBe('Emoji')
    expect(settings.personality.customInstructions.label).toBe(
      'Custom instructions'
    )
    expect(settings.personality.customInstructions.placeholder).toBe(
      'Additional behavior, style, and tone preferences'
    )
    expect(settings.personality.nickname.label).toBe('Nickname')
    expect(settings.personality.nickname.placeholder).toBe(
      'What should Actovia call you?'
    )
    expect(settings.personality.occupation.label).toBe('Occupation')
    expect(settings.personality.occupation.placeholder).toBe(
      'e.g., Software engineer, Designer'
    )
    expect(settings.personality.aboutYou.label).toBe('More about you')
    expect(settings.personality.aboutYou.placeholder).toBe(
      'Interests, values, or preferences to keep in mind'
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
git add src/renderer/components/settings/settings-form/personality.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "feat(i18n): translate the Personality settings tab"
```

---

## Task 2: Profile tab + AvatarUploader

**Files:**

- Modify: `src/renderer/components/settings/settings-form/profile.tsx` (full rewrite — clean file)
- Modify: `src/renderer/components/settings/settings-form/avatar-uploader.tsx` (full rewrite — clean file)
- Modify: `src/shared/i18n/locales/en/settings.json` (add `profile.*`)
- Modify: `src/shared/i18n/locales/en/common.json` (add `state.you`)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (add a `profile` test block)
- Modify: `tests/unit/i18n/common-namespace.test.ts` (extend the `state` assertion to cover `runOnLocal` and `you`; add a `nav.settings` assertion — both `runOnLocal` and `nav.settings` were added by an earlier, unrelated `nav-footer.tsx` fix and were never covered by a test)

**Interfaces:** Consumes nothing from Task 1 (independent files). `AvatarUploader` is consumed only by `Profile` in this codebase.

- [ ] **Step 1: Rewrite `avatar-uploader.tsx`**

```tsx
import { PlusIcon, XIcon } from 'lucide-react'
import { ChangeEvent, useRef } from 'react'
import { FieldValues, useController, UseControllerProps } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSettings } from '@/hooks/use-settings'
import { cn, convertFileToBase64 } from '@/lib/utils'

export function AvatarUploader<T extends FieldValues>({
  props,
  className,
  fallback
}: {
  props: UseControllerProps<T>
  className?: string
  /** Shown when no image is set — e.g. the user's initial. */
  fallback?: string
}) {
  const { t } = useTranslation('settings')
  const ref = useRef<HTMLInputElement | null>(null)
  const { field } = useController(props)
  const { data: settings, updateSettings } = useSettings()

  const handleEditorChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!settings) return

    const file = e.target.files?.[0]
    if (file) {
      const base64 = await convertFileToBase64(file)
      field.onChange(base64)
      updateSettings({ ...settings, userAvatar: base64 })
    }

    if (ref.current) {
      ref.current.value = ''
    }
  }

  const handleRemove = () => {
    if (!settings) return

    field.onChange('')
    updateSettings({ ...settings, userAvatar: '' })
  }

  return (
    <div
      className={cn(
        'relative flex size-16 shrink-0 items-center justify-center rounded-full border',
        className
      )}
    >
      <input
        ref={ref}
        type="file"
        accept="image/*"
        id="user-avatar"
        aria-label={t('profile.avatar.uploadLabel')}
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        onChange={handleEditorChange}
      />
      {field.value ? (
        <img
          src={field.value}
          alt={t('profile.avatar.alt')}
          className="size-full rounded-full object-cover"
        />
      ) : fallback ? (
        <span className="text-muted-foreground text-lg font-medium">
          {fallback}
        </span>
      ) : (
        <PlusIcon />
      )}

      {!!field.value && (
        <span className="border-background bg-foreground absolute -top-1 -right-1 z-100 rounded-full border-3 p-0.75">
          <XIcon
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              handleRemove()
            }}
            className="text-background size-2.5"
            strokeWidth={2.5}
          />
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `profile.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
  subWeeks
} from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'
import type { UsageSummary } from '@/services/usage'

import { SettingsSection } from '../settings-row'
import { AvatarUploader } from './avatar-uploader'

const WEEKS = 52

function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

/** Consecutive-day streaks over the set of days that had any token usage. */
function computeStreaks(activeDays: Set<string>): {
  current: number
  longest: number
} {
  if (activeDays.size === 0) return { current: 0, longest: 0 }
  const sorted = [...activeDays].sort()
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const gap = differenceInCalendarDays(
      parseISO(sorted[i]),
      parseISO(sorted[i - 1])
    )
    run = gap === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')
  const last = sorted[sorted.length - 1]
  const current = last === today || last === yesterday ? run : 0
  return { current, longest }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  )
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

const HEAT = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary'
]

// Heatmap cell geometry. The month-label track and the cell grid are both
// driven from these so the labels stay aligned to their columns — change one,
// both follow.
const CELL_PX = 10 // cell width/height
const CELL_GAP_PX = 4 // gap between cells (and between columns)

export function Profile({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation(['common', 'settings'])
  const { data: settings } = useSettings()
  const { data: usage } = useSWR<UsageSummary>('/api/usage')
  const { data: chats } = useSWR<{ id: string }[]>('/api/history')
  const { data: skills } = useSWR<{ isActive: boolean }[]>(
    '/api/skills/installed'
  )
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily')

  const byDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of usage?.daily ?? []) m.set(d.date, d.tokens)
    return m
  }, [usage?.daily])

  const { grid, months, peak, streaks } = useMemo(() => {
    const end = new Date()
    const start = startOfWeek(subWeeks(end, WEEKS - 1), { weekStartsOn: 0 })
    const days: { date: string; tokens: number }[] = []
    let running = 0
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = addDays(start, i)
      if (d > end) break
      const key = format(d, 'yyyy-MM-dd')
      const count = byDay.get(key) ?? 0
      running += count
      days.push({ date: key, tokens: mode === 'cumulative' ? running : count })
    }
    const activeDays = new Set(
      [...byDay.entries()].filter(([, count]) => count > 0).map(([k]) => k)
    )
    const dailyPeak = Math.max(0, ...byDay.values())
    const scaleMax = Math.max(1, ...days.map((x) => x.tokens))
    const grid = days.map((x) => ({
      ...x,
      level:
        x.tokens === 0
          ? 0
          : Math.min(4, 1 + Math.floor((x.tokens / scaleMax) * 3.999))
    }))
    // Month labels: column index where a new month first appears.
    const months: { col: number; label: string }[] = []
    let lastMonth = ''
    for (let c = 0; c < Math.ceil(grid.length / 7); c++) {
      const cell = grid[c * 7]
      if (!cell) break
      const mo = format(parseISO(cell.date), 'MMM')
      if (mo !== lastMonth) {
        months.push({ col: c, label: mo })
        lastMonth = mo
      }
    }
    return {
      grid,
      months,
      peak: dailyPeak,
      streaks: computeStreaks(activeDays)
    }
  }, [byDay, mode])

  const nickname = settings?.personality?.nickname?.trim()
  const you = t('state.you')

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <AvatarUploader
          props={{ control: form.control, name: 'userAvatar' }}
          className="size-20"
          fallback={(nickname ?? you).slice(0, 1).toUpperCase()}
        />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-lg font-semibold">{nickname ?? you}</h2>
          <Badge variant="secondary" className="text-xs font-normal">
            {t('state.runOnLocal')}
          </Badge>
        </div>
      </div>

      {/* Stat tiles */}
      <Card className="[&>*:not(:last-child)]:border-border grid grid-cols-2 gap-0 py-0 sm:grid-cols-4 [&>*:not(:last-child)]:border-r">
        <Stat
          value={compact(usage?.totalTokens ?? 0)}
          label={t('settings:profile.stats.lifetimeTokens')}
        />
        <Stat
          value={compact(peak)}
          label={t('settings:profile.stats.peakDay')}
        />
        <Stat
          value={`${streaks.current}d`}
          label={t('settings:profile.stats.currentStreak')}
        />
        <Stat
          value={`${streaks.longest}d`}
          label={t('settings:profile.stats.longestStreak')}
        />
      </Card>

      {/* Token activity heatmap */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            {t('settings:profile.activity.heading')}
          </h2>
          <div className="text-muted-foreground flex gap-3 text-xs">
            {(['daily', 'cumulative'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'capitalize transition-colors hover:text-foreground',
                  mode === m && 'text-foreground font-medium'
                )}
              >
                {m === 'daily'
                  ? t('settings:profile.activity.mode.daily')
                  : t('settings:profile.activity.mode.cumulative')}
              </button>
            ))}
          </div>
        </div>
        <Card className="gap-2 overflow-x-auto px-4 py-4">
          <div className="flex min-w-fit flex-col gap-1">
            <div
              className="text-muted-foreground grid text-[10px]"
              style={{
                gridTemplateColumns: `repeat(${Math.ceil(grid.length / 7)}, ${CELL_PX}px)`,
                columnGap: CELL_GAP_PX
              }}
            >
              {months.map((m) => (
                <span
                  key={m.label + m.col}
                  style={{ gridColumnStart: m.col + 1 }}
                >
                  {m.label}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col grid-rows-7"
              style={{ gap: CELL_GAP_PX }}
            >
              {grid.map((cell) => (
                <div
                  key={cell.date}
                  title={t('settings:profile.activity.cellTooltip', {
                    date: cell.date,
                    count: compact(cell.tokens)
                  })}
                  className={cn('rounded-xs', HEAT[cell.level])}
                  style={{ width: CELL_PX, height: CELL_PX }}
                />
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Insights */}
      <div className="grid gap-6 sm:grid-cols-2">
        <SettingsSection title={t('settings:profile.insights.sectionTitle')}>
          <InsightRow
            label={t('settings:profile.insights.totalChats')}
            value={String(chats?.length ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.modelRequests')}
            value={compact(usage?.totalRequests ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.installedSkills')}
            value={String(skills?.length ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.activeSkills')}
            value={String(skills?.filter((s) => s.isActive).length ?? 0)}
          />
        </SettingsSection>

        <SettingsSection title={t('settings:profile.topModels.sectionTitle')}>
          {usage?.models?.length ? (
            usage.models
              .slice(0, 5)
              .map((m) => (
                <InsightRow
                  key={m.model}
                  label={m.model}
                  value={compact(m.inputTokens + m.outputTokens)}
                />
              ))
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {t('settings:profile.topModels.empty')}
            </p>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add `profile.*` to `settings.json`**

Find (the end of the file, `personality.aboutYou`'s closing — this is the block Task 1 added, so this task runs after Task 1 has landed):

```
    "aboutYou": {
      "label": "More about you",
      "placeholder": "Interests, values, or preferences to keep in mind"
    }
  }
}
```

Replace with:

```
    "aboutYou": {
      "label": "More about you",
      "placeholder": "Interests, values, or preferences to keep in mind"
    }
  },
  "profile": {
    "stats": {
      "lifetimeTokens": "Lifetime tokens",
      "peakDay": "Peak day",
      "currentStreak": "Current streak",
      "longestStreak": "Longest streak"
    },
    "activity": {
      "heading": "Token activity",
      "mode": {
        "daily": "Daily",
        "cumulative": "Cumulative"
      },
      "cellTooltip": "{{date}} · {{count}} tokens"
    },
    "insights": {
      "sectionTitle": "Activity insights",
      "totalChats": "Total chats",
      "modelRequests": "Model requests",
      "installedSkills": "Installed skills",
      "activeSkills": "Active skills"
    },
    "topModels": {
      "sectionTitle": "Top models",
      "empty": "No model usage yet"
    },
    "avatar": {
      "uploadLabel": "Upload your avatar",
      "alt": "Your avatar"
    }
  }
}
```

- [ ] **Step 4: Add `state.you` to `common.json`**

Find:

```
  "state": {
    "loading": "Loading…",
    "local": "Local",
    "runOnLocal": "Run on local"
  },
```

Replace with:

```
  "state": {
    "loading": "Loading…",
    "local": "Local",
    "runOnLocal": "Run on local",
    "you": "You"
  },
```

- [ ] **Step 5: Add a settings-namespace test**

Find (the end of the `'has the Personality tab keys'` test body, added by Task 1):

```
    expect(settings.personality.aboutYou.placeholder).toBe(
      'Interests, values, or preferences to keep in mind'
    )
  })
})
```

Replace with:

```
    expect(settings.personality.aboutYou.placeholder).toBe(
      'Interests, values, or preferences to keep in mind'
    )
  })

  it('has the Profile tab keys', () => {
    expect(settings.profile.stats).toMatchObject({
      lifetimeTokens: 'Lifetime tokens',
      peakDay: 'Peak day',
      currentStreak: 'Current streak',
      longestStreak: 'Longest streak'
    })
    expect(settings.profile.activity.heading).toBe('Token activity')
    expect(settings.profile.activity.mode).toMatchObject({
      daily: 'Daily',
      cumulative: 'Cumulative'
    })
    expect(settings.profile.activity.cellTooltip).toBe(
      '{{date}} · {{count}} tokens'
    )
    expect(settings.profile.insights).toMatchObject({
      sectionTitle: 'Activity insights',
      totalChats: 'Total chats',
      modelRequests: 'Model requests',
      installedSkills: 'Installed skills',
      activeSkills: 'Active skills'
    })
    expect(settings.profile.topModels).toMatchObject({
      sectionTitle: 'Top models',
      empty: 'No model usage yet'
    })
    expect(settings.profile.avatar).toMatchObject({
      uploadLabel: 'Upload your avatar',
      alt: 'Your avatar'
    })
  })
})
```

- [ ] **Step 6: Extend the common-namespace test**

Find:

```
  it('still has the state keys from Phase 1', () => {
    expect(common.state).toMatchObject({ loading: 'Loading…', local: 'Local' })
  })
})
```

Replace with:

```
  it('still has the state keys from Phase 1', () => {
    expect(common.state).toMatchObject({ loading: 'Loading…', local: 'Local' })
  })
  it('has the state.runOnLocal / state.you keys (added alongside NavFooter/Profile fixes)', () => {
    expect(common.state).toMatchObject({
      runOnLocal: 'Run on local',
      you: 'You'
    })
  })
  it('has the nav.settings key (added alongside the NavFooter dropdown redesign)', () => {
    expect(common.nav).toMatchObject({ settings: 'Settings' })
  })
})
```

- [ ] **Step 7: Run gate**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test -- settings-namespace common-namespace
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/settings/settings-form/profile.tsx \
  src/renderer/components/settings/settings-form/avatar-uploader.tsx \
  src/shared/i18n/locales/en/settings.json \
  src/shared/i18n/locales/en/common.json \
  tests/unit/i18n/settings-namespace.test.ts \
  tests/unit/i18n/common-namespace.test.ts
git commit -m "feat(i18n): translate the Profile settings tab and AvatarUploader"
```

---

## Task 3: Final verification, isolated committed-tree check, plan doc commit, push

**Files:** none new — verification and the plan document commit.

- [ ] **Step 1: Commit the plan document itself**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-profile.md
git commit -m "docs(i18n): Phase 2 settings-profile implementation plan"
```

- [ ] **Step 2: Full gate on the live workspace**

```bash
pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass except the two standing, documented `--no-verify`
exceptions in CLAUDE.md (verify that's really the only cause, per
CLAUDE.md's own instruction, before treating a failure as pre-existing).

- [ ] **Step 3: Isolated committed-tree check**

```bash
rm -rf /tmp/settings-profile-verify
mkdir -p /tmp/settings-profile-verify
git archive HEAD | tar -x -C /tmp/settings-profile-verify
ln -s "$(pwd)/node_modules" /tmp/settings-profile-verify/node_modules
cd /tmp/settings-profile-verify
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
cd -
rm -rf /tmp/settings-profile-verify
```

Expected: both exit 0. (Invoking `pnpm exec tsc` from outside the real
project root fails pnpm's workspace-root sanity check — call the `tsc`
binary directly, as above.)

- [ ] **Step 4: Dispatch final review**

Dispatch a final whole-branch code review on the most capable available
model, covering every commit this plan produced. Point it at:

- This plan document, as the spec of record.
- The same failure classes that have bitten prior i18n sub-plans: wrong
  `ns:key` separator or missing namespace prefix (`profile.tsx`'s
  array-form conversion is the one place this plan could get wrong —
  confirm every new lookup is `settings:`-prefixed and `state.you`/
  `state.runOnLocal` stayed bare), catalog/key desync, and — since this
  plan didn't touch any file under known concurrent editing — confirm
  each commit's diff stat matches its task's file list exactly (no
  incidental bundling).
- Confirm `personality.tsx`'s `BASE_STYLES`/`LEVELS` → `useMemo` options
  arrays render the correct label for every value (no off-by-one between
  `value` and the translated `label`).

- [ ] **Step 5: Address findings, one fix wave**

If the final review finds issues: one fix dispatch addressing all of
them, then one scoped re-review of just the fix diff. Adjudicate any
residual disagreement yourself and record the ruling.

- [ ] **Step 6: Push**

Once final review is clean, push directly to `origin/dev` (this
project's established practice — no worktree, no PR).

```bash
git push origin dev
```

- [ ] **Step 7: Update memory**

Update the `i18n-rollout-progress` memory file: mark `settings-profile`
complete with its commit range, note the "build option arrays via
`useMemo(() => [...], [t])` instead of a `ParseKeys` lookup table when the
array is single-consumer" pattern as a lighter-weight alternative to
`settings-core`'s table technique, and confirm whether `nav-footer.tsx`'s
sibling "You"-fallback usages (and `memory.tsx`'s, and the two
Philharmonic chat files') got picked up by whichever later namespace pass
reaches them — they should reuse `common:state.you` rather than
reinventing a key.
