# Regenerate as a Side-by-Side Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Regenerate shows the newest two answers side by side with "Use this one"; the chosen one stays, the other
folds behind "1 other version"; the model only ever sees the chosen answer.
**Architecture:** two nullable columns on the run's user row (`alternateOf`, `attempt`) + one transition module in main;
one shared pure filter (`runsForContext`) used by both context paths (non-LCM and LCM assembly/compaction); the renderer
groups a regenerate group into one compare segment that reuses `AssistantTurnSegment` per column.
**Tech:** Drizzle/PGlite migration, Hono route, React Query mutation, Vitest (happy-dom for render tests), Playwright on
the faux provider.
**Spec:** `docs/superpowers/specs/2026-09-26-regenerate-compare-design.md` (read it first; it is the authority).

## Global Constraints

- Branch `feat/react-query`, shared tree: another session has uncommitted files (CLAUDE.md hunks, CONTRIBUTING.md,
  README.md, docs/migration-plan.md, package.json, dock-icon.ts, `itinerary-card.tsx` — fails typecheck TS18048 —,
  tests/fixtures/electron.ts, brand/). Never stage/format/revert/stash them; never `git stash`; never `--no-verify`.
  Commit whole files you own via `$SCRATCH/commit-via-worktree.sh "<msg>" <files…>`; CLAUDE.md only by staging your
  hunk with `git apply --cached` and committing by hand through a temp worktree.
- Gate per commit: `bun run fmt` (then `git status` for foreign changes) → `bun run lint` → `env
  PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck` → `bun run i18n:check` → `bun run test`. Trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run `bun run package` from a worktree whose node_modules is a symlink; e2e only in the main tree and only if
  nothing answers on localhost:60223.
- Strings: catalog keys in all 10 locales, same commit. Interactive elements: `TEST_IDS` + a Playwright reference.
  CLAUDE.md updated in the same change (routes list, Chat Flow, render-path bullets).
- Wire names (exact): columns `alternateOf` (uuid, nullable), `attempt` (varchar, nullable); attempt values
  `'comparing' | 'chosen' | 'folded' | 'hidden'`; route `POST /api/v1/chat/:chatId/choose` body `{ runId }`, errors
  `404 RUN_NOT_FOUND`, `409 ATTEMPT_LOCKED`; module `src/main/lib/chat/attempts.ts`; shared filter `runsForContext` in
  `packages/shared/src/utils/attempts.ts`.

## Review Focus

- Regenerate whose new answer fails (provider error) or is stopped → the comparison still shows both; auto-choose on
  the next message picks the newer answer **that has no error / was not aborted**, else the older (test in R1).
- Reloading a chat mid-comparison → identical state from `GET /api/v1/chat/:id` (test in R1: history carries fields).
- A folded answer must never reach a summary: LCM leaf compaction skips `folded`/`hidden` runs (test in R2).
- Double click on Use this one / two quick regenerates → one transition each, state consistent (R1 idempotency, R3
  mutation guard).
- A settled comparison must not re-render while a later run streams (R3 identity test).

---

### R1: Data model, transitions, choose route

Files: `src/main/lib/db/schema.ts` (two columns on `message`), migration via `bun run db:generate` (next is `0011_*`),
`packages/shared/src/types/chat.ts` (`ChatUserMessage` gains `alternateOf?: string | null`, `attempt?: Attempt | null`;
export `type Attempt = 'comparing' | 'chosen' | 'folded' | 'hidden'`), `src/main/lib/server/routes/chat-persistence.ts`
(`toDbRow` / the row→ChatMessage mapping carry both fields for user rows), new `src/main/lib/chat/attempts.ts`,
`src/main/lib/server/routes/chat.ts` (accept `alternateOf` on the incoming user message; call the transitions; new
`POST /:chatId/choose`), request schema for the chat body.

Interfaces produced:

```ts
// src/main/lib/chat/attempts.ts
export async function recordRegenerate(
  chatId: string,
  newRunId: string,
  groupId: string
): Promise<void>
export async function chooseAttempt(
  chatId: string,
  runId: string
): Promise<{ attempts: Record<string, Attempt> }>
// throws NotFound(RUN_NOT_FOUND) / Conflict(ATTEMPT_LOCKED)
export async function settleOpenComparison(chatId: string): Promise<void>
// called before an ordinary run's context is assembled
export function pickAutoChoice(
  runs: Array<{ runId: string; createdAt: Date; failed: boolean }>
): string
```

