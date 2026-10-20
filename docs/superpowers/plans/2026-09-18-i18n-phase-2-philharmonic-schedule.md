# i18n Phase 2 — philharmonic-schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the SECOND slice of the `philharmonic` i18next
namespace — the Schedule feature (one-off and recurring scheduled
tasks running inside a Group). Sub-plan 2 of an expected 5-plan series
for `philharmonic` (see `philharmonic-container`, sub-plan 1, for the
overall scope and the design decisions it locked in).

**Files in scope:** all 6 files in
`components/philharmonic/schedule/`:
`group-tasks-by-day.ts`, `upcoming-list.tsx`, `recurring-list.tsx`,
`task-card.tsx`, `schedule-task-form.tsx`, `schedule-tab.tsx`.

**Architecture:**

- New top-level catalog section `schedule.*`, sibling to `container.*`
  — per `philharmonic-container`'s locked-in design decision, tab-BODY
  content (this whole feature) gets its own section, never merged into
  `container.*` even though the outer Dashboard tab trigger is also
  labeled "Schedule" (`container.tabs.schedule`, already shipped,
  untouched) — this sub-plan's `schedule.tab.heading` is a DIFFERENT UI
  element (the in-panel section heading, not the outer tab trigger) and
  deliberately gets its own key, matching the "don't consolidate across
  different UI slots even if the English text matches" lesson from the
  `settings-data-ops`/`mcpServers` `allLevels`/`allScopes` incident.
- `group-tasks-by-day.ts` has NO translatable static strings — its only
  string-producing call is `format(day, 'EEE, MMM d')`, a date-fns
  FORMAT PATTERN (a technical specifier), not a translatable phrase.
  date-fns calls throughout this codebase don't yet thread the active
  i18next locale through (a known, previously-flagged gap from the
  `discover` sub-plan's final review — app-wide, not fixed here either;
  staying consistent rather than fixing it ad hoc in one file). **This
  file is untouched.**
- `task-card.tsx`'s `STATUS_LABEL`/`PRIORITY_LABEL` (module-level
  `Record`s, each single-file-consumer) move inside the component via
  `useMemo`, matching the `knowledgeBase`/`computerUse` precedent —
  `TaskData['status']`/`TaskData['priority']` enum values stay
  hardcoded, only display labels translate. Note
  `TaskData['status']` includes the snake_case member
  `waiting_for_user` — a plain key-path segment, not one of i18next's
  reserved plural suffixes (`_zero`/`_one`/`_two`/`_few`/`_many`/
  `_other`), so no collision risk.
- `schedule-task-form.tsx`'s `CRON_PRESETS` (module-level array, single-
  file-consumer) moves inside the component via `useMemo` — the cron
  expression `value`s (`'0 9 * * *'`, `'0 9 * * 1'`, `'custom'`) stay
  hardcoded technical values, only `label`s translate.
- `recurring-list.tsx`'s `describeSchedule()` is a PLAIN FUNCTION, not a
  component or hook — it uses the established "plain function/module-
  level helper" pattern (`import { i18n } from '@/lib/i18n'` →
  `i18n.t('philharmonic:schedule....')`, documented in CLAUDE.md's
  "Adding a User-Facing String" step 2, already used in
  `weather-card.tsx`/`messages.tsx`/etc.) rather than threading a `t`
  parameter through every call site.
