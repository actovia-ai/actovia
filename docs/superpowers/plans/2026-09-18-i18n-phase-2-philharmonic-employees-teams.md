# Philharmonic i18n Phase 2 — `employees/` + `teams/` (sub-plan 4/5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `philharmonic` i18n namespace's `employees.*` and
`teams.*` sections — the 4th of 5 sub-plans covering the `philharmonic`
namespace (see `docs/superpowers/plans/2026-09-18-i18n-phase-2-
philharmonic-container.md` for the namespace-wide design decisions this
plan inherits).

**Architecture:** Extract every hardcoded UI string in
`components/philharmonic/employees/{employee-avatar,avatar-picker,
employee-editor}.tsx` and `components/philharmonic/teams/team-editor.tsx`
into two new top-level sections of `src/shared/i18n/locales/en/
philharmonic.json`: `employees.*` (covering all 3 `employees/` files) and
`teams.*` (covering `team-editor.tsx`). No `<Trans>` blocks are needed in
this sub-plan — every string is plain prose, no embedded rich-text markup.

**Tech Stack:** React 19, react-i18next, i18next, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- **Pre-commit gate:** `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm i18n:check` → `pnpm test` must all pass before any commit.
- **English is the source catalog.** Every new key goes into
  `src/shared/i18n/locales/en/philharmonic.json` only — non-English
  catalogs are filled by the Phase 3 machine-translation pass, never
  hand-edited here.
- **Component:** `const { t } = useTranslation('philharmonic')`; array
  form `useTranslation(['common', 'philharmonic'])` when a file already
  uses `common` (existing namespace listed FIRST, unchanged bare
  `t('action.*')` calls keep resolving; new lookups get the
  `philharmonic:` prefix).
- **DiceBear style ids are proper nouns, never translated** —
  `AVATAR_STYLES` (`'notionists' | 'thumbs' | 'adventurer'`, defined in
  `src/shared/constants/avatar.ts`) stay hardcoded in
  `avatar-picker.tsx`'s `<span className="capitalize">{s}</span>`, same
  precedent as `AiProviders` enum values and provider-tab labels in the
  `settings-providers` sub-plan.
- **Per-section field labels are NOT shared across `employees.editor.*`
  and `teams.editor.*`** even where the English text coincides ("Name",
  "Description", "System prompt") — same precedent as `schedule.form.*`
  keeping its own field labels self-contained rather than reaching into
  a shared generic-labels section. Each section owns its own copy so a
  future translator can phrase an employee's vs. a team's field
  differently if the target language calls for it.
- **No tooling catches a stale/orphaned English catalog key** —
  `catalog-audit.ts`'s check only flags a non-en locale missing a key
  present in `en`, never the reverse. Manually grep/script-verify zero
  missing AND zero orphaned `employees.*`/`teams.*` keys before
  considering this sub-plan done.
- **Stray `node_modules/node_modules` symlink**: if any test run reports
  "Invalid hook call" or a `null` `useMemo` crash, run `ls -la
  node_modules/node_modules` first — a stray symlink into an unrelated
  sibling project has caused this exact spurious failure multiple times
  this rollout (see the `stray-node-modules-symlink-incident` memory).
  Fix with `rm node_modules/node_modules` (safe — it only removes the
  symlink, never its target) and re-run.
- **Known flaky test**: a PGlite WASM teardown race
  (`RuntimeError: Aborted()`) can surface on an otherwise fully-passing
  suite. If the ONLY failure matches that pattern, retry `pnpm test`
  once before investigating further.
- **`pnpm format`/`oxfmt .` reformats the WHOLE repo**, including
  already-committed, unrelated files it happens to touch (this has hit
  two older plan docs in the previous sub-plan). After running the full
  gate, re-check `git status --porcelain` and `git checkout --` any
  file outside this plan's intended scope before staging.
- **Shared, concurrently-edited working tree**: re-run `git status
  --porcelain` for this plan's 4 target files immediately before
  starting — confirmed clean as of survey time, but another session has
  repeatedly touched unrelated files throughout this rollout.

---

### Task 1: Populate `employees.*` and `teams.*`, verify, commit

**Files:**

