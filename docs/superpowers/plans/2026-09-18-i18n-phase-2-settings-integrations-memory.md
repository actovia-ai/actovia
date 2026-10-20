# Settings Integrations — Memory i18n Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `settings` namespace's Memory tab
(`memory.tsx`) — the last remaining sub-plan of the `settings-
integrations` split (`settings-integrations-mcp` shipped earlier this
rollout). This closes out Phase 2 entirely.

**Architecture:** Extract every hardcoded UI string in
`components/settings/settings-form/memory.tsx` into a new top-level
`memory.*` section of `src/shared/i18n/locales/en/settings.json`, matching
the file's existing sibling-top-level-section convention (`mcpServers`,
`dataControls`, `fullTextSearch`, `logger`, etc. all live at the root, not
nested under an `integrations` wrapper). No `<Trans>` blocks are needed —
every string is plain prose, two with interpolation (one pre-formatted
date string, one real-pluralized count).

**Tech Stack:** React 19, react-i18next, i18next, TypeScript, Vitest,
react-hook-form.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- **Pre-commit gate:** `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm i18n:check` → `pnpm test` must all pass before any commit.
- **English is the source catalog.** New keys go into
  `src/shared/i18n/locales/en/settings.json` only, as a new top-level
  `memory` key.
- **Component:** `MemoryRow`/`MemoryDetail` already use
  `useTranslation('common')` (for `action.delete`) — become array-form
  `useTranslation(['common', 'settings'])` (existing namespace first,
  new lookups prefixed `settings:`). `MemoryComposer`/`MemorySettings`
  have no prior `useTranslation` call — get fresh
  `const { t } = useTranslation('settings')` (single form, bare keys).
- **CRITICAL — this file has a genuine, active, uncommitted change from
  a concurrent session that this plan's rewrite MUST preserve character-
  for-character, not revert**: two structural additions, confirmed via
  `git diff` to touch zero text strings:
  1. `MemoryDetail` gained a `lastSyncedRef` (`useRef(item)`) and a
     SECOND `useEffect` (in addition to the pre-existing re-sync
     effect) implementing per-field "don't clobber an in-progress edit"
     sync logic when the same entry's data changes without a different
     `item.id` (e.g. via the natural-language composer).
  2. `MemorySettings`'s "Compaction threshold" row swapped a plain
     `<Input>` for an `<InputGroup><InputGroupInput/><InputGroupAddon
     align="inline-end">%</InputGroupAddon></InputGroup>` (adds a "%"
     suffix affordance), including a new import block for
     `InputGroup`/`InputGroupInput`/`InputGroupAddon` and `useRef` added
     to the `react` import.
     Both hunks are reproduced VERBATIM in Step 2 below — do not "clean
     up" or re-derive them, copy them exactly as shown.
- **Shared-key reuse, deliberate**:
  - `settings:memory.restoreLabel`/`disableLabel` are shared between
    `MemoryRow`'s icon-button tooltip (`title={...}`) and
    `MemoryDetail`'s visible button text (`{...}`) — both are the exact
    same speech act (naming the toggle action for the exact same
    entity), just exposed through two different UI affordances (a
    hover tooltip in the list vs. a button label in the detail view),
    unlike this rollout's "different UI role" non-sharing cases (which
    involved a LABEL vs. a TITLE/heading, a different speech act
    entirely).
  - `settings:memory.genericRetryHint` ("Try again") is shared across
    FIVE catch-block toast descriptions in this one file
    (`MemoryDetail.save`, `MemoryDetail.handleDelete`,
    `MemoryComposer.submit`, `MemorySettings.load`,
    `MemorySettings.handleNew`) — identical fallback phrase, identical
    role (a generic "error had no message, here's a fallback hint"
    string), file-scoped reuse matching this rollout's established
    "workforce.toast.created/deleted" precedent.
  - `settings:memory.detail.titlePlaceholder` is used for BOTH the
    title input's `placeholder` AND its `aria-label` — the same text
    describing the same field through two channels (sighted vs.
    screen-reader), not a "different role" case.
  - **DELIBERATELY NOT shared**: `memory.sectionGroups.profile` ("You")
    is NOT the same key as the established cross-namespace
    `common:state.you` fallback — that key names WHO sent a message
    (an identity label); this one names a memory-section-group HEADING
    ("facts filed under 'about you'" — a category label). Different
    speech act, same precedent as this rollout's other "same text,
    different role" decisions.