- `'Unknown group'` (the fallback shown when a task's linked
  conversation can't be found) is hardcoded IDENTICALLY in both
  `upcoming-list.tsx` and `recurring-list.tsx` — becomes ONE shared key
  (`schedule.unknownGroup`), not two near-duplicates.
- `'Schedule task'` is the SAME semantic action label used at TWO real
  call sites — the header trigger button in `schedule-tab.tsx` (opens
  the create-task sheet) and the submit button in
  `schedule-task-form.tsx` (submits it) — both are genuinely "the
  button that creates a scheduled task," so this one IS a legitimate
  DRY share — hoisted to the `schedule.*` section root
  (`schedule.scheduleTaskButton`), alongside `schedule.unknownGroup`,
  rather than nested under `tab` (which only the header trigger owns),
  so both cross-file shared keys live at a consistent, self-documenting
  location — unlike the `allLevels`/`allScopes` case where the same
  English text covered two semantically different filter dimensions
  and correctly got separate keys.
- Every technical/example value stays hardcoded: the cron expression
  values, the `"Weekly status report"`/`"What should the team do?"`/
  `"0 9 * * 1-5"` example placeholders (matching the established
  "e.g./example placeholder stays hardcoded" convention), and the
  `runAtDate.toDateString()` date-rendering call (a `Date` method
  output, not static UI prose).

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/philharmonic.json` — this
  sub-plan adds a new top-level `schedule.*` section, sibling to the
  already-shipped `container.*`. Do not touch `container.*`.
- No tooling catches a stale English catalog key on a namespace this
  large (`catalog-audit.ts`'s orphan check only flags the reverse
  direction) — before considering this plan done, manually grep every
  `t('...')`/`i18n.t('...')` call across the 6 files and cross-check
  against the catalog for zero missing AND zero orphaned keys.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm all 6 files are still clean.
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

### Task 1: Schedule feature (tasks list, task card, create-task form)

**Files:**

- Modify: `src/renderer/components/philharmonic/schedule/upcoming-list.tsx`
- Modify: `src/renderer/components/philharmonic/schedule/recurring-list.tsx`
- Modify: `src/renderer/components/philharmonic/schedule/task-card.tsx`
- Modify: `src/renderer/components/philharmonic/schedule/schedule-task-form.tsx`
- Modify: `src/renderer/components/philharmonic/schedule/schedule-tab.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Create: `tests/unit/i18n/philharmonic-namespace.test.ts` (append —
  this file already exists from sub-plan 1; add a new `it` block to its
  existing `describe`)

**Interfaces:**

- Consumes: `t` from `react-i18next` (`useTranslation('philharmonic')`)
  in the 4 component files; `i18n.t()` from `@/lib/i18n` in
  `recurring-list.tsx`'s plain `describeSchedule()` function.
- Produces: nothing consumed by later `philharmonic` sub-plans — the
  `schedule.*` section is used only by these 5 files.

- [ ] **Step 1: Add the `schedule` section to `philharmonic.json`**

Add this top-level key, sibling to the existing `container` key:

```json
  "schedule": {
    "tab": {
      "heading": "Schedule",
      "upcomingTrigger": "Upcoming",
      "recurringTrigger": "Recurring"
    },
    "unknownGroup": "Unknown group",
    "scheduleTaskButton": "Schedule task",
    "upcomingList": {
      "empty": "No upcoming one-off tasks. Schedule one to see it here."
    },
    "recurringList": {
      "empty": "No recurring tasks yet.",
      "lastRun": "last {{time}}",
      "nextRun": "next {{time}}"
    },
    "taskCard": {
      "status": {
        "pending": "Pending",
        "running": "Running",
        "completed": "Completed",
        "failed": "Failed",
        "cancelled": "Cancelled",
        "waiting_for_user": "Waiting"
      },
      "priority": {
        "low": "Low",
        "medium": "Medium",
        "high": "High",
        "urgent": "Urgent"
      },
      "cancelAria": "Cancel scheduled task"
    },
    "toast": {
      "loadUpcomingFailed": "Could not load upcoming tasks",
      "loadRecurringFailed": "Could not load recurring tasks",
      "taskCancelled": "Task cancelled",
      "cancelTaskFailed": "Could not cancel task",
      "taskScheduled": "Task scheduled",
      "scheduleTaskFailed": "Could not schedule task"
    },
    "form": {
      "title": "Schedule a task",
      "description": "Runs inside an existing Group, once or on a recurring schedule.",
      "titleLabel": "Title",
      "descriptionLabel": "Description",
      "groupLabel": "Group",
      "groupPlaceholder": "Choose a group",
      "onceButton": "One-off",
      "recurringButton": "Recurring",
      "pickDateButton": "Pick a date",
      "submitting": "Scheduling…",
      "cronPresets": {
        "dailyNine": "Every day at 9:00 AM",
        "mondayNine": "Every Monday at 9:00 AM",
        "custom": "Custom"
      }
    }
  }
```

(Insert this as a sibling of `container` — the file becomes `{
"container": {...}, "schedule": {...} }`.)

- [ ] **Step 2: Rewrite `upcoming-list.tsx`**

```tsx
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@/components/ui/scroll-area'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { groupTasksByDay } from './group-tasks-by-day'
import { TaskCard } from './task-card'

export function UpcomingList({
  tasks,
  conversationsById,
  cancellingId,
  onCancel
}: {
  tasks: TaskData[]
  conversationsById: Record<string, ConversationData>
  cancellingId: string | null
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation('philharmonic')
  const groups = groupTasksByDay(tasks)

  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        {t('schedule.upcomingList.empty')}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {groups.map((group) => (
          <div key={group.day.toISOString()}>
            <div className="bg-card text-muted-foreground sticky top-0 z-10 mb-2 py-1 text-xs font-semibold">
              {group.label}
            </div>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  groupTitle={
                    conversationsById[task.conversationId ?? '']?.title ??
                    t('schedule.unknownGroup')
                  }
                  subtitle={format(new Date(task.runAt!), 'HH:mm')}
                  onCancel={onCancel}
                  cancelling={cancellingId === task.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 3: Rewrite `recurring-list.tsx`**

```tsx
// src/renderer/components/philharmonic/schedule/recurring-list.tsx
import { CronExpressionParser } from 'cron-parser'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@/components/ui/scroll-area'
import { i18n } from '@/lib/i18n'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { TaskCard } from './task-card'

function describeSchedule(task: TaskData): string {
  if (!task.cronExpression) return ''
  const lastRun = task.lastRunAt
    ? i18n.t('philharmonic:schedule.recurringList.lastRun', {
        time: format(new Date(task.lastRunAt), 'MMM d, HH:mm')
      }) + ' · '
    : ''
  try {
    const next = CronExpressionParser.parse(task.cronExpression).next().toDate()
    return `${lastRun}${task.cronExpression} · ${i18n.t(
      'philharmonic:schedule.recurringList.nextRun',
      { time: format(next, 'MMM d, HH:mm') }
    )}`
  } catch {
    return `${lastRun}${task.cronExpression}`
  }
}

export function RecurringList({
  tasks,
  conversationsById,
  cancellingId,
  onCancel
}: {
  tasks: TaskData[]
  conversationsById: Record<string, ConversationData>
  cancellingId: string | null
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation('philharmonic')
  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
        {t('schedule.recurringList.empty')}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            groupTitle={
              conversationsById[task.conversationId ?? '']?.title ??
              t('schedule.unknownGroup')
            }
            subtitle={describeSchedule(task)}
            onCancel={onCancel}
            cancelling={cancellingId === task.id}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 4: Rewrite `task-card.tsx`**

```tsx
// src/renderer/components/philharmonic/schedule/task-card.tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { Loader2Icon, XIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TaskData } from '@/stores/philharmonic'

export function TaskCard({
  task,
  groupTitle,
  subtitle,
  onCancel,
  cancelling
}: {
  task: TaskData
  groupTitle: string
  /** Recurring: cron expression + next-run text. One-off: time of day. */
  subtitle: string
  onCancel: (id: string) => void
  cancelling: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const statusLabel: Record<TaskData['status'], string> = useMemo(
    () => ({
      pending: t('schedule.taskCard.status.pending'),
      running: t('schedule.taskCard.status.running'),
      completed: t('schedule.taskCard.status.completed'),
      failed: t('schedule.taskCard.status.failed'),
      cancelled: t('schedule.taskCard.status.cancelled'),
      waiting_for_user: t('schedule.taskCard.status.waiting_for_user')
    }),
    [t]
  )
  const priorityLabel: Record<TaskData['priority'], string> = useMemo(
    () => ({
      low: t('schedule.taskCard.priority.low'),
      medium: t('schedule.taskCard.priority.medium'),
      high: t('schedule.taskCard.priority.high'),
      urgent: t('schedule.taskCard.priority.urgent')
    }),
    [t]
  )
  const cancellable = task.status === 'pending'
  return (
    <div
      data-testid={TEST_IDS.schedule.taskCard}
      className="border-border bg-card flex items-start justify-between gap-3 rounded-xl border p-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate text-sm font-semibold">
            {task.title}
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {priorityLabel[task.priority]}
          </Badge>
          <Badge
            variant={task.status === 'failed' ? 'destructive' : 'secondary'}
            className="shrink-0 text-[10px]"
          >
            {statusLabel[task.status]}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-1 truncate text-xs">
          {groupTitle} · {subtitle}
        </div>
      </div>
      {cancellable && (
        <Button
          data-testid={TEST_IDS.schedule.cancelButton}
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
          disabled={cancelling}
          onClick={() => onCancel(task.id)}
          aria-label={t('schedule.taskCard.cancelAria')}
        >
          {cancelling ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XIcon className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `schedule-task-form.tsx`**

Add the import and hook, move `CRON_PRESETS` inside as a `useMemo`:

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { createScheduledTask } from '@/services/philharmonic-tasks'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

export function ScheduleTaskForm({
  open,
  onOpenChange,
  conversations,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversations: ConversationData[]
  onCreated: (task: TaskData) => void
}) {
  const { t } = useTranslation('philharmonic')
  const cronPresets = useMemo(
    () => [
      {
        label: t('schedule.form.cronPresets.dailyNine'),
        value: '0 9 * * *'
      },
      {
        label: t('schedule.form.cronPresets.mondayNine'),
        value: '0 9 * * 1'
      },
      { label: t('schedule.form.cronPresets.custom'), value: 'custom' }
    ],
    [t]
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [mode, setMode] = useState<'once' | 'recurring'>('once')
  const [runAtDate, setRunAtDate] = useState<Date | undefined>(undefined)
  const [runAtTime, setRunAtTime] = useState('09:00')
  const [cronPreset, setCronPreset] = useState(cronPresets[0].value)
  const [customCron, setCustomCron] = useState('')
  const [submitting, setSubmitting] = useState(false)
```

Note `cronPreset`'s initial state now reads `cronPresets[0].value` (the
`useMemo`'d array) instead of the old module-level `CRON_PRESETS[0].value`
— the VALUE (`'0 9 * * *'`) is identical either way since only the
`label`s changed, so this is a value-compatible substitution, not a
behavior change.

```tsx
  const reset = () => {
    setTitle('')
    setDescription('')
    setConversationId('')
    setMode('once')
    setRunAtDate(undefined)
    setRunAtTime('09:00')
    setCronPreset(cronPresets[0].value)
    setCustomCron('')
  }

  const handleSubmit = async () => {
    if (!title.trim() || !conversationId) return
    let cronExpression: string | null = null
    let runAt: string | null = null
    if (mode === 'recurring') {
      cronExpression = cronPreset === 'custom' ? customCron.trim() : cronPreset
      if (!cronExpression) return
    } else {
      if (!runAtDate) return
      const [hours, minutes] = runAtTime.split(':').map(Number)
      const combined = new Date(runAtDate)
      combined.setHours(hours, minutes, 0, 0)
      runAt = combined.toISOString()
    }
    setSubmitting(true)
    try {
      const task = await createScheduledTask({
        title: title.trim(),
        description: description.trim() || undefined,
        conversationId,
        cronExpression,
        runAt
      })
      onCreated(task)
      reset()
      onOpenChange(false)
      sileo.success({ title: t('schedule.toast.taskScheduled') })
    } catch (err) {
      sileo.error({
        title: t('schedule.toast.scheduleTaskFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('schedule.form.title')}</SheetTitle>
          <SheetDescription>{t('schedule.form.description')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-title">
              {t('schedule.form.titleLabel')}
            </Label>
            <Input
              id="schedule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly status report"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-description">
              {t('schedule.form.descriptionLabel')}
            </Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the team do?"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('schedule.form.groupLabel')}</Label>
            <Select
              value={conversationId}
              onValueChange={(v) => v && setConversationId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('schedule.form.groupPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'once' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('once')}
            >
              {t('schedule.form.onceButton')}
            </Button>
            <Button
              type="button"
              variant={mode === 'recurring' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('recurring')}
            >
              {t('schedule.form.recurringButton')}
            </Button>
          </div>
          {mode === 'once' ? (
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button type="button" variant="outline" className="flex-1">
                      {runAtDate
                        ? runAtDate.toDateString()
                        : t('schedule.form.pickDateButton')}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={runAtDate}
                    onSelect={setRunAtDate}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={runAtTime}
                onChange={(e) => setRunAtTime(e.target.value)}
                className="w-28"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Select
                value={cronPreset}
                onValueChange={(v) => v && setCronPreset(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cronPresets.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cronPreset === 'custom' && (
                <Input
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                />
              )}
            </div>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            disabled={submitting || !title.trim() || !conversationId}
            onClick={handleSubmit}
          >
            {submitting
              ? t('schedule.form.submitting')
              : t('schedule.scheduleTaskButton')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 6: Rewrite `schedule-tab.tsx`**

Add the import and hook:

```tsx
// src/renderer/components/philharmonic/schedule/schedule-tab.tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  cancelScheduledTask,
  getRecurringTasks,
  getUpcomingTasks
} from '@/services/philharmonic-tasks'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { RecurringList } from './recurring-list'
import { ScheduleTaskForm } from './schedule-task-form'
import { UpcomingList } from './upcoming-list'

export function ScheduleTab({
  conversations
}: {
  conversations: ConversationData[]
}) {
  const { t } = useTranslation('philharmonic')
  const [upcoming, setUpcoming] = useState<TaskData[]>([])
  const [recurring, setRecurring] = useState<TaskData[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  useEffect(() => {
    getUpcomingTasks()
      .then(setUpcoming)
      .catch((err) =>
        sileo.error({
          title: t('schedule.toast.loadUpcomingFailed'),
          description: err instanceof Error ? err.message : String(err)
        })
      )
    getRecurringTasks()
      .then(setRecurring)
      .catch((err) =>
        sileo.error({
          title: t('schedule.toast.loadRecurringFailed'),
          description: err instanceof Error ? err.message : String(err)
        })
      )
  }, [t])

  const conversationsById = useMemo(
    () => Object.fromEntries(conversations.map((c) => [c.id, c])),
    [conversations]
  )

  const handleCreated = useCallback((task: TaskData) => {
    if (task.cronExpression) {
      setRecurring((p) => [task, ...p])
    } else {
      setUpcoming((p) => {
        const next = [...p, task]
        next.sort((a, b) => (a.runAt ?? '').localeCompare(b.runAt ?? ''))
        return next
      })
    }
  }, [])

  const handleCancel = useCallback(
    async (id: string) => {
      setCancellingId(id)
      try {
        await cancelScheduledTask(id)
        setUpcoming((p) => p.filter((t) => t.id !== id))
        setRecurring((p) => p.filter((t) => t.id !== id))
        sileo.success({ title: t('schedule.toast.taskCancelled') })
      } catch (err) {
        sileo.error({
          title: t('schedule.toast.cancelTaskFailed'),
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setCancellingId(null)
      }
    },
    [t]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
        <span className="text-foreground text-sm font-semibold">
          {t('schedule.tab.heading')}
        </span>
        <Button
          data-testid={TEST_IDS.schedule.createButton}
          type="button"
          size="sm"
          onClick={() => setFormOpen(true)}
        >
          <PlusIcon className="h-4 w-4" />
          {t('schedule.scheduleTaskButton')}
        </Button>
      </div>
      <Tabs defaultValue="upcoming" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 w-fit shrink-0">
          <TabsTrigger value="upcoming">
            {t('schedule.tab.upcomingTrigger')}
          </TabsTrigger>
          <TabsTrigger value="recurring">
            {t('schedule.tab.recurringTrigger')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="min-h-0 flex-1">
          <UpcomingList
            tasks={upcoming}
            conversationsById={conversationsById}
            cancellingId={cancellingId}
            onCancel={handleCancel}
          />
        </TabsContent>
        <TabsContent value="recurring" className="min-h-0 flex-1">
          <RecurringList
            tasks={recurring}
            conversationsById={conversationsById}
            cancellingId={cancellingId}
            onCancel={handleCancel}
          />
        </TabsContent>
      </Tabs>
      <ScheduleTaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        conversations={conversations}
        onCreated={handleCreated}
      />
    </div>
  )
}
```

Note the `useEffect`'s dep array gains `t` (it now calls `t()` inside
its two `.catch()` handlers) — this is safe: `t` is referentially
stable across re-renders except when the catalog itself changes
identity (verified in a prior sub-plan's final review), so this does
not introduce a re-fetch loop beyond the one-time identity change when
the `philharmonic` catalog finishes loading.

- [ ] **Step 7: Append a namespace test**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block (after
the last `it`, before its closing `})`):

```ts
it('has the schedule tab and shared keys', () => {
  expect(philharmonic.schedule.tab).toMatchObject({
    heading: 'Schedule',
    upcomingTrigger: 'Upcoming',
    recurringTrigger: 'Recurring'
  })
  expect(philharmonic.schedule.unknownGroup).toBe('Unknown group')
  expect(philharmonic.schedule.scheduleTaskButton).toBe('Schedule task')
})

it('has the task card status and priority labels', () => {
  expect(philharmonic.schedule.taskCard.status).toMatchObject({
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    waiting_for_user: 'Waiting'
  })
  expect(philharmonic.schedule.taskCard.priority).toMatchObject({
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent'
  })
})

it('has the recurring-list schedule-description interpolation keys', () => {
  expect(philharmonic.schedule.recurringList).toMatchObject({
    lastRun: 'last {{time}}',
    nextRun: 'next {{time}}'
  })
})

it('has the schedule form keys', () => {
  expect(philharmonic.schedule.form.title).toBe('Schedule a task')
  expect(philharmonic.schedule.form.cronPresets).toMatchObject({
    dailyNine: 'Every day at 9:00 AM',
    mondayNine: 'Every Monday at 9:00 AM',
    custom: 'Custom'
  })
})
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

Also manually grep-verify zero orphaned/missing keys per the Global
Constraints note above (no automated gate catches a stale English key
on this large a namespace).

```bash
git add src/renderer/components/philharmonic/schedule/upcoming-list.tsx \
  src/renderer/components/philharmonic/schedule/recurring-list.tsx \
  src/renderer/components/philharmonic/schedule/task-card.tsx \
  src/renderer/components/philharmonic/schedule/schedule-task-form.tsx \
  src/renderer/components/philharmonic/schedule/schedule-tab.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's schedule feature (sub-plan 2/N)"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-philharmonic-schedule.md
git commit -m "docs: add philharmonic-schedule i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
