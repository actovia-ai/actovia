# i18n Phase 2 — philharmonic-chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the THIRD, largest slice of the `philharmonic` i18next
namespace — the Group Chat feature (composer, message bubbles, plan
progress card, members panel, conversation sidebar, chat header). Sub-plan
3 of 5 for `philharmonic` (see `philharmonic-container` and
`philharmonic-schedule` for the design decisions this builds on).

**Files in scope:** all 8 files in `components/philharmonic/chat/`:
`attachment-preview.tsx`, `uploader.tsx`, `composer.tsx`, `plan-card.tsx`,
`group-message-bubble.tsx`, `group-members-panel.tsx`,
`conversation-list.tsx`, `group-chat.tsx`.

**Architecture:**

- New top-level catalog section `chat.*`, sibling to `container.*` and
  `schedule.*`.
- **This is the sub-plan where `empty-state.tsx`'s 4 real call sites**
  (flagged as out-of-scope by `philharmonic-container`) get translated —
  3 of the 4 (`group-members-panel.tsx`, `conversation-list.tsx`,
  `group-chat.tsx`) live in this sub-plan's file set. The 4th
  (`workforce-page.tsx`) belongs to sub-plan 5.
- **Shared role-name fallbacks, reused across files** (all identical
  concepts rendered in genuinely equivalent contexts, not the
  `allLevels`/`allScopes` anti-pattern):
  - `'You'` (fallback name for the user's own messages) — REUSES the
    already-shipped `common:state.you` key from the `settings-profile`
    sub-plan, per that sub-plan's own explicit note flagging "2
    Philharmonic chat files still hardcode 'You'" as backlog for when
    this namespace was reached. Used via array-form
    `useTranslation(['common', 'philharmonic'])` where needed.
  - `'PM'` (the Project Manager role abbreviation) — one shared
    `chat.roles.pm` key, used in `group-message-bubble.tsx` (header name
    - avatar div, 2 sites in 1 file), `group-members-panel.tsx` (PmRow
      avatar + label, 2 sites in 1 file), and `conversation-list.tsx`'s
      `previewLine()` fallback (1 site) — same literal role name in every
      case.
  - `'Employee'` (fallback when an agent has no name) — one shared
    `chat.roles.employeeFallback` key, used in `group-message-bubble.tsx`
    and `conversation-list.tsx`'s `previewLine()`.
  - `'Yesterday'`/`'Today'` (relative day labels) — one shared
    `chat.dateLabels.*` section, used in `conversation-list.tsx`'s
    `smartTime()` (only needs `yesterday`) and `group-chat.tsx`'s
    `formatDayLabel()` (needs both).
- **Deliberately NOT shared — 3 sibling "New group" copies**, per
  `philharmonic-container`'s locked-in design decision: the sidebar menu
  item (`chat.conversationList.newGroupMenuItem`), the empty-state action
  button (`chat.conversationList.emptyState.createButton`, text is
  literally `"+ New group"` with a plus-sign prefix — NOT the same string
  as the menu item), and the preview fallback
  (`chat.conversationList.noMessagesYetPreview`, `"New group · no
  messages yet"`) all get separate keys, matching the review's own
  prediction from sub-plan 1. None of these reuse `container.
  newGroupDefaultTitle` either — that key is a persisted DATA default, a
  different semantic slot.
- **Plain functions/module-level helpers** (not components/hooks) use
  the established `import { i18n } from '@/lib/i18n'` →
  `i18n.t('philharmonic:...')` pattern: `plan-card.tsx`'s `elapsedLabel()`,
  `conversation-list.tsx`'s `smartTime()` and `previewLine()`,
  `group-chat.tsx`'s `formatDayLabel()`.
- **Two `<Trans>` blocks, both extracted to exported components with
  empirically-verified numbered placeholders** (verified this planning
  session via the standard method: format via `oxfmt`, dump real
  compiled children via `React.Children.forEach`, cross-check a real
  `i18next` + `renderToStaticMarkup` render):
  - `composer.tsx`'s keyboard hint wraps TWO `<kbd>` elements (not
    allowlisted). Verified raw children:
    `[text, kbd, text, text, kbd, text, text]` — first `<kbd>` at index
    `1`, second at index `4`.
  - `conversation-list.tsx`'s delete-confirmation description wraps a
    styled `<span>` around the DYNAMIC group title (not allowlisted).
    Verified: `<span>` at index `0`. This is the first block in this
    whole i18n effort combining a NUMBERED placeholder with an
    INTERPOLATED VALUE inside it — verified this specific combination
    renders correctly via `values={{ title }}` on `<Trans>` plus a plain
    `{title}` expression (not the double-brace form) in the JSX fallback
    children, mirroring `mcpServers.activeSummary`'s interpolation
    pattern but with a numbered (not allowlisted-tag) wrapper.
- **Real i18next pluralization** for `group-chat.tsx`'s
  `{{count}} member`/`members` (replacing the manual ternary). NOT
  applied to `membersPanel`'s `{{count}} idle`/`{{count}} busy` or
  `plan-card.tsx`'s `{{count}} min` — "idle"/"busy"/"min" are
  grammatically invariant adjectives/abbreviations in English regardless
  of count (no plural form exists to select between), unlike "member" ↔
  "members".
- `STATUS_GLYPH`/`STATUS_COLOR` in `plan-card.tsx` stay untouched module
  constants — glyphs and CSS color values, not text.
