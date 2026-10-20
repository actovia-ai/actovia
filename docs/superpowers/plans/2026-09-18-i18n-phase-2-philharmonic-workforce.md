# Philharmonic i18n Phase 2 — `workforce/` + `cost-analysis.tsx` (sub-plan 5/5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `philharmonic` i18n namespace's `costAnalysis.*` and
`workforce.*` sections — the 5th and FINAL sub-plan covering the
`philharmonic` namespace (see `docs/superpowers/plans/2026-09-18-i18n-
phase-2-philharmonic-container.md` for the namespace-wide design decisions
this plan inherits). This is also where `empty-state.tsx`'s 4th and final
real call site lives (`WorkforcePage`'s "Start with a team" empty state).

**Architecture:** Extract every hardcoded UI string in
`components/philharmonic/cost-analysis.tsx` and `components/philharmonic/
workforce/workforce-page.tsx` into two new top-level sections of
`src/shared/i18n/locales/en/philharmonic.json`: `costAnalysis.*` and
`workforce.*`. Two `<Trans>` blocks are needed in `workforce-page.tsx`
(the employee- and team-delete confirmation descriptions, each wrapping a
dynamic name in a styled `<span>`) — both follow the established
extract-to-exported-component pattern.

**Tech Stack:** React 19, react-i18next, i18next, TypeScript, Vitest,
Recharts.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- **Pre-commit gate:** `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm i18n:check` → `pnpm test` must all pass before any commit.
- **English is the source catalog.** Every new key goes into
  `src/shared/i18n/locales/en/philharmonic.json` only.
- **Component:** `const { t } = useTranslation('philharmonic')`; array
  form `useTranslation(['common', 'philharmonic'])` when a file already
  uses `common` (existing namespace listed FIRST, unchanged bare
  `t('action.*')` calls keep resolving; new lookups get the
  `philharmonic:` prefix).
- **`<Trans>` numbered-placeholder rule**: a numbered placeholder `<N>`
  indexes a child's RAW 0-indexed position in the FULL `<Trans>` children
  array — text nodes and an explicit `{' '}` each occupy their own index.
  For each of this plan's 2 `<Trans>` blocks (both a single `<span>`
  followed by `{' '}` then plain text), extract into its own EXPORTED
  component and empirically verify the index via a real compiled-children
  dump (esbuild + `React.Children.forEach`) AFTER running `pnpm format` —
  never trust a hand-written draft's structure, and never hand-copy
  children into a test (render the real exported component instead).
- **Section-local field/label copy is NOT shared across different UI
  roles or different sections**, even where English text coincides —
  same precedent as `employees.editor.fields.*` vs. `teams.editor.fields.*`
  staying separate. This plan deliberately keeps THREE pre-existing,
  differently-worded "no team assigned" style labels separate rather than
  reconciling them:
  - `chat.membersPanel.noTeam` ("No team") — an inline status fragment
    inside a busy/idle line in the Group members panel.
  - `chat.membersPanel.unassignedLabel` ("Unassigned") — a _section
    header_ for the unassigned-agents bucket, scoped to one Group.
  - `workforce.teamSection.unassignedFallback` ("No team", NEW this
    plan) — a _section header_ for the unassigned-agents bucket in the
    workforce-wide roster (all employees, not one Group).
    These are a genuine pre-existing copy inconsistency (the same UI role —
    an unassigned-bucket section header — worded two different ways in two
    different screens) — flagged here for awareness, NOT silently
    reconciled; changing user-visible wording is a product decision outside
    an i18n extraction pass's scope.
- **Two generic toast templates ARE deliberately shared within
  `workforce.*`**: `toast.created` (`"{{name}}" created`) and
  `toast.deleted` (`"{{name}}" deleted`) are reused by both the employee
  and team create/delete flows in the same file — the template has no
  entity-specific wording, unlike the failure toasts
  (`saveEmployeeFailed`/`saveTeamFailed` etc., which DO differ per entity
  and stay separate).
- **Already-formatted display strings interpolate as opaque templates,
  not real plurals** — `agentCostList.tokens` (`"{{tokens}} tokens"`)
  takes `formatTokens()`'s already-compacted output (e.g. `"1.2K"`) as a
  string param, same precedent as `webSearch.videoCard.views`. Real
  i18next pluralization (`_one`/`_other` + `{{count}}`) is used instead
  wherever the plan interpolates a raw, un-formatted count (e.g.
  `workforce.header.employeeCount`, `costAnalysis.kpi.totalCostHint`).
- **`chartConfig`** (currently a module-level `const` in `cost-analysis.tsx`)
  moves inside the `CostAnalysis` component as a `useMemo(() => ({...}),
  [t])`, since its `label: 'Cost'` field needs translation — same pattern
  as prior sub-plans' single-consumer module constants.
