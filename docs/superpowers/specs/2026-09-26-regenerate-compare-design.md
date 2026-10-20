# Regenerate as a side-by-side comparison — design

Status: approved in conversation on 2026-09-26 (owner chose option B, "按你的建议来就好", then "yes" to the design).
Backlog origin: 2026-09-24, "如果用户点了 regenerate 是否做个分屏, 最多展示两组 (如果用户频繁 regenerate, 保留最新的两个),
然后给个按钮用户 prefer 哪个".

## 1. Behaviour

- **Regenerate** re-asks the last question as a new run (as today) and shows the group as a comparison: the question
  once, the two newest answers side by side below it — the earlier one on the left, the new one streaming on the right.
  Each column has **Use this one**. Below a width breakpoint the columns become two tabs ("Answer 1 / Answer 2").
- **Choosing** collapses the group to the chosen answer with a quiet **1 other version** link; opening it shows the
  other answer read-only with **Use this instead** (a swap). Swapping is allowed only while the group is the chat's last
  exchange; once a later run exists the link still opens the other version, without the swap button.
- **Regenerating again** always compares the newest two: attempts older than that become hidden (kept in the database,
  never shown, never sent to the model).
- **Sending a new message while comparing** chooses the newer answer automatically and folds the other.
- Regenerate is only offered on the last exchange (unchanged).

## 2. Data

Two nullable columns on `message`, meaningful on a run's **user** row (the row whose `id === runId`):

- `alternateOf uuid` — the id of the group's first run. Set on every run a Regenerate creates; `null` on ordinary runs
  and on the group's first run. A group is `{ first run } ∪ { runs with alternateOf = first.id }`.
- `attempt varchar` — `null` (ordinary run, or a group's first run before any regenerate) | `'comparing'` | `'chosen'`
  | `'folded'` | `'hidden'`.

Transitions (all in one server function, `src/main/lib/chat/attempts.ts`):

- **Regenerate** (a user message arrives with `alternateOf = G`): the new run is `comparing`; of the group's other
  runs, the newest visible one becomes `comparing`, every other becomes `hidden`.
- **Choose R** (`POST /api/v1/chat/:chatId/choose { runId }`): R → `chosen`, the other `comparing`/`chosen` run of the
  group → `folded`. Refused (`409 ATTEMPT_LOCKED`) when a run later than the group exists and R is not already
  `chosen`. Idempotent.
- **A new ordinary run** arrives while the chat's last group has two `comparing` runs: the newer → `chosen`, the other
  → `folded`, before context is assembled.

`ChatMessage` on the wire gains optional `alternateOf?: string | null` and `attempt?: …` (on the user message), so the
renderer, `GET` history and the iOS app all read the same state. Migration adds both columns (no backfill: existing runs
are ordinary).

## 3. What the model sees

One shared pure function, `runsForContext` (in `packages/shared`, used by the chat route's non-LCM path and by the LCM
assembler), decides which runs are context:

- runs whose user row is `folded` or `hidden` are excluded;
- while assembling for a run R with `alternateOf = G`, every other run of group G is excluded (the regenerated answer
  must not see the answer it replaces, nor the duplicated question).

LCM groups items by `runId` already; the exclusion is applied at run level before fresh tail / back-fill, so the
invariant "a request starts with a user message and every tool result follows its tool call" still holds. A regenerate
only ever targets the last exchange, which is always in the fresh tail (≥2 runs), so a compacted summary never contains
a folded answer. The property test (`context-assembler.property.test.ts`) gains groups with every attempt state.

## 4. Renderer

- `useChat().regenerate` sends the last question with `alternateOf` = the group's first run id (the last run's own
  `alternateOf ?? runId`).
- `groupIntoSegments` emits one **compare segment** per group with `attempt` set, keyed `group:<firstRunId>`, holding
  the visible runs (two while comparing, the chosen one otherwise, plus a reference to the folded one). Unchanged
  segments keep their identity (the render-path rules in CLAUDE.md); a new `messages-rerender` case covers a compare
  segment beside a streaming run.
- The compare view reuses `AssistantTurnSegment` for each column (so tool cards, citations, memory foot and approvals
  work unchanged); the column header carries **Use this one**; the "1 other version" link opens a dialog with the
  folded run's `AssistantTurnSegment` and, when allowed, **Use this instead**.
- `hooks/use-attempts.ts` wraps the choose route (React Query mutation, optimistic local update of the messages list,
  rolled back on error; the global mutation toast reports failure).
- Strings are catalog keys in all 10 locales; `TEST_IDS` for Use this one / 1 other version / Use this instead and the
  tab switcher, referenced from a Playwright spec on the faux provider (regenerate → two columns → choose → folded
  link → swap).

## 5. Out of scope

- Memory consolidation already ran for a rejected answer; left as is (it mostly records facts from the shared question).
- The iOS app: reads the same fields; a follow-up task hides `folded`/`hidden` runs and later offers a swipe comparison
  with Use this one. Until then the phone shows every run, as today.
- Comparing more than two, editing the question before regenerating, regenerating an earlier exchange.

## 6. Testing

Unit: `attempts.ts` transitions (regenerate ×1/×2/×3, choose, swap allowed/locked, auto-choose on a new run,
idempotency); `runsForContext` table; LCM property test with attempt states; the choose route (404 unknown run, 409
locked); `groupIntoSegments` segments and identity; the compare view render test (columns, tabs under the breakpoint,
buttons). E2E on the faux provider as above.