- `format(...)`/date-fns FORMAT PATTERNS throughout (`'HH:mm'`, `'EEE'`,
  `'MM/dd'`, `'PPP'`) are technical specifiers, not translatable phrases
  — the app-wide date-fns-locale gap (flagged in `discover`'s review) is
  not fixed here either.
- `CONFIG_NAV` (module-level array in `conversation-list.tsx`, single-
  file-consumer) moves inside the component via `useMemo` — icon
  component references are stable and fine to include in a memoized
  array; only `label`s translate.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/philharmonic.json` — this
  sub-plan adds a new top-level `chat.*` section, sibling to `container.*`
  and `schedule.*`. Do not touch either of those.
- For the two `<Trans>` blocks: transcribe the JSX and catalog strings
  EXACTLY as given below — both were empirically verified this planning
  session. If either JSX changes for any reason, re-verify with the same
  technique before trusting new numbers.
- No tooling catches a stale English catalog key on a namespace this
  large — manually grep-verify zero missing AND zero orphaned `chat.*`
  keys before considering either task done.
- Never `git commit --amend`. `git add` scoped to the exact files each
  task names — never `-A`/`.`. Re-run `git status --porcelain` before
  each task and confirm its files are still clean.
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

### Task 1: Composer, plan card, and message bubble

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/attachment-preview.tsx`
- Modify: `src/renderer/components/philharmonic/chat/uploader.tsx`
- Modify: `src/renderer/components/philharmonic/chat/composer.tsx`
- Modify: `src/renderer/components/philharmonic/chat/plan-card.tsx`
- Modify: `src/renderer/components/philharmonic/chat/group-message-bubble.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Create: `tests/unit/i18n/philharmonic-namespace.test.ts` (append)

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`
  (`useTranslation('philharmonic')`, or array-form
  `useTranslation(['common', 'philharmonic'])` in
  `group-message-bubble.tsx` for `common:state.you`); `i18n.t()` from
  `@/lib/i18n` in `plan-card.tsx`'s plain `elapsedLabel()`.
- Produces: the exported `ComposerHint` component (consumed by
  `composer.tsx` and this task's own render test) and the
  `chat.roles.*` keys (also consumed by Task 2's `conversation-list.tsx`).

- [ ] **Step 1: Add the `chat` section to `philharmonic.json` (partial —
      Task 2 adds the rest as a follow-up edit to the same section)**

Add this top-level key, sibling to `container` and `schedule`:

```json
  "chat": {
    "attachmentPreview": {
      "removeAria": "Remove {{name}}"
    },
    "uploader": {
      "attachAria": "Attach images"
    },
    "composer": {
      "placeholder": "Message your team…",
      "stopAria": "Stop",
      "sendAria": "Send",
      "hint": "Press <1>Enter</1> to send, <4>Shift + Enter</4> for a new line. Paste or attach images."
    },
    "planCard": {
      "elapsed": {
        "lessThanMin": "<1 min",
        "minutes": "{{count}} min",
        "hoursMinutes": "{{hours}}h {{minutes}}m"
      },
      "status": {
        "active": "active",
        "done": "done",
        "aborted": "aborted",
        "draft": "draft"
      },
      "stepStatusAria": {
        "pending": "Pending",
        "running": "Running",
        "done": "Done",
        "skipped": "Skipped",
        "failed": "Failed"
      }
    },
    "roles": {
      "pm": "PM",
      "employeeFallback": "Employee"
    }
  }
```

- [ ] **Step 2: Rewrite `attachment-preview.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/attachment-preview.tsx
import { useAtom } from 'jotai'
import { XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

export function AttachmentPreview() {
  const { t } = useTranslation('philharmonic')
  const [attachments, setAttachments] = useAtom(philharmonicAttachmentAtom)

  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-2 px-1">
      {attachments.map((a, i) => (
        <div key={`${a.name}-${i}`} className="group relative">
          <img
            src={a.url}
            alt={a.name}
            className="bg-background h-12 w-12 rounded-lg object-cover"
          />
          <button
            type="button"
            aria-label={t('chat.attachmentPreview.removeAria', {
              name: a.name
            })}
            onClick={() =>
              setAttachments((p) => p.filter((_, idx) => idx !== i))
            }
            className="bg-foreground text-background ring-card absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full ring-2"
          >
            <XIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `uploader.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/uploader.tsx
import { Loader2Icon, PaperclipIcon } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { usePhilharmonicUpload } from '@/hooks/use-philharmonic-upload'

export function ComposerUploader() {
  const { t } = useTranslation('philharmonic')
  const { upload, uploading } = usePhilharmonicUpload()
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await upload([...files])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('chat.uploader.attachAria')}
      disabled={uploading}
      className="text-muted-foreground hover:bg-background hover:text-foreground relative shrink-0 rounded-lg"
    >
      {uploading ? (
        <Loader2Icon className="h-4 w-4 animate-spin" />
      ) : (
        <PaperclipIcon className="h-4 w-4" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onChange}
        disabled={uploading}
        tabIndex={-1}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        aria-hidden="true"
      />
    </Button>
  )
}
```

- [ ] **Step 4: Rewrite `composer.tsx`**

Add the exported `ComposerHint` component (this JSX is already in its
POST-`oxfmt` form, verified during planning — do not hand-reflow it
further) and switch the hook:

```tsx
// src/renderer/components/philharmonic/chat/composer.tsx
import type { Attachment } from '@shared/types/chat'
import { useAtom } from 'jotai'
import { SendIcon, SquareIcon } from 'lucide-react'
import { type ClipboardEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePhilharmonicUpload } from '@/hooks/use-philharmonic-upload'
import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

import { AttachmentPreview } from './attachment-preview'
import { ComposerUploader } from './uploader'

export function ComposerHint() {
  return (
    <p className="text-muted-foreground mt-1.5 px-1 text-[10px]">
      <Trans ns="philharmonic" i18nKey="chat.composer.hint">
        Press <kbd className="bg-background rounded px-1 py-px">Enter</kbd> to
        send,{' '}
        <kbd className="bg-background ml-1 rounded px-1 py-px">
          Shift + Enter
        </kbd>{' '}
        for a new line. Paste or attach images.
      </Trans>
    </p>
  )
}

export function Composer({
  onSend,
  disabled,
  busy = false,
  onStop
}: {
  onSend: (text: string, attachments: Attachment[]) => void
  disabled?: boolean
  /** PM is currently running — the Send button becomes a Stop button. */
  busy?: boolean
  onStop?: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useAtom(philharmonicAttachmentAtom)
  const { upload } = usePhilharmonicUpload()

  const submit = () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    onSend(t, attachments)
    setText('')
    setAttachments([])
  }
  const canSend =
    !disabled && (text.trim().length > 0 || attachments.length > 0)

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      await upload(files)
    }
  }

  return (
    <div className="bg-muted border-border border-t px-4 pt-3 pb-4">
      <div className="border-border bg-card focus-within:border-primary focus-within:ring-accent flex flex-col gap-1 rounded-xl border p-2 pl-3.5 transition-shadow focus-within:ring-[3px]">
        <AttachmentPreview />
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={onPaste}
            placeholder={t('chat.composer.placeholder')}
            className="max-h-48 min-h-[36px] resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <ComposerUploader />
          {busy ? (
            <Button
              size="icon-sm"
              variant="destructive"
              onClick={onStop}
              aria-label={t('chat.composer.stopAria')}
              className="shrink-0 rounded-lg"
            >
              <SquareIcon className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!canSend}
              aria-label={t('chat.composer.sendAria')}
              className="shrink-0 rounded-lg"
            >
              <SendIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <ComposerHint />
    </div>
  )
}
```

Note the local `const t = text.trim()` inside `submit()` SHADOWS the
`useTranslation()` `t` — safe because `submit()` never calls the
translation function.

- [ ] **Step 5: Run the formatter and re-verify `ComposerHint`'s Trans block**

Run: `pnpm format` (or
`./node_modules/.bin/oxfmt src/renderer/components/philharmonic/chat/composer.tsx`)

Read the file back and confirm `ComposerHint`'s JSX still has `{' '}` in
exactly the two positions shown above (after "send," and after the
second `</kbd>`). If `oxfmt` changed it, stop and re-derive the indices
empirically before trusting the catalog's `<1>`/`<4>`.

- [ ] **Step 6: Rewrite `plan-card.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/plan-card.tsx
import type { PlanDto, StepStatus } from '@shared/types/philharmonic'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AgentData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'

interface Props {
  plan: PlanDto
  agentsById: Record<string, AgentData>
}

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: '○',
  running: '⏳',
  done: '✓',
  skipped: '⊘',
  failed: '✗'
}

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'var(--muted-foreground)',
  running: '#f59e0b',
  done: '#10b981',
  skipped: 'var(--muted-foreground)',
  failed: 'var(--destructive)'
}