- Modify: `src/renderer/components/philharmonic/employees/employee-avatar.tsx`
- Modify: `src/renderer/components/philharmonic/employees/avatar-picker.tsx`
- Modify: `src/renderer/components/philharmonic/employees/employee-editor.tsx`
- Modify: `src/renderer/components/philharmonic/teams/team-editor.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Modify: `tests/unit/i18n/philharmonic-namespace.test.ts`

**Interfaces:**

- Consumes: the existing `philharmonic` namespace's established `t`/
  `i18n.t` conventions (no new patterns introduced this sub-plan).
- Produces: `employees.avatar.alt`, `employees.picker.reroll`,
  `employees.editor.*` (header + fields), `teams.editor.*` (header +
  fields) — no other sub-plan depends on these keys.

- [ ] **Step 1: Add `employees` and `teams` sections to `philharmonic.json`**

Add these two new top-level keys (after the existing `chat` section):

```json
  "employees": {
    "avatar": {
      "alt": "avatar"
    },
    "picker": {
      "reroll": "Reroll"
    },
    "editor": {
      "header": {
        "label": "Employee",
        "newFallback": "New employee"
      },
      "avatarAria": "Edit avatar",
      "fields": {
        "name": "Name",
        "team": "Team",
        "teamPlaceholder": "Select a team",
        "teamHelp": "Every employee belongs to a team — the team's system prompt is applied to all its members.",
        "description": "Description",
        "descriptionPlaceholder": "One line about what this employee does.",
        "systemPrompt": "System prompt",
        "systemPromptPlaceholder": "Layered on top of the team's prompt.",
        "skills": "Skills",
        "noSkills": "No skills installed yet.",
        "mcpServers": "MCP servers",
        "noMcpServers": "No MCP servers configured yet.",
        "mcpServersHelp": "If none are selected, the employee can use all available servers.",
        "memory": "Memory (read-only)",
        "noMemory": "No accumulated memory yet"
      }
    }
  },
  "teams": {
    "editor": {
      "header": {
        "label": "Team",
        "newFallback": "New team"
      },
      "fields": {
        "name": "Name",
        "icon": "Icon (emoji, optional)",
        "description": "Description",
        "descriptionPlaceholder": "Short summary of what this team does.",
        "systemPrompt": "System prompt",
        "systemPromptPlaceholder": "Shared instructions added to every member of this team's prompt."
      }
    }
  }
```

(The trailing `}` of `philharmonic.json`'s outer object moves to after
the new `teams` block; `chat`'s closing `}` gets a trailing comma.)

- [ ] **Step 2: Rewrite `employee-avatar.tsx`**

```tsx
import * as collection from '@dicebear/collection'
import { createAvatar } from '@dicebear/core'
import { DEFAULT_AVATAR_STYLE } from '@shared/constants/avatar'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { hueStyle, pickHue, type HueName } from '../lib/hue'

