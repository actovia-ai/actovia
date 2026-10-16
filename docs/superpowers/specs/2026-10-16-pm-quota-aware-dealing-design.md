# Quota-aware dealing — the PM picks the employee (and so the model) with the CLIs' limits in view

Date: 2026-10-16 · Status: design agreed in chat (owner, 2026-10-16); spec for the owner's review
Repo: `exodus`, branch `maintenance`
Builds on: `2026-10-09-coding-agent-employees-design.md` (Claude Code employees) and
`2026-10-10-codex-employees-design.md` (Codex employees). Everything there holds unless this spec
says otherwise — in particular phase 1's "usage, limits, cost: reported as the CLI reports them",
which this spec extends: the CLI's numbers now also reach the PM.
Reference: the probes of 2026-10-16 — `claude` 2.1.301 `rate_limit_event` (below, verbatim) and
`codex-cli` 0.162.1 `app-server generate-ts` (`GetAccountRateLimitsResponse`, `RateLimitSnapshot`,
`RateLimitWindow`).

## 1. Goal

Philharmonic is a harness: the owner settles a piece of work with the PM (the PM may ask back and
forth until the details are clear), the PM writes the plan, then **deals the steps out**. Dealing
well means two things this spec adds:

1. **Ordinary work to an ordinary hand, hard work to a skilled one.** The PM sees each employee's
   model and chooses by it — `Claude Code · opus` for the hard refactor, `Claude Code · sonnet`
   for the copy edit — which also keeps the skilled hand's quota for the work that needs it.
2. **The limits are part of the deal.** The PM reads what the CLIs report of the owner's quota.
   When the skilled hand is near or at its limit, the PM either downgrades the step to an ordinary
   hand or waits for the reset and then carries on — on its own, saying why in the group.

### Decided by the owner (2026-10-16)

| Decision              | Choice                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a model is chosen | **By employee.** The model stays on the employee (`agent.model`); several employees of one CLI with different models are the tiers. No per-step model, no `model` argument on `delegateTask`                                                                |
| Who decides on limits | **The PM, autonomously**, once the work is settled with the owner. It says what it decided and why in the group; it does not stop to ask. The owner can always step in by writing in the group                                                              |
| Rules vs. judgment    | The decision rules (§4) are guidance, not a state machine: **the PM schedules flexibly** — it may reorder steps, run something else while waiting, split a step so part goes to an ordinary hand, or pick another CLI, whenever that serves the work better |
| Data source           | Only what the CLIs themselves report. No scraping of claude.ai / chatgpt.com usage pages                                                                                                                                                                    |

### Non-goals

- A budget per Group ("this group may use 30 % of the week").
- A usage page, charts or progress bars. The PM reads the numbers; the members panel shows one line.
- Automatic CLI fail-over as a mechanism. The PM sees Codex and Claude Code employees side by side
  and may choose either; that is judgment, not a feature.
- Per-step model overrides (option B/C, declined).
- Reviewing non-text output (artifacts, prototypes in a browser) through computer use — a separate
  research topic (§9).

## 2. What the CLIs report (verified 2026-10-16)

### Claude Code — only during a run