- **No tooling catches a stale/orphaned English catalog key** — manually
  grep/script-verify zero missing AND zero orphaned
  `costAnalysis.*`/`workforce.*` keys before considering this sub-plan
  (and, since it's the last one, the WHOLE `philharmonic` namespace) done.
- **Stray `node_modules/node_modules` symlink**: if any test run reports
  "Invalid hook call" or a `null` `useMemo` crash, run `ls -la
  node_modules/node_modules` first (see the
  `stray-node-modules-symlink-incident` memory) and `rm` it if present.
- **Known flaky test**: retry `pnpm test` once if the ONLY failure is the
  PGlite WASM teardown race (`RuntimeError: Aborted()`).
- **`pnpm format`/`oxfmt .` reformats the WHOLE repo**, including
  already-committed, unrelated files it happens to touch. After running
  the full gate, re-check `git status --porcelain` and `git checkout --`
  any file outside this plan's intended scope before staging.
- **Shared, concurrently-edited working tree**: re-run `git status
  --porcelain` for this plan's 3 target files (`cost-analysis.tsx`,
  `workforce/workforce-page.tsx`, `empty-state.tsx` — the last untouched
  code-wise but its 4th call site is populated here) immediately before
  starting.

---

### Task 1: Populate `costAnalysis.*`, rewrite `cost-analysis.tsx`

**Files:**

- Modify: `src/renderer/components/philharmonic/cost-analysis.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Modify: `tests/unit/i18n/philharmonic-namespace.test.ts`

**Interfaces:**

- Produces: `costAnalysis.*` — consumed only within this file.

- [ ] **Step 1: Add the `costAnalysis` section to `philharmonic.json`**

Add this new top-level key (after the existing `teams` section):

```json
  "costAnalysis": {
    "header": {
      "title": "Dashboard"
    },
    "period": {
      "last7Days": "Last 7 days",
      "last30Days": "Last 30 days",
      "allTime": "All time"
    },
    "periodToggle": {
      "sevenDays": "7d",
      "thirtyDays": "30d",
      "all": "All"
    },
    "loading": "Loading usage data…",
    "kpi": {
      "totalCost": "Total cost",
      "totalCostHint_one": "Across {{count}} employee",
      "totalCostHint_other": "Across {{count}} employees",
      "tokens": "Tokens",
      "tokensHint": "Total processed",
      "employees": "Employees",
      "employeesHint": "With recorded usage",
      "conversations": "Conversations",
      "conversationsHint": "With activity"
    },
    "chart": {
      "costLabel": "Cost",
      "sectionTitle": "Cost over time"
    },
    "agentCostList": {
      "title": "Cost by employee",
      "empty": "No employee usage data yet",
      "tokens": "{{tokens}} tokens"
    },
    "conversationCostList": {
      "title": "Cost by conversation",
      "empty": "No conversation usage data yet"
    }
  }
```

(`teams`'s closing `}` gets a trailing comma; `costAnalysis`'s closing `}`
becomes the new last section before `workforce` is added in Task 2.)

- [ ] **Step 2: Rewrite `cost-analysis.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getAgents } from '@/services/philharmonic'
import {
  getPhilharmonicCosts,
  type PhilharmonicCostSummary
} from '@/services/philharmonic-chat'
import type { AgentData } from '@/stores/philharmonic'

import { EmployeeAvatar } from './employees/employee-avatar'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCost(usd: number) {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  hint
}: {
  label: string
  value: string
  icon: string
  iconBg: string
  iconColor: string
  hint?: string
}) {
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="mb-2 flex items-start justify-between">
        <span className="text-muted-foreground text-[11.5px]">{label}</span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </span>
      </div>
      <div className="text-foreground text-[22px] font-bold tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div>
      )}
    </div>
  )
}

// ─── Employee cost row ───────────────────────────────────────────────────────