Rules (spec §2): regenerate → new run `comparing`, newest other visible run of the group `comparing`, every other run
of the group `hidden`; choose → R `chosen`, the group's other visible run `folded`; locked when a run later than the
group exists and R is not already `chosen`; idempotent. `failed` = the run's last assistant row has `stopReason` of
`error` or `aborted`. The group's first run gets `attempt` set on its first regenerate (it was `null`).

- [x] Tests (real in-memory PGlite, `createMigratedPglite` with the new migration): regenerate ×1, ×2, ×3 (oldest
      hidden); choose; swap while last (allowed) and after a later run (409); idempotent choose; unknown run 404;
      `pickAutoChoice` prefers newer non-failed; `settleOpenComparison` on a new ordinary run; `GET /:id` history carries
      `alternateOf`/`attempt`; the migration applies on a DB with existing rows (no backfill, all null).
- [x] Implement; route tests via the Hono app with the presence/auth stack as other chat routes use.
- [ ] Commit `feat(chat): regenerate attempts — data, transitions, choose route`.

### R2: What the model sees

Files: new `packages/shared/src/utils/attempts.ts` (+ export path in the shared package), `src/main/lib/server/routes/
chat.ts` (non-LCM path filters the client history), `src/main/lib/ai/context-management/context-assembler.ts`
(`assembleContext(chatId, budget, freshTailRuns, current?: { runId: string; alternateOf: string | null })`),
`context-management/index.ts` (`LcmManager.assembleContext` passes it), `compaction.ts` (leaf compaction skips
excluded runs), tests incl. `context-assembler.property.test.ts`.

Interface produced:

```ts
// packages/shared/src/utils/attempts.ts
export interface RunAttemptInfo {
  runId: string
  alternateOf: string | null
  attempt: Attempt | null
}
/** Run ids to drop from model context: folded/hidden runs, and — for a current run with alternateOf G — every
 *  other run of group G (G itself and runs with alternateOf G). */
export function excludedRuns(
  runs: RunAttemptInfo[],
  current?: { runId: string; alternateOf: string | null }
): Set<string>
export function runsForContext<T extends { runId: string }>(
  messages: T[],
  infos: RunAttemptInfo[],
  current?: { runId: string; alternateOf: string | null }
): T[]
```

- [x] Table tests for `excludedRuns` (ordinary chat, comparing pair, chosen/folded, hidden, current regenerate).
- [x] Assembler: drop excluded run groups before fresh tail / back-fill; compaction: excluded runs are never chunked into
      a summary. Extend the 40-seed property test with random groups and attempt states: invariant still holds and no
      excluded run's rows appear in output.
- [x] Non-LCM path (`lcmEnabled === false`): filter `allMessages` the same way (infos from the user rows in the body).
- [ ] Commit `feat(chat): the model only sees the chosen attempt`.

### R3: Renderer data — regenerate, segments, choose hook

Files: `src/renderer/hooks/use-chat.ts` (`regenerate` sends `alternateOf` = last run's `alternateOf ?? runId`; stays
stable per CLAUDE.md), `src/renderer/services/chat.ts` (choose call), new `src/renderer/hooks/use-attempts.ts`,
`src/renderer/components/messages.tsx` (`groupIntoSegments` emits a compare segment), tests.

Interfaces produced:

```ts
// messages.tsx segment union gains:
{ kind: 'compare'; key: `group:${string}`; groupId: string; question: ChatUserMessage;
  columns: AssistantTurn[] /* 1 (settled) or 2 (comparing) */; folded: AssistantTurn | null; locked: boolean }
// use-attempts.ts
export function useChooseAttempt(chatId: string): UseMutationResult<void, Error, { runId: string }>
  // optimistic: rewrites attempt fields in the chat's messages via setMessages; rolls back on error
```

