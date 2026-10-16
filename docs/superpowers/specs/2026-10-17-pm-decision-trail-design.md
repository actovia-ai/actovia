# The PM's decision trail — every round recorded, shown under its message, queryable in Chat Audit

Date: 2026-10-17 · Status: design agreed in chat (owner, 2026-10-17); spec for the owner's review
Repo: `exodus`, branch `maintenance`
Builds on: `2026-10-16-pm-quota-aware-dealing-design.md` (the PM's roster, quota lines, `waitForQuota`)
— the decisions it adds are the ones most worth auditing.

## 1. Goal

Philharmonic is a harness: the owner settles a piece of work with the PM, the PM plans it and deals
the steps out, the employees report back, and the PM decides the next move. The owner must be able
to see **why** the PM did what it did — whom it gave a step to, with which instructions, what it had
read, what it was refused and what it waited for — after the fact, from the group itself, and in
bulk through SQL.

Today almost none of that survives a round (investigation of 2026-10-17):

- the PM's final message is saved; its text between tool calls, its thinking, its tool calls with
  their arguments, their results and its token usage are dropped (`pm-coordinator.ts`'s event loop
  reads `message_update` / `message_end` text only);
- plan steps are overwritten in place; nothing logs a decision;
- on its next round the PM reads employees' reports as anonymous assistant text (the LCM turns every
  `employee` row into plain text, without the employee's name);
- Chat Audit has no Philharmonic table.

### Decided by the owner (2026-10-17)

| Decision          | Choice                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is for    | **Both**: a readable decision timeline in the UI, backed by the full raw record queryable in Chat Audit                                                                                                                             |
| Scope             | **The PM only** — the receiver of reports and the dealer. An employee's report _is_ its account of its work; it is linked, not re-recorded. CLI employees keep their own session logs; Exodus employees' own steps are out of scope |
| Where it is shown | **In the group chat**, under each PM message, as an expandable "decision process"                                                                                                                                                   |

### Non-goals

- Recording employees' internal steps (Exodus employees' tool calls, CLI employees' turns).
- iOS display.
- A separate audit page, filters, export.
- A retention policy: the trail lives and dies with its group.

## 2. What a round records

A **round** is one run of `runPmCoordinator` (an owner's message, a scheduled firing — including a
quota-reset wake-up). Each gets a `roundId` (uuid). Its events, in order:

| kind          | payload                                                   | source                                                                                                                                       |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`       | `{ trigger: 'user' \| 'scheduled', text }`                | the round's `userText`; `scheduled` when `runScheduledRound` started it                                                                      |
| `reports`     | `{ messages: [{ messageId, agentId, name }] }`            | the `employee` rows the round's context carries since the PM's previous round — ids and names only, the text stays in `conversation_message` |
| `thinking`    | `{ text }`                                                | an assistant message's thinking content, when the provider returns it (Anthropic: summarised thinking; OpenAI: none)                         |
| `text`        | `{ text }`                                                | assistant text between tool calls (the final message's text is its own row, not repeated)                                                    |
| `tool_call`   | `{ toolCallId, name, args }`                              | `tool_execution_start`                                                                                                                       |
| `tool_result` | `{ toolCallId, name, text, isError }`                     | `tool_execution_end` — the full result text the PM read (a delegation's output, a quota refusal, `waitForQuota`'s answer)                    |
| `usage`       | `{ inputTokens, outputTokens, cacheReadTokens, costUsd }` | summed over the round's assistant messages                                                                                                   |
| `error`       | `{ message, aborted }`                                    | the round ended in an error or a Stop                                                                                                        |

Capture is passive: the coordinator's existing `for await` over `agentLoop` handles the extra event
types; the PM's behaviour does not change. Events are written as they happen, so a round that fails
midway keeps what it did.

**Masking.** Every string payload passes through the logger's `secret-mask.ts` (every secret value
decrypted so far) before it is written — instructions can quote a token.

## 3. Storage

Migration 0018:

- `pm_round_event` — `id`, `conversationId` (FK `conversation`, `ON DELETE CASCADE`), `roundId`,
  `seq` (integer, order within the round), `kind` (text), `payload` (jsonb), `createdAt`. Index
  `(conversationId, roundId, seq)`.
- `conversation_message.roundId` (uuid, nullable) — set on the PM's final message and on the
  `⚠️ PM error` / interrupted `system` row of that round, so the UI finds the round from the
  message. Older rows have none and show no disclosure.

Queries in `db/pm-round-queries.ts` (append, list by round). Deleting a group removes its trail
(cascade from `conversation`), and so does anything that deletes conversations (a data reset). Not
part of `db-io` export, like the other Philharmonic tables. "The reports since the PM's previous
round" are the `employee` rows created after that round's `input` event (all of them on a group's
first round).

## 4. The PM reads who reported

`PhilharmonicLcm`'s row → message conversion prefixes an `employee` row's text with its author:
`[<employee name> · <CLI name> · <model>]` for a CLI employee, `[<employee name>]` for an Exodus one
(names from the agents table; a deleted employee reads `[former employee]`). The summary path
(`lcm/summarize.ts`) uses the same label instead of `Employee <agentId>`.

## 5. In the group chat

- Under a PM message that has a `roundId`: a one-line disclosure, collapsed by default —
  "Decision process · 3 delegations · 1 wait" (counts from the round's tool calls; just
  "Decision process" when there are none). It has a `TEST_IDS` entry and a Playwright check.
- Opened, it fetches `GET /api/v1/philharmonic/conversations/:id/rounds/:roundId` (lazy; React
  Query hook) and draws the round top to bottom, each row in plain words:
  - the trigger ("You wrote …" / "Scheduled: Quota reset — continue …");
  - the reports read, by employee name, each a link that scrolls to that message;
  - thinking, folded;
  - each tool call as a sentence — "Gave step 2 to Claude Code · sonnet: <instructions>",
    "Waited for Opus's week — resets Tue 07:00", "Refused: Claude Code's week is used up",
    "Planned 4 steps", "Marked step 2 done" — with the arguments and the result text one click
    further, verbatim;
  - the round's tokens and cost.
- Built from the existing kit (`Reveal`, the settings/motion tokens, `text-xs` meta); every string a
  `philharmonic` catalog key in all 10 locales.
- The route sits with the other `/api/v1/philharmonic` reads; it returns the masked payloads.

## 6. Chat Audit

`analytics/snapshot.ts` adds two tables (defined in `chat-audit-schema.ts`, so completions follow):

- `group_messages` — `id`, `conversation_id`, `role`, `agent_id`, `task_id`, `round_id`, `text`,
  `created_at` (text masked like `messages`);
- `pm_round_events` — `conversation_id`, `round_id`, `seq`, `kind`, `tool_name`, `payload` (JSON),
  `created_at`.

A preset "PM decisions by group" — per group and round: delegations, refusals, waits, tokens, cost —
executed against the fixture snapshot in `snapshot.test.ts` like every preset.

## 7. Testing

- The coordinator on pi's faux provider: a scripted round (thinking, text, `delegateTask`, a quota
  refusal, `waitForQuota`, a final message) records `input`, `reports`, `thinking`, `text`,
  `tool_call` / `tool_result` pairs, `usage` in order, and the final message carries the `roundId`.
- A round that throws midway keeps its earlier events and adds `error`; the error row carries the
  `roundId`.
- A token in the instructions is masked in the stored payload.
- The LCM labels an employee row with its name, CLI and model; the summary path too.
- The route: a round's events in `seq` order; another group's round id is 404.
- The disclosure renders the counts and the sentences from a fixture round (happy-dom); the
  Playwright spec opens it.
- Chat Audit: the two tables are built and the preset runs on the fixture snapshot.
- Migration 0018 on a real in-memory PGlite (`createMigratedPglite`).

## 8. Files

New: `resources/drizzle/0018_*.sql`, `db/pm-round-queries.ts`, `ai/philharmonic/round-recorder.ts`
(the event → row mapping and masking), the renderer disclosure under
`components/philharmonic/chat/`, its hook and service. Changed: `db/schema.ts`,
`ai/philharmonic/pm-coordinator.ts` (round id, event capture), `ai/philharmonic/scheduler.ts`
(trigger), `ai/philharmonic/lcm/*` (labels), the philharmonic route, `group-message-bubble.tsx`,
`analytics/snapshot.ts`, `constants/chat-audit-schema.ts`, `constants/chat-audit-presets.ts`,
`constants/test-ids.ts`, the catalogs, CLAUDE.md, `docs/manual-qa-checklist.md`.