function elapsedLabel(plan: PlanDto): string {
  const start = new Date(plan.createdAt).getTime()
  const end =
    plan.status === 'completed' || plan.status === 'aborted'
      ? new Date(plan.updatedAt).getTime()
      : Date.now()
  const min = Math.floor((end - start) / 60_000)
  if (min < 1) return i18n.t('philharmonic:chat.planCard.elapsed.lessThanMin')
  if (min < 60)
    return i18n.t('philharmonic:chat.planCard.elapsed.minutes', { count: min })
  return i18n.t('philharmonic:chat.planCard.elapsed.hoursMinutes', {
    hours: Math.floor(min / 60),
    minutes: min % 60
  })
}

export function PlanCard({ plan, agentsById }: Props) {
  const { t } = useTranslation('philharmonic')
  const stepStatusAria: Record<StepStatus, string> = useMemo(
    () => ({
      pending: t('chat.planCard.stepStatusAria.pending'),
      running: t('chat.planCard.stepStatusAria.running'),
      done: t('chat.planCard.stepStatusAria.done'),
      skipped: t('chat.planCard.stepStatusAria.skipped'),
      failed: t('chat.planCard.stepStatusAria.failed')
    }),
    [t]
  )
  // Auto-collapse completed plans and busy plans with > 4 steps.
  const initialCollapsed =
    plan.status === 'completed' ||
    plan.status === 'aborted' ||
    plan.steps.length > 4
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  // Tick once a minute so elapsed labels stay fresh without an animation loop.
  const [, force] = useState(0)
  useEffect(() => {
    if (plan.status !== 'active') return
    const t = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [plan.status])

  if (plan.steps.length === 0) return null

  const done = plan.steps.filter((s) => s.status === 'done').length
  const total = plan.steps.length

  return (
    <div className="bg-muted mb-4 overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="hover:bg-background flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        )}
        <span className="text-foreground flex-1 truncate text-[12.5px] font-semibold">
          {plan.summary}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {done}/{total} · {elapsedLabel(plan)}
        </span>
        <StatusPill status={plan.status} />
      </button>
      {!collapsed && (
        <div className="border-border border-t">
          {plan.steps.map((s) => {
            const agent = s.assignedAgentId
              ? agentsById[s.assignedAgentId]
              : undefined
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-start gap-3 px-4 py-2.5',
                  s.status === 'running' && 'bg-background'
                )}
              >
                <span
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[12px]"
                  style={{ color: STATUS_COLOR[s.status] }}
                  aria-label={stepStatusAria[s.status]}
                >
                  {s.status === 'done' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : s.status === 'failed' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    STATUS_GLYPH[s.status]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-[13px] font-medium',
                      s.status === 'done' &&
                        'text-muted-foreground line-through',
                      s.status === 'skipped' && 'text-muted-foreground',
                      s.status !== 'done' &&
                        s.status !== 'skipped' &&
                        'text-foreground'
                    )}
                  >
                    {s.ordinal + 1}. {s.title}
                  </div>
                  {s.intent && (
                    <div className="text-muted-foreground text-[11.5px]">
                      {s.intent}
                    </div>
                  )}
                  {s.output && s.status === 'done' && (
                    <div className="text-muted-foreground mt-1 line-clamp-2 text-[11.5px]">
                      → {s.output}
                    </div>
                  )}
                  {s.note && (
                    <div className="mt-1 text-[11.5px] text-amber-500">
                      {s.note}
                    </div>
                  )}
                </div>
                {agent && (
                  <EmployeeAvatar
                    seed={agent.avatarSeed}
                    style={agent.avatarStyle}
                    size={24}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: PlanDto['status'] }) {
  const { t } = useTranslation('philharmonic')
  const label =
    status === 'active'
      ? t('chat.planCard.status.active')
      : status === 'completed'
        ? t('chat.planCard.status.done')
        : status === 'aborted'
          ? t('chat.planCard.status.aborted')
          : t('chat.planCard.status.draft')
  return (
    <span
      className={cn(
        'bg-muted rounded-full px-2 py-0.5 text-[10px] font-medium',
        status === 'completed'
          ? 'text-emerald-500'
          : status === 'aborted'
            ? 'text-destructive'
            : 'text-amber-500'
      )}
    >
      {label}
    </span>
  )
}
```

Note the `setInterval` callback's local `const t = setInterval(...)`
SHADOWS the outer `useTranslation()` `t` inside that one `useEffect` —
safe, that scope never calls the translation function. `STATUS_GLYPH`/
`STATUS_COLOR` stay exactly as module-level constants (visual values, not
text).

- [ ] **Step 7: Rewrite `group-message-bubble.tsx`**

Add the import and array-form hook:

```tsx
// src/renderer/components/philharmonic/chat/group-message-bubble.tsx
import { format } from 'date-fns'
import { CheckIcon, Loader2Icon, WrenchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ArtifactCard } from '@/components/calling-tools/artifact/artifact-card'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
```

(types/interfaces unchanged — `ArtifactPart`, `BubbleModel`)

```tsx
export function GroupMessageBubble({
  bubble,
  agentsById,
  teamsById
}: {
  bubble: BubbleModel
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const isUser = bubble.role === 'user'
  const isSystem = bubble.role === 'system'
  const isPm = bubble.role === 'pm'
  const agent = bubble.agentId ? agentsById[bubble.agentId] : undefined
  const team = agent?.teamId ? teamsById[agent.teamId] : undefined
  const name = isUser
    ? t('state.you')
    : isPm
      ? t('philharmonic:chat.roles.pm')
      : (agent?.name ?? t('philharmonic:chat.roles.employeeFallback'))
```

Everything from `if (isSystem) { ... }` through the end of the function
stays structurally identical — only the two literal `"PM"`/`"You"` JSX
text nodes (the avatar-badge divs) change:

```tsx
      {isPm ? (
        <div className="bg-primary text-primary-foreground ring-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-[3px]">
          {t('philharmonic:chat.roles.pm')}
        </div>
      ) : isUser ? (
        <div className="bg-accent text-accent-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
          {t('state.you')}
        </div>
      ) : (
```

Everything else in the render (headerLine, attachments, markdown body,
artifacts, tool cards) stays exactly as-is — all dynamic content.

- [ ] **Step 8: Append namespace + render tests**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block:

```ts
it('has the composer, attachment, and uploader keys', () => {
  expect(philharmonic.chat.attachmentPreview.removeAria).toBe('Remove {{name}}')
  expect(philharmonic.chat.uploader.attachAria).toBe('Attach images')
  expect(philharmonic.chat.composer.placeholder).toBe('Message your team…')
})

it('has the plan card elapsed/status/aria keys', () => {
  expect(philharmonic.chat.planCard.elapsed).toMatchObject({
    lessThanMin: '<1 min',
    minutes: '{{count}} min',
    hoursMinutes: '{{hours}}h {{minutes}}m'
  })
  expect(philharmonic.chat.planCard.status).toMatchObject({
    active: 'active',
    done: 'done',
    aborted: 'aborted',
    draft: 'draft'
  })
  expect(philharmonic.chat.planCard.stepStatusAria).toMatchObject({
    pending: 'Pending',
    running: 'Running',
    done: 'Done',
    skipped: 'Skipped',
    failed: 'Failed'
  })
})

it('has the shared role-name keys', () => {
  expect(philharmonic.chat.roles).toMatchObject({
    pm: 'PM',
    employeeFallback: 'Employee'
  })
})
```

Add a new top-level `describe` block at the end of the file, rendering
the REAL exported component:

```ts
describe('philharmonic namespace chat.composer.hint renders correctly via Trans', () => {
  it('hint — two <kbd> elements at indices 1 and 4, correct positions', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { ComposerHint } =
      await import('@/components/philharmonic/chat/composer')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(ComposerHint))
    )
    expect(html).toBe(
      '<p class="text-muted-foreground mt-1.5 px-1 text-[10px]">Press <kbd class="bg-background rounded px-1 py-px">Enter</kbd> to send, <kbd class="bg-background ml-1 rounded px-1 py-px">Shift + Enter</kbd> for a new line. Paste or attach images.</p>'
    )
  })
})
```

- [ ] **Step 9: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires). Pay special attention to the new
`chat.composer.hint` render test — if it fails, re-derive the indices
empirically, don't force the assertion.

Manually grep-verify zero missing/orphaned `chat.*` keys among what this
task added (Task 2 adds the rest of the section).

```bash
git add src/renderer/components/philharmonic/chat/attachment-preview.tsx \
  src/renderer/components/philharmonic/chat/uploader.tsx \
  src/renderer/components/philharmonic/chat/composer.tsx \
  src/renderer/components/philharmonic/chat/plan-card.tsx \
  src/renderer/components/philharmonic/chat/group-message-bubble.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's composer, plan card, and message bubble (sub-plan 3a/N)"
```

---

### Task 2: Members panel, conversation sidebar, and group chat header

**Files:**

- Modify: `src/renderer/components/philharmonic/chat/group-members-panel.tsx`
- Modify: `src/renderer/components/philharmonic/chat/conversation-list.tsx`
- Modify: `src/renderer/components/philharmonic/chat/group-chat.tsx`
- Modify: `src/shared/i18n/locales/en/philharmonic.json`
- Modify: `tests/unit/i18n/philharmonic-namespace.test.ts` (append)

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`
  (`useTranslation('philharmonic')`, or array-form
  `useTranslation(['common', 'philharmonic'])` in `conversation-list.tsx`
  which already used `common` for `action.delete`/`action.cancel`);
  `i18n.t()` from `@/lib/i18n` in `conversation-list.tsx`'s plain
  `smartTime()`/`previewLine()` and `group-chat.tsx`'s plain
  `formatDayLabel()`. Consumes `chat.roles.pm`/`chat.roles.employeeFallback`
  from Task 1.
- Produces: the exported `DeleteGroupDescription` component (consumed by
  `conversation-list.tsx`'s own JSX and this task's own render test).

- [ ] **Step 1: Add the rest of the `chat` section to `philharmonic.json`**

Extend the `chat` object added in Task 1 with these additional sibling
keys:

```json
    "membersPanel": {
      "heading": "Members",
      "coordinatorsLabel": "Coordinators",
      "unassignedLabel": "Unassigned",
      "idleCount": "{{count}} idle",
      "busyCount": "{{count}} busy",
      "idle": "idle",
      "noTeam": "No team",
      "pmIdleActivity": "Strategy · idle",
      "emptyState": {
        "title": "No teammates yet",
        "description": "The PM will recruit teammates as needed."
      }
    },
    "conversationList": {
      "configNav": {
        "workforce": "Workforce",
        "dashboard": "Dashboard"
      },
      "searchPlaceholder": "Search groups",
      "newGroupMenuItem": "New group",
      "emptyState": {
        "title": "No groups yet",
        "description": "Create one to message your virtual team.",
        "createButton": "+ New group"
      },
      "searchNoMatch": "No groups match “{{query}}”",
      "noMessagesYetPreview": "New group · no messages yet",
      "deleteDialog": {
        "title": "Delete this group?",
        "description": "<0>{{title}}</0> and all its messages, tasks, and executions will be permanently removed."
      }
    },
    "dateLabels": {
      "today": "Today",
      "yesterday": "Yesterday"
    },
    "groupChat": {
      "renameTitle": "Click to rename",
      "memberCount_one": "{{count}} member",
      "memberCount_other": "{{count}} members",
      "toggleMembersAria": "Toggle members",
      "emptyState": {
        "title": "Hand something to your team",
        "description": "Describe what you need. The PM will analyze, recruit and delegate to virtual employees, then report back here."
      },
      "askUser": {
        "replyPlaceholder": "Reply to PM…",
        "sendButton": "Send"
      }
    }
```

(The `philharmonic.json` `chat` object now has: `attachmentPreview`,
`uploader`, `composer`, `planCard`, `roles` from Task 1, plus
`membersPanel`, `conversationList`, `dateLabels`, `groupChat` from this
step.)

- [ ] **Step 2: Rewrite `group-members-panel.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/group-members-panel.tsx
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { PhilharmonicEmptyState } from '../empty-state'

interface Group {
  key: string
  label: string
  icon: string | null
  members: AgentData[]
  isCoordinators?: boolean
}

function partition(
  members: AgentData[],
  teamsById: Record<string, TeamData>,
  includePm: boolean,
  coordinatorsLabel: string,
  unassignedLabel: string
): Group[] {
  const byTeam = new Map<string, AgentData[]>()
  const unassigned: AgentData[] = []
  for (const m of members) {
    if (m.teamId && teamsById[m.teamId]) {
      const arr = byTeam.get(m.teamId) ?? []
      arr.push(m)
      byTeam.set(m.teamId, arr)
    } else {
      unassigned.push(m)
    }
  }
  const teamGroups: Group[] = Array.from(byTeam.entries())
    .toSorted(([a], [b]) => teamsById[a].name.localeCompare(teamsById[b].name))
    .map(([id, ms]) => ({
      key: id,
      label: teamsById[id].name,
      icon: teamsById[id].icon ?? null,
      members: ms
    }))
  const groups: Group[] = []
  if (includePm) {
    groups.push({
      key: '__coord__',
      label: coordinatorsLabel,
      icon: '🧭',
      members: [],
      isCoordinators: true
    })
  }
  groups.push(...teamGroups)
  if (unassigned.length) {
    groups.push({
      key: '__unassigned__',
      label: unassignedLabel,
      icon: '👤',
      members: unassigned
    })
  }
  return groups
}

/** Sentinel key the PM occupies inside `busyAgents`. Mirrors busy-reducer's
 * PM_KEY but kept local so we don't import a hook-side constant into a UI
 * component. */
const PM_KEY = '__pm__'

export function GroupMembersPanel({
  members,
  teamsById,
  busyAgents,
  hasPm = true
}: {
  members: AgentData[]
  teamsById: Record<string, TeamData>
  /** actorId → activity label; presence means "busy". '__pm__' for the PM. */
  busyAgents: ReadonlyMap<string, string>
  hasPm?: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const groups = partition(
    members,
    teamsById,
    hasPm,
    t('chat.membersPanel.coordinatorsLabel'),
    t('chat.membersPanel.unassignedLabel')
  )
  const busyCount = members.filter((m) => busyAgents.has(m.id)).length
  const idleCount = members.length - busyCount
  const pmActivity = busyAgents.get(PM_KEY)
  const pmBusy = pmActivity !== undefined
  const summaryIdle = idleCount + (hasPm && !pmBusy ? 1 : 0)
  const summaryBusy = busyCount + (hasPm && pmBusy ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-13 shrink-0 items-center justify-between border-b px-3.5">
        <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
          {t('chat.membersPanel.heading')}
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-normal">
            {members.length + (hasPm ? 1 : 0)}
          </span>
        </div>
        <div className="text-muted-foreground flex gap-3 text-[10.5px]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t('chat.membersPanel.idleCount', { count: summaryIdle })}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            {t('chat.membersPanel.busyCount', { count: summaryBusy })}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {members.length === 0 && !hasPm ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('chat.membersPanel.emptyState.title')}
            description={t('chat.membersPanel.emptyState.description')}
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="pt-3">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5 px-1 text-[10.5px] tracking-wider uppercase">
                {g.icon && <span>{g.icon}</span>}
                <span>
                  {g.label} · {g.isCoordinators ? 1 : g.members.length}
                </span>
              </div>
              {g.isCoordinators ? (
                <PmRow activity={pmActivity} />
              ) : (
                g.members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    team={m.teamId ? teamsById[m.teamId] : undefined}
                    activity={busyAgents.get(m.id)}
                  />
                ))
              )}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  team,
  activity
}: {
  member: AgentData
  team: TeamData | undefined
  /** Activity label when busy; undefined when idle. */
  activity: string | undefined
}) {
  const { t } = useTranslation('philharmonic')
  const busy = activity !== undefined
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-2',
        busy && 'bg-muted'
      )}
    >
      <div className="relative">
        <EmployeeAvatar
          seed={member.avatarSeed}
          style={member.avatarStyle}
          size={36}
        />
        <span
          className={cn(
            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
            busy
              ? 'ring-muted animate-pulse bg-amber-500'
              : 'ring-card bg-emerald-500'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {member.name}
        </div>
        <div
          className={cn(
            'truncate text-xs',
            busy ? 'text-amber-500' : 'text-muted-foreground'
          )}
        >
          {busy
            ? activity
            : `${team?.name ?? t('chat.membersPanel.noTeam')} · ${t('chat.membersPanel.idle')}`}
        </div>
      </div>
    </div>
  )
}

function PmRow({ activity }: { activity: string | undefined }) {
  const { t } = useTranslation('philharmonic')
  const busy = activity !== undefined
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-2',
        busy && 'bg-muted'
      )}
    >
      <div className="relative">
        <div className="bg-primary text-primary-foreground flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold">
          {t('chat.roles.pm')}
        </div>
        <span
          className={cn(
            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
            busy
              ? 'ring-muted animate-pulse bg-amber-500'
              : 'ring-card bg-emerald-500'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {t('chat.roles.pm')}
        </div>
        <div
          className={cn(
            'truncate text-xs',
            busy ? 'text-amber-500' : 'text-muted-foreground'
          )}
        >
          {busy ? activity : t('chat.membersPanel.pmIdleActivity')}
        </div>
      </div>
    </div>
  )
}
```

Note `partition()` now takes the two translated group labels as
parameters (it's a plain helper called from within the component, so
threading `t()`'s OUTPUT through as params — rather than importing
`i18n.t()` inside `partition()` itself — keeps it consistent with the
fact it's only ever called from one render path with a live `t`
already in scope).

- [ ] **Step 3: Rewrite `conversation-list.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/conversation-list.tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import {
  differenceInCalendarDays,
  format,
  isToday,
  isYesterday
} from 'date-fns'
import {
  LayoutDashboardIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2,
  UsersIcon
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { PhilharmonicEmptyState } from '@/components/philharmonic/empty-state'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AgentData, ConversationData } from '@/stores/philharmonic'

import { hueStyle, pickHue } from '../lib/hue'

export type ConfigPage = 'workforce' | 'dashboard'

export function DeleteGroupDescription({ title }: { title: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="chat.conversationList.deleteDialog.description"
      values={{ title }}
    >
      <span className="bg-muted rounded-sm px-1.5 py-0.5 font-mono text-xs">
        {title}
      </span>{' '}
      and all its messages, tasks, and executions will be permanently removed.
    </Trans>
  )
}

/** Smart timestamp: HH:mm today, 'Yesterday', day name within the week, otherwise MM/dd. */
function smartTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isToday(d)) return format(d, 'HH:mm')
    if (isYesterday(d)) return i18n.t('philharmonic:chat.dateLabels.yesterday')
    const diff = differenceInCalendarDays(new Date(), d)
    if (diff < 7) return format(d, 'EEE')
    return format(d, 'MM/dd')
  } catch {
    return ''
  }
}

function previewLine(
  latest: ConversationData['latestMessage'],
  agentsById: Record<string, AgentData>
): string {
  if (!latest) return ''
  const text = latest.content.replace(/\s+/g, ' ').trim()
  if (latest.role === 'system') return text
  const senderLabel =
    latest.role === 'user'
      ? i18n.t('common:state.you')
      : latest.role === 'pm'
        ? i18n.t('philharmonic:chat.roles.pm')
        : latest.agentId
          ? (agentsById[latest.agentId]?.name ??
            i18n.t('philharmonic:chat.roles.employeeFallback'))
          : i18n.t('philharmonic:chat.roles.employeeFallback')
  return `${senderLabel}: ${text}`
}

export function ConversationList({
  conversations,
  agentsById,
  activeId,
  activePage,
  onSelect,
  onCreate,
  onDelete,
  onNavigateConfig
}: {
  conversations: ConversationData[]
  agentsById: Record<string, AgentData>
  activeId: string | null
  activePage: 'chat' | ConfigPage
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void | Promise<void>
  onNavigateConfig: (page: ConfigPage) => void
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const configNav = useMemo(
    () => [
      {
        page: 'workforce' as const,
        label: t('philharmonic:chat.conversationList.configNav.workforce'),
        icon: UsersIcon
      },
      {
        page: 'dashboard' as const,
        label: t('philharmonic:chat.conversationList.configNav.dashboard'),
        icon: LayoutDashboardIcon
      }
    ],
    [t]
  )
  const [confirming, setConfirming] = useState<ConversationData | null>(null)
  const [query, setQuery] = useState('')
  const isFullscreen = useIsFullscreen()

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      const inTitle = c.title.toLowerCase().includes(q)
      const inPreview =
        c.latestMessage?.content?.toLowerCase().includes(q) ?? false
      return inTitle || inPreview
    })
  }, [conversations, query])

  return (
    <Sidebar
      collapsible="none"
      className={cn(
        'text-foreground h-full w-full border-none bg-transparent',
        '[--sidebar-accent:rgb(0_0_0/0.05)] dark:[--sidebar-accent:rgb(255_255_255/0.07)]'
      )}
    >
      <SidebarHeader
        className={cn('draggable gap-1 pt-11 transition-[padding]', {
          ['pt-2']: isFullscreen
        })}
      >
        <div className="flex items-center px-1 pb-1">
          <WorkspaceSwitcher />
        </div>

        <div className="no-drag px-1">
          <InputGroup className="has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                'philharmonic:chat.conversationList.searchPlaceholder'
              )}
            />
            <InputGroupAddon align="inline-start">
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
        </div>

        <SidebarMenu className="gap-1">
          <SidebarMenuItem
            className="no-drag hover:bg-sidebar-accent flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150"
            onClick={onCreate}
            data-testid={TEST_IDS.philharmonic.newGroup}
          >
            <SquarePenIcon size={16} />
            {t('philharmonic:chat.conversationList.newGroupMenuItem')}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="no-scrollbar px-1">
        {conversations.length === 0 ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('philharmonic:chat.conversationList.emptyState.title')}
            description={t(
              'philharmonic:chat.conversationList.emptyState.description'
            )}
            action={{
              label: t(
                'philharmonic:chat.conversationList.emptyState.createButton'
              ),
              onClick: onCreate
            }}
          />
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs">
            {t('philharmonic:chat.conversationList.searchNoMatch', {
              query
            })}
          </div>
        ) : (
          <SidebarMenu className="gap-0.5">
            {filtered.map((c) => {
              const isActive = activePage === 'chat' && c.id === activeId
              const preview = previewLine(c.latestMessage, agentsById)
              return (
                <SidebarMenuItem key={c.id}>
                  <ContextMenu>
                    <ContextMenuTrigger>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-sidebar-accent'
                            : 'hover:bg-sidebar-accent/60'
                        )}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
                          style={hueStyle(pickHue(c.id))}
                        >
                          {c.icon ?? '💬'}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-medium">
                              {c.title}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                              {smartTime(c.lastMessageAt)}
                            </span>
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {preview ||
                              t(
                                'philharmonic:chat.conversationList.noMessagesYetPreview'
                              )}
                          </span>
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setConfirming(c)}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t('action.delete')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-0.5">
          {configNav.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.page}>
                <SidebarMenuButton
                  isActive={activePage === item.page}
                  onClick={() => onNavigateConfig(item.page)}
                >
                  <Icon />
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarFooter>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:chat.conversationList.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? (
                <DeleteGroupDescription title={confirming.title} />
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
                if (!confirming) return
                const id = confirming.id
                setConfirming(null)
                await onDelete(id)
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}
```

Note `t('action.delete')`/`t('action.cancel')` keep resolving unprefixed
from `common` (still listed first in the array form) — unchanged from
before.

- [ ] **Step 4: Run the formatter and re-verify `DeleteGroupDescription`'s Trans block**

Run: `pnpm format` (or
`./node_modules/.bin/oxfmt src/renderer/components/philharmonic/chat/conversation-list.tsx`)

Confirm the JSX still has `{' '}` in exactly the one position shown
above (after `</span>`). If `oxfmt` changed it, re-derive the `<0>`
index empirically before trusting it.

- [ ] **Step 5: Rewrite `group-chat.tsx`**

```tsx
// src/renderer/components/philharmonic/chat/group-chat.tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import { isSameDay, isToday, isYesterday, format } from 'date-fns'
import { AlertTriangleIcon, HelpCircleIcon, UsersIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  getConversationMessages,
  interruptConversation,
  respondToConversation,
  sendConversationMessage
} from '@/services/philharmonic-chat'
import type {
  AgentData,
  ConversationData,
  ConversationMessageData,
  TeamData
} from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { PhilharmonicEmptyState } from '../empty-state'
import { Composer } from './composer'
import { GroupMessageBubble, type BubbleModel } from './group-message-bubble'
import { PlanCard } from './plan-card'

type BubbleWithDate = BubbleModel & { createdAt?: string }

function formatDayLabel(d: Date): string {
  if (isToday(d)) return i18n.t('philharmonic:chat.dateLabels.today')
  if (isYesterday(d)) return i18n.t('philharmonic:chat.dateLabels.yesterday')
  return format(d, 'PPP')
}

import type { ConversationStream } from '@/hooks/use-conversation-stream'

export function GroupChat({
  conversation,
  agentsById,
  teamsById,
  members,
  stream,
  onRename,
  membersOpen,
  onToggleMembers
}: {
  conversation: ConversationData
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
  members: AgentData[]
  /** Aggregated SSE stream, hoisted from the container so the Members panel
   * sees the same busy state. */
  stream: ConversationStream
  onRename: (id: string, title: string) => void | Promise<void>
  membersOpen: boolean
  onToggleMembers: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const conversationId = conversation.id
  const { open: sidebarOpen } = useSidebar()
  const isFullscreen = useIsFullscreen()
  const [history, setHistory] = useState<ConversationMessageData[]>([])
  const { bubbles, askUser, error, revision, plan, pmRunning } = stream
  const [answer, setAnswer] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(conversation.title)
  // Track the conversation id + title we last synced from so we can reset
  // draftTitle/editingTitle during render when they change — the React-blessed
  // "store previous prop" approach (avoids stale state on the first render that
  // a useEffect-based reset would cause).
  const [prevConversationId, setPrevConversationId] = useState(conversationId)
  const [prevConversationTitle, setPrevConversationTitle] = useState(
    conversation.title
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  if (
    conversationId !== prevConversationId ||
    conversation.title !== prevConversationTitle
  ) {
    setPrevConversationId(conversationId)
    setPrevConversationTitle(conversation.title)
    setDraftTitle(conversation.title)
    setEditingTitle(false)
  }

  const commitTitle = () => {
    const next = draftTitle.trim()
    setEditingTitle(false)
    if (!next || next === conversation.title) {
      setDraftTitle(conversation.title)
      return
    }
    onRename(conversation.id, next)
  }

  const load = useCallback(() => {
    getConversationMessages(conversationId).then(setHistory)
  }, [conversationId])

  useEffect(() => load(), [load])
  useEffect(() => load(), [revision, load]) // refetch on each message_end

  // Persisted history is source of truth; live bubbles only for not-yet-saved.
  const persistedIds = useMemo(
    () => new Set(history.map((h) => h.id)),
    [history]
  )
  const merged: BubbleWithDate[] = useMemo(() => {
    const fromHistory: BubbleWithDate[] = history.map((h) => {
      // Pull typed parts out of the JSONB column so the bubble doesn't need
      // to know about storage layout. Two kinds today: 'attachment' (images
      // from the user) and 'artifact' (PM final report from P1-7).
      const parts = h.parts ?? []
      const attachments = parts
        .filter(
          (
            p
          ): p is {
            kind: 'attachment'
            name: string
            url: string
            contentType: string
          } =>
            typeof p === 'object' &&
            p !== null &&
            (p as { kind?: unknown }).kind === 'attachment'
        )
        .map((p) => ({
          name: p.name,
          url: p.url,
          contentType: p.contentType
        }))
      const artifacts = parts
        .filter(
          (
            p
          ): p is {
            kind: 'artifact'
            artifactId: string
            title: string
            code: string
          } =>
            typeof p === 'object' &&
            p !== null &&
            (p as { kind?: unknown }).kind === 'artifact'
        )
        .map((p) => ({
          artifactId: p.artifactId,
          title: p.title,
          code: p.code
        }))
      return {
        conversationId,
        messageId: h.id,
        role: h.role,
        agentId: h.agentId,
        text: h.content,
        createdAt: h.createdAt,
        attachments: attachments.length > 0 ? attachments : undefined,
        artifacts: artifacts.length > 0 ? artifacts : undefined
      }
    })
    const live: BubbleWithDate[] = bubbles.flatMap((b) => {
      if (persistedIds.has(b.messageId)) return []
      // Lift any artifact tool-card results into a live `artifacts` array
      // so the ArtifactCard renders the moment createReport's tool_end
      // arrives — no need to wait for the row to persist.
      const liveArtifacts = (b.toolCards ?? []).flatMap(
        (
          c
        ): {
          artifactId: string
          title: string
          code: string
        }[] => {
          if (c.phase !== 'end') return []
          const r = c.result as { type?: unknown } | null
          if (r == null || r.type !== 'artifact') return []
          const result = c.result as {
            artifactId: string
            title: string
            code: string
          }
          return [
            {
              artifactId: result.artifactId,
              title: result.title,
              code: result.code
            }
          ]
        }
      )
      return [
        {
          conversationId,
          messageId: b.messageId,
          role: b.role,
          agentId: b.agentId,
          text: b.text,
          toolCards: b.toolCards,
          artifacts: liveArtifacts.length > 0 ? liveArtifacts : undefined
          // live bubbles have no persisted createdAt — they're "now"
        }
      ]
    })
    return [...fromHistory, ...live]
  }, [history, bubbles, persistedIds, conversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [merged.length, bubbles])

  const memberCount = conversation.memberAgentIds?.length ?? members.length
  const visibleMembers = members.slice(0, 3)
  const overflow = Math.max(0, memberCount - 3)
  const primaryTeam = visibleMembers[0]?.teamId
    ? (teamsById[visibleMembers[0].teamId]?.name ?? null)
    : null

  return (
    <div className="flex h-full flex-col">
      <header
        className={cn(
          'draggable border-border bg-card/80 flex h-12 shrink-0 items-center gap-2 border-b pr-3 backdrop-blur-sm transition-[padding] duration-200 ease-linear',
          sidebarOpen ? 'pl-2' : isFullscreen ? 'pl-4' : 'pl-21'
        )}
      >
        <SidebarTrigger className="no-drag text-muted-foreground hover:text-foreground shrink-0" />
        <div className="no-drag flex min-w-0 flex-1 items-center gap-3">
          {visibleMembers.length > 0 ? (
            <div className="flex">
              {visibleMembers.map((m, i) => (
                <EmployeeAvatar
                  key={m.id}
                  seed={m.avatarSeed}
                  style={m.avatarStyle}
                  size={30}
                  className={cn(i > 0 && '-ml-2 ring-2 ring-card')}
                />
              ))}
              {overflow > 0 && (
                <span className="bg-muted text-muted-foreground ring-card -ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[10px] font-semibold ring-2">
                  +{overflow}
                </span>
              )}
            </div>
          ) : (
            <span className="text-base">{conversation.icon ?? '💬'}</span>
          )}
          <div className="min-w-0">
            {editingTitle ? (
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitTitle()
                  } else if (e.key === 'Escape') {
                    setDraftTitle(conversation.title)
                    setEditingTitle(false)
                  }
                }}
                autoFocus
                className="border-border bg-muted h-7 rounded-lg text-sm font-semibold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                title={t('chat.groupChat.renameTitle')}
                className="text-foreground truncate text-left text-sm font-semibold tracking-tight transition-colors hover:underline"
              >
                {conversation.title}
              </button>
            )}
            <div className="text-muted-foreground text-[11px]">
              {t('chat.groupChat.memberCount', { count: memberCount })}
              {primaryTeam ? ` · ${primaryTeam}` : ''}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.groupChat.toggleMembersAria')}
          data-testid={TEST_IDS.philharmonic.membersToggle}
          onClick={onToggleMembers}
          className={cn(
            'no-drag text-muted-foreground hover:text-foreground shrink-0 rounded-full',
            membersOpen && 'bg-accent text-foreground'
          )}
        >
          <UsersIcon />
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {plan && plan.steps.length > 0 && (
          <div className="mx-auto max-w-2xl">
            <PlanCard plan={plan} agentsById={agentsById} />
          </div>
        )}
        {merged.length === 0 ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('chat.groupChat.emptyState.title')}
            description={t('chat.groupChat.emptyState.description')}
          />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-1">
            {merged.map((b, i) => {
              const prev = i > 0 ? merged[i - 1] : null
              // Use null when createdAt is absent (e.g. live streaming bubble) so
              // the day divider is skipped rather than using an unstable new Date().
              const curDate = b.createdAt ? new Date(b.createdAt) : null
              const prevDate = prev?.createdAt ? new Date(prev.createdAt) : null
              const showDay =
                curDate !== null && (!prevDate || !isSameDay(curDate, prevDate))
              return (
                <div key={b.messageId}>
                  {showDay && curDate && (
                    <div className="my-3 flex items-center gap-3">
                      <div className="border-border/60 flex-1 border-t" />
                      <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        {formatDayLabel(curDate)}
                      </span>
                      <div className="border-border/60 flex-1 border-t" />
                    </div>
                  )}
                  <GroupMessageBubble
                    bubble={b}
                    agentsById={agentsById}
                    teamsById={teamsById}
                  />
                </div>
              )
            })}
          </div>
        )}
        {error && (
          <div className="text-destructive bg-destructive/10 mx-auto mt-2 flex max-w-2xl items-center gap-2 rounded-lg px-3 py-2 text-xs">
            <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {askUser && (
          <div className="border-border bg-muted mx-auto my-3 max-w-2xl rounded-xl border p-3">
            <div className="text-foreground mb-2 flex items-start gap-2 text-sm">
              <HelpCircleIcon className="text-primary mt-0.5 h-4 w-4 shrink-0" />
              <span>{askUser.question}</span>
            </div>
            <div className="flex gap-2">
              <Input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={t('chat.groupChat.askUser.replyPlaceholder')}
                autoFocus
                className="border-border bg-card rounded-lg"
              />
              <Button
                onClick={async () => {
                  if (!answer.trim()) return
                  await respondToConversation(conversationId, answer)
                  setAnswer('')
                }}
              >
                {t('chat.groupChat.askUser.sendButton')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <Composer
        onSend={(text, attachments) =>
          sendConversationMessage(conversationId, text, attachments)
        }
        busy={pmRunning}
        onStop={() => {
          interruptConversation(conversationId).catch(() => {})
        }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Append namespace + render tests**

Add to `tests/unit/i18n/philharmonic-namespace.test.ts`, inside the
existing `describe('philharmonic namespace (en)', ...)` block:

```ts
it('has the members panel keys', () => {
  expect(philharmonic.chat.membersPanel).toMatchObject({
    heading: 'Members',
    coordinatorsLabel: 'Coordinators',
    unassignedLabel: 'Unassigned',
    idleCount: '{{count}} idle',
    busyCount: '{{count}} busy'
  })
})

it('has the conversation list keys, three distinct "New group" copies', () => {
  expect(philharmonic.chat.conversationList.newGroupMenuItem).toBe('New group')
  expect(philharmonic.chat.conversationList.emptyState.createButton).toBe(
    '+ New group'
  )
  expect(philharmonic.chat.conversationList.noMessagesYetPreview).toBe(
    'New group · no messages yet'
  )
  expect(philharmonic.container.newGroupDefaultTitle).toBe('New group')
})

it('has the shared date labels', () => {
  expect(philharmonic.chat.dateLabels).toMatchObject({
    today: 'Today',
    yesterday: 'Yesterday'
  })
})

it('has real pluralization for the group chat member count', () => {
  expect(philharmonic.chat.groupChat).toMatchObject({
    memberCount_one: '{{count}} member',
    memberCount_other: '{{count}} members'
  })
})
```

Add a new top-level `describe` block at the end of the file:

```ts
describe('philharmonic namespace chat.conversationList.deleteDialog.description renders correctly via Trans', () => {
  it('description — dynamic title in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteGroupDescription } =
      await import('@/components/philharmonic/chat/conversation-list')

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
        createElement(DeleteGroupDescription, { title: 'Marketing Team' })
      )
    )
    expect(html).toBe(
      '<span class="bg-muted rounded-sm px-1.5 py-0.5 font-mono text-xs">Marketing Team</span> and all its messages, tasks, and executions will be permanently removed.'
    )
  })
})
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires). Pay special attention to the new
`deleteDialog.description` render test.

Manually grep-verify zero missing/orphaned `chat.*` keys across ALL 8
files in this sub-plan (Task 1 + Task 2 combined).

```bash
git add src/renderer/components/philharmonic/chat/group-members-panel.tsx \
  src/renderer/components/philharmonic/chat/conversation-list.tsx \
  src/renderer/components/philharmonic/chat/group-chat.tsx \
  src/shared/i18n/locales/en/philharmonic.json \
  tests/unit/i18n/philharmonic-namespace.test.ts
git commit -m "i18n: populate philharmonic namespace's members panel, conversation sidebar, and group chat header (sub-plan 3b/N)"
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
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-philharmonic-chat.md
git commit -m "docs: add philharmonic-chat i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