Every turn emits a `rate_limit_event` on stream-json, even when everything is fine:

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed_warning",
    "resetsAt": 1792450800,
    "rateLimitType": "seven_day",
    "utilization": 0.85,
    "overageStatus": "rejected",
    "overageDisabledReason": "org_level_disabled",
    "isUsingOverage": false,
    "surpassedThreshold": 0.75,
    "unifiedWindows": {
      "five_hour": { "utilization": 0.05, "resetsAt": 1792159800 },
      "seven_day": { "utilization": 0.85, "resetsAt": 1792450800 }
    },
    "overageEnabled": false
  },
  "uuid": "…",
  "session_id": "…"
}
```

- `unifiedWindows` gives every account window at once with `utilization` (0–1) and `resetsAt`
  (epoch seconds). `status` is `allowed` | `allowed_warning` | `rejected`; `rateLimitType` names
  the window the status is about.
- A model with a quota of its own (the owner's screenshot: "Fable this week — separate weekly
  limit", 100 %) did not appear in a haiku run. **Open:** it is expected to show up as its own
  `rateLimitType` / window when that model runs; the parser keeps any window or type it does not
  know under its own name, so it needs no code change when it does (§3).
- There is no way to ask Claude Code for its limits without running a turn. Its numbers are
  therefore "as of the last run" — the store keeps the time (§3) and the PM is told it.

### Codex — any time, free

`account/rateLimits/read` on an app-server (no turn, no quota) answers `GetAccountRateLimitsResponse`:
`rateLimits: RateLimitSnapshot` plus `rateLimitsByLimitId: { [limitId]: RateLimitSnapshot }` (a
bucket per metered limit — a model with its own quota is a bucket, named by `limitName` /
`normalModelSlug`) and `ordinaryUsageAllowed: boolean | null`. A snapshot has `primary` and
`secondary: { usedPercent, windowDurationMins, resetsAt } | null` and `rateLimitReachedType`.
`account/rateLimits/updated` during a turn is a sparse update to merge into the last read.

## 3. The quota store

`src/main/lib/agents/quota.ts` (new), one record per CLI:

```ts
type QuotaWindow = {
  name: string // 'five_hour' | 'seven_day' | a model's own window | Codex 'primary' / 'secondary' / a limit id
  usedPercent: number // 0–100
  resetsAt: number | null // epoch ms
  model?: string // set when the window belongs to one model only
}
type CliQuota = {
  cli: CliId
  windows: QuotaWindow[]
  state: 'ok' | 'warning' | 'rejected' // the CLI's own verdict, never inferred from percentages
  overage: boolean // may it run past the limit at a cost
  asOf: number // when this was reported
}
```

- **Claude Code:** the driver turns each `rate_limit_event` into a new `AgentEvent`
  `{ type: 'quota', quota: CliQuota }` (`claude-code/protocol.ts`); `run-agent-employee.ts` hands it
  to the store. The existing notice line stays (unchanged rule: shown only when not `allowed`).
- **Codex:** `readCodexQuota()` in `cli-check.ts`, the same short-lived app-server pattern as
  `listCodexModels` (initialize → `account/rateLimits/read` → exit), cached 60 s. Its
  `account/rateLimits/updated` during a run becomes the same `quota` event, merged into the stored
  record per the protocol's note.
- Persisted to `~/.exodus/agent-quota.json` (a Claude Code reading is only refreshed by the next
  run, so it must survive a restart). Not secret, machine-local, not part of `db-io` or backups; a
  data reset removes it.
- A read never throws: a CLI that reports nothing (logged out, older version, offline) has no
  record and the PM is told "unknown".

## 4. What the PM sees, and how it decides

**The roster** (`pm-coordinator.ts`, both the system prompt's roster text and `delegateTask`'s
description) names each employee's model — `Claude Code · opus`, `Codex · gpt-5.5`, or
`· CLI default` — and adds one line per CLI with a record:

> Claude Code quota (as of 18:20, 2 h ago): 5-hour 5 % (resets 22:10) · week 85 % ⚠ (resets Tue 07:00) · no overage

Codex is read fresh before the roster is built (cached 60 s). Times are the owner's local time.

**Guidance in the PM's system prompt** (rules of thumb; the PM schedules flexibly around them):

- Deal by difficulty: hard or open-ended steps to the strongest suitable model, routine steps to an
  ordinary one — from the start, not only when quota is short, so the skilled hand's quota lasts.
- When a skilled hand's window is at 90 % or more, or its CLI says `warning` / `rejected`:
  - **downgrade** if an ordinary hand can do the step well;
  - **wait** (`waitForQuota`) if the step really needs the skilled hand;
  - weigh how far the reset is: a 5-hour window resets within hours, a weekly one may be days away.
- Meanwhile keep the work moving: run steps that do not need the waiting hand, split a step, or use
  another CLI's employee when that fits.
- Every such decision is one line in the group with the numbers and the reset time, e.g.
  "Opus's week is at 100 %, resets Tue 07:00; this step is a copy edit, so Sonnet takes it."

**Guard in `delegateTask`:** delegating to an employee whose CLI is `rejected` for that employee's
model (or for the account), without overage, does not start a process: the tool returns the window
and its reset time and the PM decides again. A stale reading (Claude Code) never blocks — only a
`rejected` one does, and the run itself will refresh it.

## 5. Waiting

`waitForQuota({ stepId, reason })`, a new PM tool (`pm-tools.ts`):

1. Looks up the reset of the window that blocks the step's assignee; refuses if nothing blocks it
   (the PM should delegate instead).
2. Leaves the step `pending` with a note ("waiting for Opus's weekly quota — resets Tue 07:00").
3. Creates a one-off task (`task.runAt` = reset + 2 min) in the group's conversation titled
   "Quota reset — continue step N". The existing scheduler (`runDueOneOffTasks` →
   `runScheduledRound`) wakes the PM with it; if the app was closed at that time, the next launch's
   sweep does. The PM then reads the quota again and deals.
4. Ends the PM's round.

The owner sees and can cancel the wait in the Schedule tab (existing), and writing in the group
wakes the PM at any time, as it always does. One wait per step: a second `waitForQuota` for the
same step moves the existing task instead of adding one.

## 6. UI

- The group members panel (`group-members-panel.tsx`) already shows each member's model; a CLI
  member gets the CLI's quota line under it, in muted text (same wording as the roster, from new
  `philharmonic` catalog keys in all 10 locales). No bars.
- The PM's decision lines are ordinary PM messages; the wait shows as the step's note in the plan
  and as the scheduled task.

## 7. Testing

- `claude-code/protocol.test.ts`: the probe's `rate_limit_event` above → the `quota` event
  (both windows, `warning`, no overage); an unknown `rateLimitType` / window is kept by name.
- `codex/protocol.test.ts` + a `readCodexQuota` test on the fake app-server: `rateLimitsByLimitId`
  with a per-model bucket; a sparse `updated` merges without clearing earlier values.
- `quota.test.ts`: persistence round-trip, missing/corrupt file → no records, `asOf` kept.
- `pm-coordinator` roster text: model per employee, the quota line, "unknown" without a record.
- `delegateTask` guard: `rejected` without overage → no process, reset returned; stale `ok` → runs.
- `waitForQuota`: step stays pending with its note, a one-off task at reset + 2 min, a second call
  moves it, a step with nothing blocking is refused. Runs on the faux provider (PM tool calls
  scripted), never a key.
- Manual (owner, `docs/manual-qa-checklist.md`): two Claude Code employees (opus / sonnet) and a
  plan with a hard and an easy step — the easy one goes to sonnet; with the weekly window over
  90 % the PM downgrades or waits and says why.

## 8. Files

New: `src/main/lib/agents/quota.ts`. Changed: `agents/driver.ts` (`quota` event),
`agents/claude-code/protocol.ts`, `agents/codex/protocol.ts`, `agents/cli-check.ts`
(`readCodexQuota`), `agents/run-agent-employee.ts`, `ai/philharmonic/pm-coordinator.ts` (roster,
guidance), `ai/philharmonic/pm-tools.ts` (`delegateTask` guard, `waitForQuota`),
`components/philharmonic/chat/group-members-panel.tsx`, the `philharmonic` catalogs, CLAUDE.md
(Philharmonic section), `docs/manual-qa-checklist.md`. No migration.

## 9. Next, separately: reviewing what employees make

Coding agents produce things the PM cannot read as text — a Claude artifact or a prototype in the
browser, a running app, a video. For the PM (or a reviewer employee) to look at them and sign off,
Philharmonic needs computer use: open it, look, judge, give direction. Exodus has a window-scoped
Computer Use V0 for chat (`src/main/lib/computer/`); whether and how it extends to Philharmonic is
its own research and spec, after this one.