- [x] Tests: regenerate request body carries `alternateOf`; `regenerate` identity stable across frames (existing
      use-chat test pattern); `groupIntoSegments` for ordinary / comparing / chosen+folded / hidden; segment identity
      preserved for an unchanged compare segment while a later run streams (extend `messages-rerender.test.ts`);
      mutation optimistic + rollback; double submit guarded (`isPending`).
- [ ] Commit `feat(chat): compare segments and the choose hook`.

### R4: Compare UI + e2e + docs

Files: new `src/renderer/components/chat/compare-turns.tsx` (columns ≥ breakpoint via container query, tabs below using
shadcn `Tabs`; each column renders the existing `AssistantTurnSegment`; header button Use this one), new
`src/renderer/components/chat/other-version-dialog.tsx` (shadcn `Dialog`; renders the folded turn; Use this instead
unless `locked`), `messages.tsx` renders the compare segment, i18n `chat.json` ×10 (`compare.useThis`,
`compare.otherVersion_one/_other`, `compare.useInstead`, `compare.answerTab` with `{{n}}`, `compare.chosen`),
`TEST_IDS.chat.compare.{useThis, otherVersionLink, useInstead, tab}`, Playwright spec `tests/e2e/regenerate-compare.spec.ts`
(faux provider scripts two different answers: send → regenerate → two columns → Use this one on column 1 → folded link
→ dialog → Use this instead → the other is shown), CLAUDE.md (routes list mentions choose; Chat Flow; a render-path
bullet for the compare segment), motion per CLAUDE.md (no new animation beyond `ENTER` for the new column).

- [x] Render tests: two columns at wide width, tabs at narrow width, buttons call the hook, locked hides Use this
      instead, the folded link count text.
- [ ] e2e on a packaged build (main tree, nothing on :60223).
- [ ] Commit `feat(chat): regenerate compares two answers side by side`.

### Final: whole-branch review (most capable model) over R1–R4, one fix wave, scoped re-review.

---

## Status — 2026-09-29

R1–R4 are implemented in the working tree; nothing is committed yet (the owner decides when), and the e2e spec is
written but has not run on a packaged build.

- **R1** was finished by the session of 2026-09-26 (35 tests). One thing it left behind: tests that read `message`
  through the schema need the migrations through `0011` — `context-assembler.property.test.ts` was still on `0008`.
- **R2** — `packages/shared/src/utils/attempts.ts` holds the filter (`excludedRuns`, `runsForContext`) and, beyond the
  plan, the transitions a client shows before the server has answered (`attemptsAfterRegenerate`, `attemptsAfterChoice`,
  `attemptsAfterSettling`); `applyAttempts` moved there from `src/main/lib/chat/attempts.ts`, which re-exports it.
  Assembly and compaction both start from `contextRuns()`. A span a summary replaces takes the context items of an
  excluded run inside it with it.
- **R3** — the segment is `type: 'compare'` (the union's discriminant is `type`, not `kind`). `useChooseAttempt(chatId,
  setMessages)` returns `{ choose, isPending }`: the chat's messages are `useChat`'s state, not a query's, and the
  choice is applied on the click rather than in `onMutate`, which runs a tick later.
- **R4** — `AssistantTurnSegment` moved to `components/chat/assistant-turn-segment.tsx` so the comparison can draw with
  it. Two columns or tabs is decided by measuring (`hooks/use-min-width.ts`, 880 px), not by a container query: it
  changes what is mounted. While comparing, the group — question included — takes the width of the chat
  (`COMPARE_FRAME`). `compare.chosen` was not needed; added `compare.tabsLabel`, `compare.otherVersionTitle`,
  `compare.otherVersionDescription`, `compare.locked`, `compare.chooseFailed`. The Regenerate button got a name and
  `TEST_IDS.chat.regenerate` (the spec needs to press it). `faux-boot.ts` answers `COMPARE_QUESTION` with a new take
  each time it is asked.
- Found on the way: a chat reopened from history was seeded from the copy an earlier visit had cached — the state of a
  regenerate group would have been stale until a reload. `ChatDetail` now waits for this visit's fetch.
- Open: run `tests/e2e/regenerate-compare.spec.ts` (packaged build, nothing on :60223); the commits; the final review.
  Not enforced server-side, as before: "Regenerate only on the last exchange" — `alternateOf` may name any run.