- **`SECTION_GROUPS` is a single-consumer array** → moves inside
  `MemorySettings` via `useMemo(() => [...], [t])`, same pattern as
  every prior sub-plan's single-consumer enum/option arrays.
- **`updatedLabel()` is a plain function** (module-level, not a
  component/hook) → uses `import { i18n } from '@/lib/i18n'` →
  `i18n.t('settings:memory.updatedLabel', { date: format(...) })`. The
  pre-formatted date string (`format(d, 'MMM d')`, e.g. "Mar 5")
  interpolates as an opaque template param, same precedent as
  `webSearch.videoCard.views`/`costAnalysis.agentCostList.tokens`
  (already-formatted display strings, not raw values).
- **Real pluralization** for `MemoryComposer`'s "N change(s) applied"
  toast description (`_one`/`_other` + `{{count}}`), replacing the
  manual `${applied === 1 ? '' : 's'}` ternary. `disabledHeading`
  ("Disabled · {{count}}") stays a bare `{{count}}` interpolation, NOT
  pluralized — "Disabled" doesn't change grammatically with count in
  English, same precedent as "Coordinators"/"idle"/"busy".
- **`handleNew()`'s `key: 'New memory'`** is a persisted default value
  (frozen at creation-time locale, like `container.newGroupDefaultTitle`
  /`workforce.newEmployeeDefaultName`) — since `handleNew` is a closure
  defined inside `MemorySettings`'s own body, it uses the component's
  own `t()` directly (not `i18n.t()` — that's only for code with no
  hook access).
- **No tooling catches a stale/orphaned English catalog key** —
  manually grep/script-verify zero missing AND zero orphaned
  `memory.*` keys within `settings.json` before considering this
  sub-plan done.
- **Stray `node_modules/node_modules` symlink**: if any test run reports
  "Invalid hook call", run `ls -la node_modules/node_modules` first and
  `rm` it if present.
- **Known flaky test**: retry `pnpm test` once if the ONLY failure is
  the PGlite WASM teardown race (`RuntimeError: Aborted()`).
- **`pnpm format`/`oxfmt .` reformats the WHOLE repo**, including
  already-committed, unrelated files it happens to touch (two older
  plan docs have been hit by this repeatedly this rollout). After
  running the full gate, re-check `git status --porcelain` and
  `git checkout --` any file outside this plan's intended scope before
  staging.
- **This closes out Phase 2 entirely** — after this sub-plan, every one
  of the 13 namespaces in `src/shared/i18n/namespaces.ts`'s
  `NAMESPACES` array has real content. Update the
  `i18n-rollout-progress` memory to reflect Phase 2 completion once
  this ships.

---

### Task 1: Populate `memory.*`, rewrite `memory.tsx`

**Files:**

- Modify: `src/renderer/components/settings/settings-form/memory.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json`
- Modify: `tests/unit/i18n/settings-namespace.test.ts`

**Interfaces:**

- Produces: `settings.memory.*` — consumed only within this file.

- [ ] **Step 1: Add the `memory` section to `settings.json`**

Add this new top-level key (as a sibling to `mcpServers`, `dataControls`,
etc.):

```json
  "memory": {
    "sectionGroups": {
      "profile": "You",
      "topic": "Topics",
      "person": "People"
    },
    "updatedLabel": "Updated {{date}}",
    "genericRetryHint": "Try again",
    "restoreLabel": "Restore",
    "disableLabel": "Disable",
    "row": {
      "noSummaryYet": "No summary yet"
    },
    "detail": {
      "backButton": "Memory",
      "titlePlaceholder": "Title",
      "summaryLabel": "Summary",
      "summaryPlaceholder": "A compact phrase — what this entry covers",
      "detailsLabel": "Details",
      "detailsPlaceholder": "One fact per line",
      "toast": {
        "notSavedTitle": "Not saved",
        "deleteFailedTitle": "Failed to delete"
      }
    },
    "composer": {
      "placeholderScoped": "Tell the assistant what to change or remove…",
      "placeholderGeneral": "Tell the assistant what to remember…",
      "submitAria": "Add to memory",
      "toast": {
        "updatedTitle": "Memory updated",
        "updatedDescription_one": "{{count}} change applied",
        "updatedDescription_other": "{{count}} changes applied",
        "noChangeTitle": "No change",
        "noChangeDescription": "That didn't call for a memory update.",
        "applyFailedTitle": "Couldn't apply that"
      }
    },
    "settings": {
      "autoCapture": {
        "label": "Capture memories",
        "description": "After each conversation, consolidate durable facts about you (interests, setup, people) into memory — updating existing entries rather than duplicating them."
      },
      "useInChat": {
        "label": "Use memory in chats",
        "description": "Surface the memory entries relevant to your message into the assistant's context at the start of a reply."
      },
      "lcmEnabled": {
        "label": "Lossless context management",
        "description": "Automatically compress long conversations into a hierarchical summary DAG, so nothing is ever lost even when chats exceed the context window."
      },
      "contextWindowPercent": {
        "label": "Compaction threshold",
        "description": "Trigger context compaction when the conversation reaches this percentage of the model's context window (50-95%). Default: 75%."
      },
      "freshTailSize": {
        "label": "Fresh tail size",
        "description": "Number of recent messages protected from compaction (8-64). These are always sent to the model verbatim. Default: 16."
      },
      "newMemoryDefaultKey": "New memory",
      "storedMemoriesHeading": "Stored memories",
      "newButton": "New",
      "emptyState": "No memories yet — they're added automatically after conversations, or tell the assistant to remember something below.",
      "disabledHeading": "Disabled · {{count}}",
      "toast": {
        "loadFailedTitle": "Failed to load memories",
        "createFailedTitle": "Failed to create"
      }
    }
  }
```