function AgentCostList({
  rows,
  agentsById
}: {
  rows: PhilharmonicCostSummary['byAgent']
  agentsById: Record<string, AgentData>
}) {
  const { t } = useTranslation('philharmonic')
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="text-foreground mb-2 text-[12.5px] font-semibold">
        {t('costAnalysis.agentCostList.title')}
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-xs">
          {t('costAnalysis.agentCostList.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const agent = agentsById[r.agentId]
            const label = agent ? agent.name : `${r.agentId.slice(0, 8)}…`
            return (
              <div
                key={r.agentId}
                className="bg-card flex items-center gap-2.5 rounded-lg px-2 py-2"
              >
                {agent ? (
                  <EmployeeAvatar
                    seed={agent.avatarSeed}
                    style={agent.avatarStyle}
                    size={30}
                  />
                ) : (
                  <div className="bg-background h-[30px] w-[30px] rounded-full" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-xs font-semibold">
                    {label}
                  </div>
                  <div className="text-muted-foreground text-[10.5px]">
                    {t('costAnalysis.agentCostList.tokens', {
                      tokens: formatTokens(r.tokens)
                    })}
                  </div>
                </div>
                <div className="text-foreground text-xs font-semibold tabular-nums">
                  {formatCost(r.cost)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConversationCostList({
  rows
}: {
  rows: PhilharmonicCostSummary['byConversation']
}) {
  const { t } = useTranslation('philharmonic')
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="text-foreground mb-2 text-[12.5px] font-semibold">
        {t('costAnalysis.conversationCostList.title')}
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-xs">
          {t('costAnalysis.conversationCostList.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div
              key={r.conversationId}
              className="bg-card flex items-center gap-2.5 rounded-lg px-2 py-2"
            >
              <div className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[10.5px]">
                {r.conversationId.slice(0, 12)}…
              </div>
              <div className="text-muted-foreground text-[10.5px] tabular-nums">
                {formatTokens(r.tokens)}
              </div>
              <div className="text-foreground text-xs font-semibold tabular-nums">
                {formatCost(r.cost)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | 'all'

export function CostAnalysis() {
  const { t } = useTranslation('philharmonic')
  const [data, setData] = useState<PhilharmonicCostSummary | null>(null)
  const [agentsById, setAgentsById] = useState<Record<string, AgentData>>({})
  const [period, setPeriod] = useState<Period>('all')

  const chartConfig = useMemo(
    () =>
      ({
        cost: {
          label: t('costAnalysis.chart.costLabel'),
          color: 'var(--primary)'
        }
      }) satisfies ChartConfig,
    [t]
  )

  const load = useCallback(async () => {
    const [costs, agents] = await Promise.all([
      getPhilharmonicCosts(),
      getAgents()
    ])
    setData(costs)
    setAgentsById(Object.fromEntries(agents.map((a) => [a.id, a])))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!data) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {t('costAnalysis.loading')}
      </div>
    )
  }

  const agentCount = data.byAgent.length
  const periodLabel =
    period === '7d'
      ? t('costAnalysis.period.last7Days')
      : period === '30d'
        ? t('costAnalysis.period.last30Days')
        : t('costAnalysis.period.allTime')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border flex h-13 shrink-0 items-center justify-between border-b px-5">
        <div>
          <h1 className="text-foreground text-sm font-semibold">
            {t('costAnalysis.header.title')}
          </h1>
          <p className="text-muted-foreground text-[11.5px]">{periodLabel}</p>
        </div>
        <ToggleGroup
          value={[period]}
          onValueChange={(v) => {
            const next = (v as string[])[0]
            if (next) setPeriod(next as Period)
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="7d">
            {t('costAnalysis.periodToggle.sevenDays')}
          </ToggleGroupItem>
          <ToggleGroupItem value="30d">
            {t('costAnalysis.periodToggle.thirtyDays')}
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            {t('costAnalysis.periodToggle.all')}
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {/* KPI grid */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <KpiCard
            label={t('costAnalysis.kpi.totalCost')}
            value={formatCost(data.totalCost)}
            icon="$"
            iconBg="var(--accent)"
            iconColor="var(--accent-foreground)"
            hint={t('costAnalysis.kpi.totalCostHint', { count: agentCount })}
          />
          <KpiCard
            label={t('costAnalysis.kpi.tokens')}
            value={formatTokens(data.totalTokens)}
            icon="⚡"
            iconBg="var(--ph-hue-lilac-fill)"
            iconColor="var(--ph-hue-lilac-ring)"
            hint={t('costAnalysis.kpi.tokensHint')}
          />
          <KpiCard
            label={t('costAnalysis.kpi.employees')}
            value={agentCount.toLocaleString()}
            icon="👥"
            iconBg="var(--ph-hue-sky-fill)"
            iconColor="var(--ph-hue-sky-ring)"
            hint={t('costAnalysis.kpi.employeesHint')}
          />
          <KpiCard
            label={t('costAnalysis.kpi.conversations')}
            value={data.byConversation.length.toLocaleString()}
            icon="💬"
            iconBg="var(--ph-hue-peach-fill)"
            iconColor="var(--ph-hue-peach-ring)"
            hint={t('costAnalysis.kpi.conversationsHint')}
          />
        </div>

        {/* Daily chart */}
        {data.daily.length > 1 && (
          <div className="bg-muted mb-4 rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-foreground text-[12.5px] font-semibold">
                {t('costAnalysis.chart.sectionTitle')}
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
                <span className="bg-primary inline-block h-2 w-2 rounded-full" />
                {t('costAnalysis.chart.costLabel')}
              </div>
            </div>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[200px] w-full"
            >
              <AreaChart data={data.daily}>
                <defs>
                  <linearGradient id="ph-cost-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--primary)"
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--primary)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)}
                  style={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={56}
                  style={{ fontSize: 11 }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => v}
                      indicator="dot"
                    />
                  }
                />
                <Area
                  dataKey="cost"
                  type="natural"
                  fill="url(#ph-cost-fill)"
                  stroke="var(--primary)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}

        {/* Breakdown lists */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <AgentCostList rows={data.byAgent} agentsById={agentsById} />
          <ConversationCostList rows={data.byConversation} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Append namespace tests**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block:

```ts
it('has the cost analysis header, period, and kpi keys', () => {
  expect(philharmonic.costAnalysis.header.title).toBe('Dashboard')
  expect(philharmonic.costAnalysis.period).toMatchObject({
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
    allTime: 'All time'
  })
  expect(philharmonic.costAnalysis.periodToggle).toMatchObject({
    sevenDays: '7d',
    thirtyDays: '30d',
    all: 'All'
  })
  expect(philharmonic.costAnalysis.kpi).toMatchObject({
    totalCostHint_one: 'Across {{count}} employee',
    totalCostHint_other: 'Across {{count}} employees'
  })
})

it('has the cost analysis chart and list keys', () => {
  expect(philharmonic.costAnalysis.chart).toMatchObject({
    costLabel: 'Cost',
    sectionTitle: 'Cost over time'
  })
  expect(philharmonic.costAnalysis.agentCostList).toMatchObject({
    title: 'Cost by employee',
    empty: 'No employee usage data yet',
    tokens: '{{tokens}} tokens'
  })
  expect(philharmonic.costAnalysis.conversationCostList).toMatchObject({
    title: 'Cost by conversation',
    empty: 'No conversation usage data yet'
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

Re-check `git status --porcelain` and revert (`git checkout --`) any
file outside this task's scope that `pnpm format` incidentally touched.

```bash
git add src/renderer/components/philharmonic/cost-analysis.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's cost analysis dashboard (sub-plan 5a/5)"
```

---

### Task 2: Populate `workforce.*`, rewrite `workforce-page.tsx`, close out `empty-state.tsx`'s 4th call site

**Files:**

- Modify: `src/renderer/components/philharmonic/workforce/workforce-page.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Modify: `tests/unit/i18n/philharmonic-namespace.test.ts`

**Interfaces:**

- Produces: `workforce.*` — consumed only within this file.
- `empty-state.tsx` itself is NOT modified (it's purely prop-driven,
  confirmed in `philharmonic-container`'s sub-plan) — this task supplies
  its 4th and final real `title`/`description`/`action.label` call site.

- [ ] **Step 1: Add the `workforce` section to `philharmonic.json`**

Add this new top-level key (after the `costAnalysis` section added in
Task 1):

```json
  "workforce": {
    "header": {
      "title": "Workforce",
      "employeeCount_one": "{{count}} employee",
      "employeeCount_other": "{{count}} employees",
      "teamCount_one": "{{count}} team",
      "teamCount_other": "{{count}} teams",
      "addTeamButton": "Team",
      "addEmployeeButton": "Employee",
      "createTeamFirstTitle": "Create a team first"
    },
    "emptyState": {
      "title": "Start with a team",
      "description": "Every employee belongs to a team that contributes a shared system prompt. Create a team first, then add the employees that belong to it.",
      "createButton": "+ New team"
    },
    "teamSection": {
      "editTeam": "Edit team",
      "addEmployeeHere": "Add employee here",
      "deleteTeam": "Delete team",
      "unassignedFallback": "No team",
      "addEmployeeButton": "Add employee"
    },
    "newEmployeeDefaultName": "New Employee",
    "newTeamDefaultName": "New Team",
    "deleteEmployeeDialog": {
      "title": "Delete this employee?",
      "description": "<0>{{name}}</0> will be permanently removed along with their accumulated memory."
    },
    "deleteTeamDialog": {
      "title": "Delete this team?",
      "description": "<0>{{name}}</0> will be removed. Existing members keep their records but lose this team affiliation."
    },
    "toast": {
      "created": "\"{{name}}\" created",
      "deleted": "\"{{name}}\" deleted",
      "saveEmployeeFailed": "Could not save the employee",
      "deleteEmployeeFailed": "Could not delete the employee",
      "saveTeamFailed": "Could not save the team",
      "deleteTeamFailed": "Could not delete the team"
    }
  }
```

(`costAnalysis`'s closing `}` gets a trailing comma; `workforce`'s closing
`}` becomes `philharmonic.json`'s final section — this completes the
namespace's file-area coverage.)

Like `container.newGroupDefaultTitle`, `newEmployeeDefaultName`/
`newTeamDefaultName` are resolved once at draft-creation time and may be
persisted (if the user never renames it before saving) — they freeze at
creation-time locale, same precedent, never treat as a re-translatable
sentinel later.

- [ ] **Step 2: Rewrite `workforce-page.tsx`**

```tsx
// src/renderer/components/philharmonic/workforce/workforce-page.tsx
import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@shared/constants/avatar'
import {
  Building2Icon,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UsersIcon
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { EmployeeAvatar } from '@/components/philharmonic/employees/employee-avatar'
import { EmployeeEditor } from '@/components/philharmonic/employees/employee-editor'
import { PhilharmonicEmptyState } from '@/components/philharmonic/empty-state'
import { hueStyle, pickHue } from '@/components/philharmonic/lib/hue'
import { TeamEditor } from '@/components/philharmonic/teams/team-editor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import {
  createAgentApi,
  createTeamApi,
  deleteAgentApi,
  deleteTeamApi,
  getAgents,
  getTeams,
  updateAgentApi,
  updateTeamApi
} from '@/services/philharmonic'
import type { AgentData, TeamData } from '@/stores/philharmonic'

const UNASSIGNED_KEY = '__unassigned__'

interface EmployeeCardProps {
  employee: AgentData
  onEdit: (e: AgentData) => void
  onAskDelete: (e: AgentData) => void
}

function EmployeeCard({ employee, onEdit, onAskDelete }: EmployeeCardProps) {
  const { t } = useTranslation('common')
  const modelChip = employee.model
  const tools = employee.toolAllowList ?? []
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          type="button"
          onClick={() => onEdit(employee)}
          className="group bg-muted hover:bg-accent flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
        >
          <EmployeeAvatar
            seed={employee.avatarSeed}
            style={employee.avatarStyle}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="text-foreground truncate text-sm font-semibold">
              {employee.name}
            </div>
            {employee.description && (
              <div className="text-muted-foreground line-clamp-2 text-[11.5px]">
                {employee.description}
              </div>
            )}
            {(modelChip || tools.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {modelChip && (
                  <span className="bg-accent text-accent-foreground rounded-md px-1.5 py-0.5 text-[10px]">
                    {modelChip}
                  </span>
                )}
                {tools.slice(0, 2).map((tool) => (
                  <span
                    key={tool}
                    className="bg-background text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px]"
                  >
                    {tool}
                  </span>
                ))}
                {tools.length > 2 && (
                  <span className="bg-background text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px]">
                    +{tools.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEdit(employee)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {t('action.edit')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onAskDelete(employee)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('action.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface TeamSectionProps {
  team: TeamData | null // null = unassigned
  members: AgentData[]
  collapsed: boolean
  onToggle: () => void
  onEditEmployee: (e: AgentData) => void
  onAskDeleteEmployee: (e: AgentData) => void
  onEditTeam?: (t: TeamData) => void
  onAskDeleteTeam?: (t: TeamData) => void
  onAddEmployeeToTeam: (teamId: string | null) => void
}

function TeamSection({
  team,
  members,
  collapsed,
  onToggle,
  onEditEmployee,
  onAskDeleteEmployee,
  onEditTeam,
  onAskDeleteTeam,
  onAddEmployeeToTeam
}: TeamSectionProps) {
  const { t } = useTranslation('philharmonic')
  const headerContent = (
    <button
      type="button"
      onClick={onToggle}
      className="hover:bg-background flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors"
    >
      <ChevronRight
        className={cn(
          'text-muted-foreground h-4 w-4 transition-transform',
          !collapsed && 'rotate-90'
        )}
      />
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base',
          !team && 'bg-background'
        )}
        style={team ? hueStyle(pickHue(team.id)) : undefined}
      >
        {team?.icon ??
          (team ? (
            <Building2Icon className="h-4 w-4 opacity-60" />
          ) : (
            <UsersIcon className="h-4 w-4 opacity-60" />
          ))}
      </span>
      <span className="text-foreground text-sm font-semibold">
        {team?.name ?? t('workforce.teamSection.unassignedFallback')}
      </span>
      <span className="bg-background text-muted-foreground ml-1 rounded-full px-2 py-0.5 text-[10px]">
        {members.length}
      </span>
      {team?.description && (
        <span className="text-muted-foreground ml-2 truncate text-xs">
          {team.description}
        </span>
      )}
    </button>
  )

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1">
        {team ? (
          <ContextMenu>
            <ContextMenuTrigger>{headerContent}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEditTeam?.(team)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t('workforce.teamSection.editTeam')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAddEmployeeToTeam(team.id)}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                {t('workforce.teamSection.addEmployeeHere')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => onAskDeleteTeam?.(team)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('workforce.teamSection.deleteTeam')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          headerContent
        )}
      </div>
      {!collapsed && (
        <div className="ml-10 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => (
            <EmployeeCard
              key={m.id}
              employee={m}
              onEdit={onEditEmployee}
              onAskDelete={onAskDeleteEmployee}
            />
          ))}
          {/* Always render an Add placeholder card unless this is the
              read-only Unassigned bucket (signaled by team === null). */}
          {team && (
            <button
              type="button"
              onClick={() => onAddEmployeeToTeam(team.id)}
              className="border-border text-muted-foreground hover:text-primary flex min-h-[88px] items-center justify-center gap-2 rounded-xl border-2 border-dashed text-xs transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('workforce.teamSection.addEmployeeButton')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function DeleteEmployeeDescription({ name }: { name: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="workforce.deleteEmployeeDialog.description"
      values={{ name }}
    >
      <span className="bg-background rounded-md px-1.5 py-0.5 font-mono text-xs">
        {name}
      </span>{' '}
      will be permanently removed along with their accumulated memory.
    </Trans>
  )
}

export function DeleteTeamDescription({ name }: { name: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="workforce.deleteTeamDialog.description"
      values={{ name }}
    >
      <span className="bg-background rounded-md px-1.5 py-0.5 font-mono text-xs">
        {name}
      </span>{' '}
      will be removed. Existing members keep their records but lose this team
      affiliation.
    </Trans>
  )
}

function emptyEmployeeDraft(teamId: string): AgentData {
  return {
    id: '',
    name: i18n.t('philharmonic:workforce.newEmployeeDefaultName'),
    description: null,
    teamId,
    avatarSeed: randomAvatarSeed(),
    avatarStyle: DEFAULT_AVATAR_STYLE,
    systemPrompt: null,
    toolAllowList: null,
    skillSlugs: null,
    mcpServerNames: null,
    model: null,
    provider: null,
    isActive: true,
    createdAt: '',
    updatedAt: ''
  }
}

function emptyTeamDraft(): TeamData {
  return {
    id: '',
    name: i18n.t('philharmonic:workforce.newTeamDefaultName'),
    description: '',
    systemPrompt: '',
    icon: null,
    createdAt: '',
    updatedAt: ''
  }
}

export function WorkforcePage() {
  const { t } = useTranslation(['common', 'philharmonic'])
  const [employees, setEmployees] = useState<AgentData[]>([])
  const [teams, setTeams] = useState<TeamData[]>([])
  // Editor states carry both the draft and an isNew flag so Save can dispatch
  // to either createXxxApi or updateXxxApi without us tracking two pairs of
  // booleans.
  const [employeeEditor, setEmployeeEditor] = useState<{
    draft: AgentData
    isNew: boolean
  } | null>(null)
  const [teamEditor, setTeamEditor] = useState<{
    draft: TeamData
    isNew: boolean
  } | null>(null)
  const [confirmingEmployee, setConfirmingEmployee] =
    useState<AgentData | null>(null)
  const [confirmingTeam, setConfirmingTeam] = useState<TeamData | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    [UNASSIGNED_KEY]: true
  })

  useEffect(() => {
    getAgents().then(setEmployees)
    getTeams().then(setTeams)
  }, [])

  const byTeam = useMemo(() => {
    const map = new Map<string, AgentData[]>()
    for (const team of teams) map.set(team.id, [])
    const unassigned: AgentData[] = []
    for (const e of employees) {
      if (e.teamId && map.has(e.teamId)) map.get(e.teamId)!.push(e)
      else unassigned.push(e)
    }
    return { map, unassigned }
  }, [employees, teams])

  const toggle = (key: string) =>
    setCollapsed((p) => ({ ...p, [key]: !p[key] }))

  // Open the editor sheet with an uncommitted draft. The actual API call
  // happens on Save, not on click.
  const openNewEmployee = (teamId?: string | null) => {
    const target = teamId ?? teams[0]?.id
    if (!target) return // guarded by disabled button, but defensive
    setEmployeeEditor({ draft: emptyEmployeeDraft(target), isNew: true })
  }

  const openNewTeam = () => {
    setTeamEditor({ draft: emptyTeamDraft(), isNew: true })
  }

  const handleSaveEmployee = async (data: Partial<AgentData>) => {
    if (!employeeEditor) return
    if (!data.teamId) return // guarded by editor's disabled Save
    try {
      if (employeeEditor.isNew) {
        const created = await createAgentApi(data)
        setEmployees((p) => [...p, created])
        sileo.success({
          title: t('philharmonic:workforce.toast.created', {
            name: created.name
          })
        })
      } else {
        const updated = await updateAgentApi(employeeEditor.draft.id, data)
        setEmployees((p) => p.map((x) => (x.id === updated.id ? updated : x)))
      }
      setEmployeeEditor(null)
    } catch (err) {
      sileo.error({
        title: t('philharmonic:workforce.toast.saveEmployeeFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const handleSaveTeam = async (data: Partial<TeamData>) => {
    if (!teamEditor) return
    try {
      if (teamEditor.isNew) {
        const created = await createTeamApi(data)
        setTeams((p) => [...p, created])
        sileo.success({
          title: t('philharmonic:workforce.toast.created', {
            name: created.name
          })
        })
      } else {
        const updated = await updateTeamApi(teamEditor.draft.id, data)
        setTeams((p) => p.map((x) => (x.id === updated.id ? updated : x)))
      }
      setTeamEditor(null)
    } catch (err) {
      sileo.error({
        title: t('philharmonic:workforce.toast.saveTeamFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const totalEmpty = employees.length === 0 && teams.length === 0
  const noTeams = teams.length === 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border flex h-13 shrink-0 items-center justify-between border-b px-5">
        <div>
          <h1 className="text-foreground text-sm font-semibold">
            {t('philharmonic:workforce.header.title')}
          </h1>
          <p className="text-muted-foreground text-[11.5px]">
            {t('philharmonic:workforce.header.employeeCount', {
              count: employees.length
            })}{' '}
            ·{' '}
            {t('philharmonic:workforce.header.teamCount', {
              count: teams.length
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={openNewTeam}>
            <Plus className="h-3.5 w-3.5" />
            {t('philharmonic:workforce.header.addTeamButton')}
          </Button>
          <Button
            size="sm"
            onClick={() => openNewEmployee()}
            disabled={noTeams}
            title={
              noTeams
                ? t('philharmonic:workforce.header.createTeamFirstTitle')
                : undefined
            }
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t('philharmonic:workforce.header.addEmployeeButton')}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {totalEmpty ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('philharmonic:workforce.emptyState.title')}
            description={t('philharmonic:workforce.emptyState.description')}
            action={{
              label: t('philharmonic:workforce.emptyState.createButton'),
              onClick: openNewTeam
            }}
          />
        ) : (
          <div className="space-y-4">
            {teams.map((team) => (
              <TeamSection
                key={team.id}
                team={team}
                members={byTeam.map.get(team.id) ?? []}
                collapsed={collapsed[team.id] ?? false}
                onToggle={() => toggle(team.id)}
                onEditEmployee={(e) =>
                  setEmployeeEditor({ draft: e, isNew: false })
                }
                onAskDeleteEmployee={setConfirmingEmployee}
                onEditTeam={(teamData) =>
                  setTeamEditor({ draft: teamData, isNew: false })
                }
                onAskDeleteTeam={setConfirmingTeam}
                onAddEmployeeToTeam={(teamId) => openNewEmployee(teamId)}
              />
            ))}
            {byTeam.unassigned.length > 0 && (
              <TeamSection
                team={null}
                members={byTeam.unassigned}
                collapsed={collapsed[UNASSIGNED_KEY] ?? true}
                onToggle={() => toggle(UNASSIGNED_KEY)}
                onEditEmployee={(e) =>
                  setEmployeeEditor({ draft: e, isNew: false })
                }
                onAskDeleteEmployee={setConfirmingEmployee}
                // Unassigned section is informational — no "Add an employee"
                // affordance into it. Pass a no-op for the slot.
                onAddEmployeeToTeam={() => {}}
              />
            )}
          </div>
        )}
      </div>

      {/* Edit sheets */}
      <Sheet
        open={employeeEditor !== null}
        onOpenChange={(o) => !o && setEmployeeEditor(null)}
      >
        <SheetContent className="w-[520px] p-0 sm:max-w-none">
          {employeeEditor && (
            <EmployeeEditor
              key={employeeEditor.draft.id}
              employee={employeeEditor.draft}
              isNew={employeeEditor.isNew}
              onClose={() => setEmployeeEditor(null)}
              onSave={handleSaveEmployee}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={teamEditor !== null}
        onOpenChange={(o) => !o && setTeamEditor(null)}
      >
        <SheetContent className="w-[520px] p-0 sm:max-w-none">
          {teamEditor && (
            <TeamEditor
              key={teamEditor.draft.id}
              team={teamEditor.draft}
              isNew={teamEditor.isNew}
              onClose={() => setTeamEditor(null)}
              onSave={handleSaveTeam}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm dialogs */}
      <AlertDialog
        open={confirmingEmployee !== null}
        onOpenChange={(o) => !o && setConfirmingEmployee(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:workforce.deleteEmployeeDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingEmployee ? (
                <DeleteEmployeeDescription name={confirmingEmployee.name} />
              ) : (
                ''
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!confirmingEmployee) return
                const id = confirmingEmployee.id
                const name = confirmingEmployee.name
                setConfirmingEmployee(null)
                try {
                  await deleteAgentApi(id)
                  setEmployees((p) => p.filter((x) => x.id !== id))
                  setEmployeeEditor((cur) =>
                    cur?.draft.id === id ? null : cur
                  )
                  sileo.success({
                    title: t('philharmonic:workforce.toast.deleted', { name })
                  })
                } catch (err) {
                  sileo.error({
                    title: t(
                      'philharmonic:workforce.toast.deleteEmployeeFailed'
                    ),
                    description:
                      err instanceof Error ? err.message : String(err)
                  })
                }
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmingTeam !== null}
        onOpenChange={(o) => !o && setConfirmingTeam(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:workforce.deleteTeamDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingTeam ? (
                <DeleteTeamDescription name={confirmingTeam.name} />
              ) : (
                ''
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!confirmingTeam) return
                const id = confirmingTeam.id
                const name = confirmingTeam.name
                setConfirmingTeam(null)
                try {
                  await deleteTeamApi(id)
                  setTeams((p) => p.filter((x) => x.id !== id))
                  // Members of that team are now unassigned locally too.
                  setEmployees((p) =>
                    p.map((e) => (e.teamId === id ? { ...e, teamId: null } : e))
                  )
                  setTeamEditor((cur) => (cur?.draft.id === id ? null : cur))
                  sileo.success({
                    title: t('philharmonic:workforce.toast.deleted', { name })
                  })
                } catch (err) {
                  sileo.error({
                    title: t('philharmonic:workforce.toast.deleteTeamFailed'),
                    description:
                      err instanceof Error ? err.message : String(err)
                  })
                }
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

Note the `emptyEmployeeDraft`/`emptyTeamDraft` helpers are plain
functions (not hooks/components), called from event handlers
(`openNewEmployee`/`openNewTeam`) rather than render bodies — they use
`import { i18n } from '@/lib/i18n'` → `i18n.t('philharmonic:key')`, the
established plain-function-helper convention. Add that import alongside
the others at the top of the file:

```tsx
import { i18n } from '@/lib/i18n'
```

- [ ] **Step 3: Run the formatter and re-verify the two `<Trans>` blocks**

Run: `pnpm format` (or
`./node_modules/.bin/oxfmt src/renderer/components/philharmonic/workforce/workforce-page.tsx`)

For BOTH `DeleteEmployeeDescription` and `DeleteTeamDescription`, confirm
the JSX still has `{' '}` in exactly the one position shown above (right
after `</span>`). If `oxfmt` changed either, re-derive the `<0>` index
empirically (compile with esbuild `jsx: 'automatic'`, walk
`React.Children.forEach` over the real compiled children array) before
trusting it — do not hand-count.

- [ ] **Step 4: Append namespace + render tests**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block:

```ts
it('has the workforce header, empty state, and team section keys', () => {
  expect(philharmonic.workforce.header).toMatchObject({
    title: 'Workforce',
    employeeCount_one: '{{count}} employee',
    employeeCount_other: '{{count}} employees',
    teamCount_one: '{{count}} team',
    teamCount_other: '{{count}} teams'
  })
  expect(philharmonic.workforce.emptyState).toMatchObject({
    title: 'Start with a team',
    createButton: '+ New team'
  })
  expect(philharmonic.workforce.teamSection.unassignedFallback).toBe('No team')
})

it('has distinct default-name and toast keys', () => {
  expect(philharmonic.workforce.newEmployeeDefaultName).toBe('New Employee')
  expect(philharmonic.workforce.newTeamDefaultName).toBe('New Team')
  // Shared generic templates, reused by both employee and team flows.
  expect(philharmonic.workforce.toast.created).toBe('"{{name}}" created')
  expect(philharmonic.workforce.toast.deleted).toBe('"{{name}}" deleted')
  // Entity-specific failure toasts stay separate.
  expect(philharmonic.workforce.toast.saveEmployeeFailed).not.toBe(
    philharmonic.workforce.toast.saveTeamFailed
  )
})
```

Add a new top-level `describe` block at the end of the file:

```ts
describe('philharmonic namespace workforce delete-dialog descriptions render correctly via Trans', () => {
  it('employee description — dynamic name in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteEmployeeDescription } =
      await import('@/components/philharmonic/workforce/workforce-page')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DeleteEmployeeDescription, { name: 'Ada' })
      )
    )
    expect(html).toBe(
      '<span class="bg-background rounded-md px-1.5 py-0.5 font-mono text-xs">Ada</span> will be permanently removed along with their accumulated memory.'
    )
  })

  it('team description — dynamic name in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteTeamDescription } =
      await import('@/components/philharmonic/workforce/workforce-page')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DeleteTeamDescription, { name: 'Marketing' })
      )
    )
    expect(html).toBe(
      '<span class="bg-background rounded-md px-1.5 py-0.5 font-mono text-xs">Marketing</span> will be removed. Existing members keep their records but lose this team affiliation.'
    )
  })
})
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires). Pay special attention to the two new
delete-dialog render tests.

Manually grep-verify zero missing/orphaned `costAnalysis.*`/`workforce.*`
keys across BOTH files in this sub-plan (Task 1 + Task 2 combined) — and,
since this is the LAST philharmonic sub-plan, also re-verify zero
missing/orphaned keys across the ENTIRE `philharmonic.json` file against
every consumer under `src/renderer/components/philharmonic/` and
`src/renderer/containers/philharmonic.tsx`.

Re-check `git status --porcelain` and revert (`git checkout --`) any
file outside this task's scope that `pnpm format` incidentally touched.

```bash
git add src/renderer/components/philharmonic/workforce/workforce-page.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's workforce roster and complete the namespace (sub-plan 5b/5)"
```

---

### Task 3: Final verification and plan commit

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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-philharmonic-workforce.md
git commit -m "docs: add philharmonic-workforce i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