export function EmployeeAvatar({
  seed,
  style,
  size = 36,
  hue,
  ring = true,
  className
}: {
  seed: string | null
  style: string | null
  size?: number
  hue?: HueName
  ring?: boolean
  className?: string
}) {
  const { t } = useTranslation('philharmonic')
  const dataUri = useMemo(() => {
    const styleKey = (style ?? DEFAULT_AVATAR_STYLE) as keyof typeof collection
    const factory =
      collection[styleKey] ??
      collection[DEFAULT_AVATAR_STYLE as keyof typeof collection]
    return createAvatar(factory as never, {
      seed: seed ?? 'default'
    }).toDataUri()
  }, [seed, style])

  const resolvedHue = hue ?? pickHue(seed ?? 'default')
  const wrapperStyle = ring ? hueStyle(resolvedHue) : undefined

  return (
    <div
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      style={{ width: size, height: size, ...wrapperStyle }}
    >
      <img
        src={dataUri}
        width={size}
        height={size}
        className="rounded-full"
        alt={t('employees.avatar.alt')}
      />
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `avatar-picker.tsx`**

```tsx
import { AVATAR_STYLES, randomAvatarSeed } from '@shared/constants/avatar'
import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { EmployeeAvatar } from './employee-avatar'

export function AvatarPicker({
  seed,
  style,
  onChange
}: {
  seed: string | null
  style: string | null
  onChange: (next: { avatarSeed: string; avatarStyle: string }) => void
}) {
  const { t } = useTranslation('philharmonic')
  // Stabilize a fallback seed across renders. Without this, `seed ?? randomAvatarSeed()`
  // re-generates every render when the parent's seed is null, scrambling every tile.
  const [fallbackSeed] = useState(() => randomAvatarSeed())
  const currentSeed = seed ?? fallbackSeed
  const activeStyle = style ?? AVATAR_STYLES[0]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <EmployeeAvatar seed={currentSeed} style={activeStyle} size={64} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange({
              avatarSeed: randomAvatarSeed(),
              avatarStyle: activeStyle
            })
          }
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
          {t('employees.picker.reroll')}
        </Button>
      </div>
      <ToggleGroup
        value={[activeStyle]}
        onValueChange={(v) => {
          const next = v[0]
          if (!next) return
          onChange({ avatarSeed: currentSeed, avatarStyle: next })
        }}
        variant="outline"
        spacing={8}
        className="w-full"
      >
        {AVATAR_STYLES.map((s) => (
          <ToggleGroupItem
            key={s}
            value={s}
            className="h-auto flex-1 flex-col gap-1 px-2 py-2"
          >
            <EmployeeAvatar seed={currentSeed} style={s} size={48} />
            <span className="text-xs capitalize">{s}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
```

Note: `{s}` (the DiceBear style id) stays hardcoded — a proper noun, per
the Global Constraints.

- [ ] **Step 4: Rewrite `employee-editor.tsx`**

```tsx
// src/renderer/components/philharmonic/employees/employee-editor.tsx
import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
// NOTE: useEffect to sync draft from employee prop removed — key={employee.id}
// at the call site causes React to remount when the employee changes, so the
// useState initializer always receives the fresh value on mount.

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getMcpServers, type McpServerItem } from '@/services/mcp-service'
import {
  getAgentMemories,
  getAvailableSkills,
  getTeams
} from '@/services/philharmonic'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { AvatarPicker } from './avatar-picker'
import { EmployeeAvatar } from './employee-avatar'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1 text-[11px] tracking-wider uppercase">
      {children}
    </div>
  )
}

export function EmployeeEditor({
  employee,
  isNew = false,
  onSave,
  onClose
}: {
  employee: AgentData
  isNew?: boolean
  onSave: (data: Partial<AgentData>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const [draft, setDraft] = useState<AgentData>(employee)
  const [skills, setSkills] = useState<Array<{ slug: string; name: string }>>(
    []
  )
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [teams, setTeams] = useState<TeamData[]>([])
  const [memories, setMemories] = useState<
    Array<{ id: string; key: string; value: unknown }>
  >([])

  useEffect(() => {
    getAvailableSkills().then(setSkills)
    getMcpServers().then(setMcpServers)
    getTeams().then(setTeams)
    if (!isNew) {
      getAgentMemories(employee.id).then((m) => setMemories(m as never))
    }
  }, [employee.id, isNew])

  const canSave = draft.name.trim().length > 0 && Boolean(draft.teamId)

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-14 shrink-0 items-center border-b pr-14 pl-5">
        <div className="min-w-0">
          <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
            {t('philharmonic:employees.editor.header.label')}
          </div>
          <div className="text-foreground truncate text-sm font-semibold">
            {draft.name ||
              t('philharmonic:employees.editor.header.newFallback')}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {/* Avatar + name row */}
        <div className="flex items-center gap-4">
          <Popover>
            <PopoverTrigger
              aria-label={t('philharmonic:employees.editor.avatarAria')}
              className="relative inline-block"
            >
              <EmployeeAvatar
                seed={draft.avatarSeed}
                style={draft.avatarStyle}
                size={64}
              />
              <span
                className="bg-card absolute right-0 bottom-0 flex h-6 w-6 items-center justify-center rounded-full"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
              >
                <Pencil className="text-muted-foreground h-3 w-3" />
              </span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <AvatarPicker
                seed={draft.avatarSeed}
                style={draft.avatarStyle}
                onChange={(a) => setDraft({ ...draft, ...a })}
              />
            </PopoverContent>
          </Popover>
          <div className="flex-1">
            <FieldLabel>
              {t('philharmonic:employees.editor.fields.name')}
            </FieldLabel>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="border-border bg-muted rounded-lg"
            />
          </div>
        </div>

        {/* Team + Description */}
        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.team')}{' '}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Select
            value={draft.teamId ?? ''}
            onValueChange={(v) => setDraft({ ...draft, teamId: v })}
          >
            <SelectTrigger className="border-border bg-muted rounded-lg">
              <SelectValue
                placeholder={t(
                  'philharmonic:employees.editor.fields.teamPlaceholder'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.icon ? `${team.icon} ` : ''}
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('philharmonic:employees.editor.fields.teamHelp')}
          </p>
        </div>

        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.description')}
          </FieldLabel>
          <Input
            value={draft.description ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className="border-border bg-muted rounded-lg"
            placeholder={t(
              'philharmonic:employees.editor.fields.descriptionPlaceholder'
            )}
          />
        </div>

        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.systemPrompt')}
          </FieldLabel>
          <Textarea
            value={draft.systemPrompt ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, systemPrompt: e.target.value })
            }
            className="border-border bg-muted min-h-24 rounded-lg"
            placeholder={t(
              'philharmonic:employees.editor.fields.systemPromptPlaceholder'
            )}
          />
        </div>

        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.skills')}
          </FieldLabel>
          {skills.length === 0 ? (
            <span className="text-muted-foreground text-xs">
              {t('philharmonic:employees.editor.fields.noSkills')}
            </span>
          ) : (
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              spacing={4}
              value={draft.skillSlugs ?? []}
              onValueChange={(v) =>
                setDraft({ ...draft, skillSlugs: v as string[] })
              }
              className="flex-wrap"
            >
              {skills.map((s) => (
                <ToggleGroupItem key={s.slug} value={s.slug}>
                  {s.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>

        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.mcpServers')}
          </FieldLabel>
          {mcpServers.length === 0 ? (
            <span className="text-muted-foreground text-xs">
              {t('philharmonic:employees.editor.fields.noMcpServers')}
            </span>
          ) : (
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              spacing={4}
              value={draft.mcpServerNames ?? []}
              onValueChange={(v) =>
                setDraft({ ...draft, mcpServerNames: v as string[] })
              }
              className="flex-wrap"
            >
              {mcpServers.map((s) => (
                <ToggleGroupItem key={s.id} value={s.name}>
                  {s.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <p className="text-muted-foreground mt-1 text-xs">
            {t('philharmonic:employees.editor.fields.mcpServersHelp')}
          </p>
        </div>

        {!isNew && (
          <div>
            <FieldLabel>
              {t('philharmonic:employees.editor.fields.memory')}
            </FieldLabel>
            <div className="text-muted-foreground space-y-1 text-xs">
              {memories.length === 0 && (
                <span>
                  {t('philharmonic:employees.editor.fields.noMemory')}
                </span>
              )}
              {memories.map((m) => (
                <div key={m.id} className="bg-muted rounded-md p-1.5">
                  <b className="text-foreground">{m.key}</b>:{' '}
                  {JSON.stringify(m.value)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="border-border flex h-14 shrink-0 items-center justify-end gap-1.5 border-t px-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('action.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => canSave && onSave(draft)}
          disabled={!canSave}
        >
          {isNew ? t('action.create') : t('action.save')}
        </Button>
      </footer>
    </div>
  )
}
```

Note `t('action.cancel')`/`t('action.create')`/`t('action.save')` keep
resolving unprefixed from `common` (still listed first in the array
form) — unchanged from before.

- [ ] **Step 5: Rewrite `team-editor.tsx`**

```tsx
// src/renderer/components/philharmonic/teams/team-editor.tsx
// NOTE: useEffect to sync draft from team prop removed — key={team.id} at the
// call site causes React to remount when the team changes, so the useState
// initializer always receives the fresh value on mount.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { TeamData } from '@/stores/philharmonic'

export interface TeamEditorProps {
  team: TeamData
  isNew?: boolean
  onClose: () => void
  onSave: (data: Partial<TeamData>) => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1 text-[11px] tracking-wider uppercase">
      {children}
    </div>
  )
}

export function TeamEditor({
  team,
  isNew = false,
  onClose,
  onSave
}: TeamEditorProps) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const [draft, setDraft] = useState<TeamData>(team)
  const canSave = draft.name.trim().length > 0

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-14 shrink-0 items-center border-b pr-14 pl-5">
        <div className="min-w-0">
          <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
            {t('philharmonic:teams.editor.header.label')}
          </div>
          <div className="text-foreground truncate text-sm font-semibold">
            {draft.name || t('philharmonic:teams.editor.header.newFallback')}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div>
          <FieldLabel>
            {t('philharmonic:teams.editor.fields.name')}{' '}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="border-border bg-muted rounded-lg"
          />
        </div>
        <div>
          <FieldLabel>{t('philharmonic:teams.editor.fields.icon')}</FieldLabel>
          <Input
            value={draft.icon ?? ''}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            maxLength={4}
            className="border-border bg-muted rounded-lg"
          />
        </div>
        <div>
          <FieldLabel>
            {t('philharmonic:teams.editor.fields.description')}
          </FieldLabel>
          <Textarea
            value={draft.description ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className="border-border bg-muted min-h-20 rounded-lg"
            placeholder={t(
              'philharmonic:teams.editor.fields.descriptionPlaceholder'
            )}
          />
        </div>
        <div>
          <FieldLabel>
            {t('philharmonic:teams.editor.fields.systemPrompt')}
          </FieldLabel>
          <Textarea
            value={draft.systemPrompt ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, systemPrompt: e.target.value })
            }
            className="border-border bg-muted min-h-40 rounded-lg"
            placeholder={t(
              'philharmonic:teams.editor.fields.systemPromptPlaceholder'
            )}
          />
        </div>
      </div>

      <footer className="border-border flex h-14 shrink-0 items-center justify-end gap-1.5 border-t px-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('action.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => canSave && onSave(draft)}
          disabled={!canSave}
        >
          {isNew ? t('action.create') : t('action.save')}
        </Button>
      </footer>
    </div>
  )
}
```

- [ ] **Step 6: Append namespace tests**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block:

```ts
it('has the employees avatar and picker keys', () => {
  expect(philharmonic.employees.avatar.alt).toBe('avatar')
  expect(philharmonic.employees.picker.reroll).toBe('Reroll')
})

it('has the employee editor keys', () => {
  expect(philharmonic.employees.editor.header).toMatchObject({
    label: 'Employee',
    newFallback: 'New employee'
  })
  expect(philharmonic.employees.editor.fields).toMatchObject({
    name: 'Name',
    team: 'Team',
    teamPlaceholder: 'Select a team',
    description: 'Description',
    systemPrompt: 'System prompt',
    skills: 'Skills',
    mcpServers: 'MCP servers',
    memory: 'Memory (read-only)'
  })
})

it('has the team editor keys, self-contained from employees.editor', () => {
  expect(philharmonic.teams.editor.header).toMatchObject({
    label: 'Team',
    newFallback: 'New team'
  })
  expect(philharmonic.teams.editor.fields).toMatchObject({
    name: 'Name',
    icon: 'Icon (emoji, optional)',
    description: 'Description',
    systemPrompt: 'System prompt'
  })
  // Same English text as employees.editor.fields.* by coincidence, but a
  // deliberately separate key per section (see Global Constraints) — not
  // the same catalog value reference.
  expect(philharmonic.teams.editor.fields.name).toBe(
    philharmonic.employees.editor.fields.name
  )
})
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

Manually grep-verify zero missing/orphaned `employees.*`/`teams.*` keys
across the 4 modified component files vs. `philharmonic.json`.

Re-check `git status --porcelain` and revert (`git checkout --`) any
file outside this task's scope that `pnpm format` incidentally touched.

```bash
git add src/renderer/components/philharmonic/employees/employee-avatar.tsx \
  src/renderer/components/philharmonic/employees/avatar-picker.tsx \
  src/renderer/components/philharmonic/employees/employee-editor.tsx \
  src/renderer/components/philharmonic/teams/team-editor.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's employees and teams editors (sub-plan 4/5)"
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
Expected: all green. Revert any incidental unrelated-file reformat
before it would be staged (there is nothing left to stage at this
point, so this is just a final confirmation the tree is clean).

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-philharmonic-employees-teams.md
git commit -m "docs: add philharmonic-employees-teams i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