- [ ] **Step 2: Rewrite `memory.tsx`**

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { format } from 'date-fns'
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import {
  createMemory,
  deleteMemory,
  getMemories,
  instructMemory,
  updateMemory,
  type MemoryItem,
  type MemorySection
} from '../../../services/memory'
import { SettingsRow, SettingsSection } from '../settings-row'

/** DB serializes local wall-clock with a trailing `Z`; strip it so the day is right. */
function updatedLabel(m: MemoryItem): string {
  const raw = m.updatedAt ?? m.createdAt
  if (!raw) return ''
  const d = new Date(raw.replace(/Z$/, ''))
  return Number.isNaN(d.getTime())
    ? ''
    : i18n.t('settings:memory.updatedLabel', { date: format(d, 'MMM d') })
}

function detailsFromText(text: string): string[] {
  return text
    .split('\n')
    .map((d) => d.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

// ─── List row ─────────────────────────────────────────────────────────────────

function MemoryRow({
  item,
  onOpen,
  onToggle,
  onDelete
}: {
  item: MemoryItem
  onOpen: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation(['common', 'settings'])
  const disabled = item.isActive === false
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group hover:bg-muted/55 focus-visible:bg-muted/55 relative flex h-10 cursor-pointer items-center gap-3.5 px-3 outline-none"
    >
      <span
        className={cn(
          'max-w-[60%] shrink-0 truncate text-sm font-medium',
          disabled && 'text-muted-foreground'
        )}
      >
        {item.key}
      </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">
        {item.summary || (
          <span className="italic">
            {t('settings:memory.row.noSummaryYet')}
          </span>
        )}
      </span>

      {/* Fixed slot: a chevron at rest, the eye/trash actions on hover — the
          slot keeps its width both ways so the swap never nudges the row. */}
      <div className="relative flex h-7 w-16 shrink-0 items-center justify-end">
        <ChevronRightIcon
          className="text-muted-foreground/40 size-4 transition-opacity group-hover:opacity-0"
          data-icon
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground size-7"
            title={
              disabled
                ? t('settings:memory.restoreLabel')
                : t('settings:memory.disableLabel')
            }
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {disabled ? (
              <EyeIcon className="size-3.5" data-icon />
            ) : (
              <EyeOffIcon className="size-3.5" data-icon />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            title={t('action.delete')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2Icon className="size-3.5" data-icon />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
      {children}
    </span>
  )
}

function MemoryDetail({
  item,
  onBack,
  onPatched,
  onDeleted
}: {
  item: MemoryItem
  onBack: () => void
  onPatched: (next: MemoryItem) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation(['common', 'settings'])
  const [key, setKey] = useState(item.key)
  const [summary, setSummary] = useState(item.summary)
  const [detailsText, setDetailsText] = useState(() => item.details.join('\n'))
  const disabled = item.isActive === false
  // The item snapshot each field was last synced from — lets the effect
  // below tell "user hasn't touched this field since" apart from "user is
  // mid-edit," per field.
  const lastSyncedRef = useRef(item)

  type MemoryPatch = Partial<Pick<MemoryItem, 'key' | 'summary'>> & {
    details?: string[]
    isActive?: boolean
  }

  // Re-sync when a different entry is opened — always wins over any
  // in-progress, unblurred edit in the previous entry's fields.
  useEffect(() => {
    setKey(item.key)
    setSummary(item.summary)
    setDetailsText(item.details.join('\n'))
    lastSyncedRef.current = item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // The same entry can also change underneath us without a different `item.id`
  // — e.g. the natural-language composer below patches it via `instructMemory`,
  // which reloads the list but leaves this view open. Pull in the new value
  // per field, but only for a field the user hasn't started typing into since
  // the last sync, so an in-progress edit in one field survives an unrelated
  // instruction that only touched another field.
  useEffect(() => {
    const prev = lastSyncedRef.current
    if (item.id !== prev.id) return
    const prevDetailsText = prev.details.join('\n')
    setKey((cur) => (cur === prev.key ? item.key : cur))
    setSummary((cur) => (cur === prev.summary ? item.summary : cur))
    setDetailsText((cur) =>
      cur === prevDetailsText ? item.details.join('\n') : cur
    )
    lastSyncedRef.current = item
  }, [item])

  const save = useCallback(
    async (patch: MemoryPatch) => {
      try {
        await updateMemory(item.id, patch)
        onPatched({ ...item, ...patch })
      } catch (e) {
        sileo.error({
          title: t('settings:memory.detail.toast.notSavedTitle'),
          description:
            e instanceof Error
              ? e.message
              : t('settings:memory.genericRetryHint')
        })
      }
    },
    [item, onPatched, t]
  )

  const handleDelete = async () => {
    try {
      await deleteMemory(item.id, true)
      onDeleted()
    } catch (e) {
      sileo.error({
        title: t('settings:memory.detail.toast.deleteFailedTitle'),
        description:
          e instanceof Error ? e.message : t('settings:memory.genericRetryHint')
      })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -ml-1 flex items-center gap-1.5 text-sm"
        >
          <ArrowLeftIcon className="size-4" data-icon />
          {t('settings:memory.detail.backButton')}
        </button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => save({ isActive: disabled })}
          >
            {disabled
              ? t('settings:memory.restoreLabel')
              : t('settings:memory.disableLabel')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            {t('action.delete')}
          </Button>
        </div>
      </div>

      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onBlur={() => {
          const v = key.trim()
          if (v && v !== item.key) save({ key: v })
          else setKey(item.key)
        }}
        placeholder={t('settings:memory.detail.titlePlaceholder')}
        aria-label={t('settings:memory.detail.titlePlaceholder')}
        className="placeholder:text-muted-foreground/50 -my-1 border-0 bg-transparent p-0 text-lg font-semibold outline-none"
      />

      {updatedLabel(item) && (
        <p className="text-muted-foreground/70 -mt-3 text-xs">
          {updatedLabel(item)}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t('settings:memory.detail.summaryLabel')}</FieldLabel>
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => {
            const v = summary.trim()
            if (v !== item.summary) save({ summary: v })
          }}
          placeholder={t('settings:memory.detail.summaryPlaceholder')}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t('settings:memory.detail.detailsLabel')}</FieldLabel>
        <Textarea
          rows={6}
          value={detailsText}
          onChange={(e) => setDetailsText(e.target.value)}
          onBlur={() => {
            const next = detailsFromText(detailsText)
            if (JSON.stringify(next) !== JSON.stringify(item.details)) {
              save({ details: next })
            }
          }}
          placeholder={t('settings:memory.detail.detailsPlaceholder')}
        />
      </div>
    </div>
  )
}

// ─── Natural-language composer ────────────────────────────────────────────────

function MemoryComposer({
  scopeMemoryId,
  onApplied
}: {
  scopeMemoryId?: string
  onApplied: () => void
}) {
  const { t } = useTranslation('settings')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const t2 = text.trim()
    if (!t2 || busy) return
    setBusy(true)
    try {
      const { applied } = await instructMemory(t2, scopeMemoryId)
      setText('')
      if (applied > 0) {
        sileo.success({
          title: t('memory.composer.toast.updatedTitle'),
          description: t('memory.composer.toast.updatedDescription', {
            count: applied
          })
        })
        onApplied()
      } else {
        sileo.info({
          title: t('memory.composer.toast.noChangeTitle'),
          description: t('memory.composer.toast.noChangeDescription')
        })
      }
    } catch (e) {
      sileo.error({
        title: t('memory.composer.toast.applyFailedTitle'),
        description:
          e instanceof Error ? e.message : t('memory.genericRetryHint')
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-border focus-within:border-ring flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={1}
        disabled={busy}
        placeholder={
          scopeMemoryId
            ? t('memory.composer.placeholderScoped')
            : t('memory.composer.placeholderGeneral')
        }
        className="placeholder:text-muted-foreground max-h-32 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
      />
      <Button
        type="button"
        size="icon"
        aria-label={t('memory.composer.submitAria')}
        className="size-7 shrink-0 rounded-full"
        disabled={!text.trim() || busy}
        onClick={submit}
      >
        {busy ? (
          <LoaderIcon className="size-4 animate-spin" data-icon />
        ) : (
          <ArrowUpIcon className="size-4" data-icon />
        )}
      </Button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function MemorySettings({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sectionGroups: { section: MemorySection; label: string }[] = useMemo(
    () => [
      { section: 'profile', label: t('memory.sectionGroups.profile') },
      { section: 'topic', label: t('memory.sectionGroups.topic') },
      { section: 'person', label: t('memory.sectionGroups.person') }
    ],
    [t]
  )

  const lcmEnabled = form.watch('memory.lcmEnabled') ?? true

  const load = useCallback(async () => {
    try {
      setMemories(await getMemories())
    } catch (e) {
      sileo.error({
        title: t('memory.settings.toast.loadFailedTitle'),
        description:
          e instanceof Error ? e.message : t('memory.genericRetryHint')
      })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId]
  )
  useEffect(() => {
    if (selectedId && !loading && !selected) setSelectedId(null)
  }, [selectedId, selected, loading])

  const patchLocal = useCallback((next: MemoryItem) => {
    setMemories((ms) => ms.map((m) => (m.id === next.id ? next : m)))
  }, [])

  const handleNew = async () => {
    try {
      const row = await createMemory({
        section: 'topic',
        key: t('memory.settings.newMemoryDefaultKey'),
        summary: '',
        details: [],
        source: 'explicit'
      })
      await load()
      setSelectedId(row.id)
    } catch (e) {
      sileo.error({
        title: t('memory.settings.toast.createFailedTitle'),
        description:
          e instanceof Error ? e.message : t('memory.genericRetryHint')
      })
    }
  }

  const handleToggle = async (item: MemoryItem) => {
    patchLocal({ ...item, isActive: item.isActive === false })
    try {
      await updateMemory(item.id, { isActive: item.isActive === false })
    } catch {
      load()
    }
  }

  const handleDelete = async (item: MemoryItem) => {
    setMemories((ms) => ms.filter((m) => m.id !== item.id))
    try {
      await deleteMemory(item.id, true)
    } catch {
      load()
    }
  }

  // ── Detail view ──
  if (selected) {
    return (
      <div className="flex flex-col gap-6">
        <MemoryDetail
          item={selected}
          onBack={() => setSelectedId(null)}
          onPatched={patchLocal}
          onDeleted={() => {
            setSelectedId(null)
            load()
          }}
        />
        <MemoryComposer scopeMemoryId={selected.id} onApplied={load} />
      </div>
    )
  }

  // ── List view ──
  const active = memories.filter((m) => m.isActive !== false)
  const inactive = memories.filter((m) => m.isActive === false)
  const activeGroups = sectionGroups
    .map((g) => ({
      ...g,
      rows: active.filter((m) => m.section === g.section)
    }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection>
        <SettingsRow
          label={t('memory.settings.autoCapture.label')}
          description={t('memory.settings.autoCapture.description')}
        >
          <Controller
            control={form.control}
            name="memory.autoCapture"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>

        <SettingsRow
          label={t('memory.settings.useInChat.label')}
          description={t('memory.settings.useInChat.description')}
        >
          <Controller
            control={form.control}
            name="memory.useInChat"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>

        <SettingsRow
          label={t('memory.settings.lcmEnabled.label')}
          description={t('memory.settings.lcmEnabled.description')}
        >
          <Controller
            control={form.control}
            name="memory.lcmEnabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>

        {lcmEnabled && (
          <>
            <Controller
              control={form.control}
              name="memory.contextWindowPercent"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('memory.settings.contextWindowPercent.label')}
                  description={t(
                    'memory.settings.contextWindowPercent.description'
                  )}
                  error={fieldState.error}
                >
                  <InputGroup>
                    <InputGroupInput
                      placeholder="75"
                      type="number"
                      min={50}
                      max={95}
                      className="w-14"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                    <InputGroupAddon align="inline-end">%</InputGroupAddon>
                  </InputGroup>
                </SettingsRow>
              )}
            />

            <Controller
              control={form.control}
              name="memory.freshTailSize"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('memory.settings.freshTailSize.label')}
                  description={t('memory.settings.freshTailSize.description')}
                  error={fieldState.error}
                >
                  <Input
                    placeholder="16"
                    type="number"
                    min={8}
                    max={64}
                    className="w-20"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </SettingsRow>
              )}
            />
          </>
        )}
      </SettingsSection>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">
            {t('memory.settings.storedMemoriesHeading')}
            <span className="text-muted-foreground ml-1.5 text-xs font-normal tabular-nums">
              {memories.length}
            </span>
          </h2>
          <Button type="button" size="sm" variant="outline" onClick={handleNew}>
            <PlusIcon className="mr-1 size-3.5" data-icon />
            {t('memory.settings.newButton')}
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : memories.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            {t('memory.settings.emptyState')}
          </div>
        ) : (
          <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
            {activeGroups.map((g) => (
              <div key={g.section}>
                <p className="text-muted-foreground px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
                  {g.label}
                </p>
                {g.rows.map((m) => (
                  <MemoryRow
                    key={m.id}
                    item={m}
                    onOpen={() => setSelectedId(m.id)}
                    onToggle={() => handleToggle(m)}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            ))}

            {inactive.length > 0 && (
              <div>
                <p className="text-muted-foreground/70 px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
                  {t('memory.settings.disabledHeading', {
                    count: inactive.length
                  })}
                </p>
                {inactive.map((m) => (
                  <MemoryRow
                    key={m.id}
                    item={m}
                    onOpen={() => setSelectedId(m.id)}
                    onToggle={() => handleToggle(m)}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <MemoryComposer onApplied={load} />
      </div>
    </div>
  )
}
```

Notes:

- `MemoryComposer.submit()`'s local variable is renamed `t2` (was `t`)
  since the component now has its own real `t` from `useTranslation` in
  scope — the old local `const t = text.trim()` would now shadow the
  real translation function. This is exactly the shadowing hazard
  CLAUDE.md's "Adding a User-Facing String" step 8 warns about,
  encountered for real this time (not just a documented risk).
- `t('action.delete')` (in `MemoryRow`/`MemoryDetail`) keeps resolving
  unprefixed from `common` (listed first in the array form) — unchanged
  from before.
- `save`'s `useCallback` dependency array gains `t` (it now calls `t()`
  inside), matching the exhaustive-deps rule already followed elsewhere
  in this file for `load`.

- [ ] **Step 3: Append namespace tests**

Add to `tests/unit/i18n/settings-namespace.test.ts`, inside the existing
`describe('settings namespace (en)', ...)` block (after the MCP Servers
test added by `settings-integrations-mcp`):

```ts
it('has the memory section-group and shared keys', () => {
  expect(settings.memory.sectionGroups).toMatchObject({
    profile: 'You',
    topic: 'Topics',
    person: 'People'
  })
  expect(settings.memory.genericRetryHint).toBe('Try again')
  expect(settings.memory.restoreLabel).toBe('Restore')
  expect(settings.memory.disableLabel).toBe('Disable')
})

it('has the memory row and detail keys', () => {
  expect(settings.memory.row.noSummaryYet).toBe('No summary yet')
  expect(settings.memory.detail).toMatchObject({
    backButton: 'Memory',
    titlePlaceholder: 'Title',
    summaryLabel: 'Summary',
    detailsLabel: 'Details'
  })
})

it('has the memory composer keys with real pluralization', () => {
  expect(settings.memory.composer.toast).toMatchObject({
    updatedDescription_one: '{{count}} change applied',
    updatedDescription_other: '{{count}} changes applied'
  })
})

it('has the memory settings tab keys', () => {
  expect(settings.memory.settings.autoCapture.label).toBe('Capture memories')
  expect(settings.memory.settings.newMemoryDefaultKey).toBe('New memory')
  expect(settings.memory.settings.disabledHeading).toBe('Disabled · {{count}}')
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

Manually grep-verify zero missing/orphaned `memory.*` keys in
`settings.json` vs. `memory.tsx`.

Re-check `git status --porcelain` and revert (`git checkout --`) any
file outside this task's scope that `pnpm format` incidentally touched.

```bash
git add src/renderer/components/settings/settings-form/memory.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "i18n: populate settings namespace's memory tab, closing out Phase 2"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-integrations-memory.md
git commit -m "docs: add settings-integrations-memory i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
