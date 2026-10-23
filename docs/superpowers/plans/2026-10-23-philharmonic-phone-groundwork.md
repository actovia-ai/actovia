# Philharmonic phone groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four desktop changes the iPhone's Philharmonic client needs: a heartbeat on the Philharmonic SSE
streams, `GET …/messages?after=`, group photos saved as fitted data URLs, and `GET /costs?days=`.

**Architecture:** Each change is local to one route or utility in `src/main/lib/server/`, plus the renderer call
that uses it. No schema change, no new route.

**Tech Stack:** Hono, Drizzle on PGlite, Vitest, React 19 renderer.

**Spec:** `/Users/yanceyleo/Code/actovia/ios/docs/superpowers/specs/2026-10-23-ios-philharmonic-design.md`,
section "Desktop changes first".

## Global Constraints

- Work on branch `feat/philharmonic-phone-groundwork` in a git worktree at
  `/Users/yanceyleo/Code/actovia/actovia-wt-phil` (the main checkout is shared with other sessions); merge to master
  only when the owner says so.
- Tests mirror `src/` under `tests/unit/`, import through `@main/…` / `@/…` aliases; DB queries are tested on
  `createMigratedPglite()` (`tests/unit/helpers/migrated-pglite.ts`).
- Pre-commit gate: `bun run fmt` → `bun run lint` → `bun run typecheck` (run as `env PWD=<worktree> …`) →
  `bun run i18n:check` → `bun run test`. Never `--no-verify` (except the known PGlite teardown flake).
- No new user-facing strings expected; if one is needed it goes in all 12 locales.
- CLAUDE.md's Philharmonic section gets one line per change, in the same commit.

## Review Focus

1. A client that disconnects between two heartbeats — the interval must stop (no enqueue on a closed controller,
   no leaked timer). Pinned in Task 1.
2. Two group rows saved in the same millisecond — `after` must neither skip nor repeat one. Pinned in Task 2
   (ordering by `createdAt`, then `id`).
3. A row edited after it was saved (an agent card answered or marked stale) — `after` does not return it; the
   rule is that clients read everything on (re)connect. Pinned in Task 2's renderer step (full read on mount).
4. An attachment URL that is not a data URL (an older client's S3 link) — refused with 400, never handed to the
   model as image data. Pinned in Task 3.
5. `days` that is not 7 or 30 (`0`, `abc`, `-1`) — 400, not a silent all-time answer. Pinned in Task 4.

---

### Task 1: Heartbeat on the Philharmonic streams

**Files:**

- Modify: `src/main/lib/server/utils/sse-manager.ts`
- Modify: `src/main/lib/server/routes/philharmonic-sse.ts` (the three `GET …sse` handlers)
- Test: `tests/unit/main/lib/server/utils/sse-manager.test.ts`

**Interfaces:**

- Produces: `export const SSE_HEARTBEAT_MS = 15_000` and
  `export function startHeartbeat(controller: ReadableStreamDefaultController, signal?: AbortSignal, intervalMs = SSE_HEARTBEAT_MS): () => void`
  in `sse-manager.ts` — enqueues the bytes of `": ping\n\n"` every `intervalMs`; stops on `signal` abort, on an
  enqueue that throws, or when the returned function is called.

- [ ] **Step 1: Write the failing tests** (fake timers)
  - `it('sends a comment line every interval')`: after `vi.advanceTimersByTime(15_000 * 2)` the controller's
    `enqueue` got two calls whose decoded text is `": ping\n\n"`.
  - `it('stops when the request aborts')`: abort, advance 60 s → no further enqueue.
  - `it('stops when the controller is closed')`: `enqueue` throws `TypeError` once → no further call after the
    next interval; no throw escapes.
- [ ] **Step 2: Run** `bunx vitest run tests/unit/main/lib/server/utils/sse-manager.test.ts` — FAIL (`startHeartbeat` not exported).
- [ ] **Step 3: Implement `startHeartbeat`**, and call it in each of the three handlers' `start(controller)` with
      `c.req.raw.signal`.
- [ ] **Step 4: Run** the test file — PASS.
- [ ] **Step 5: Commit** `feat(philharmonic): a heartbeat on the group streams` (CLAUDE.md: the SSE line in the
      Philharmonic section says the streams send `: ping` every 15 s).

### Task 2: `GET /conversations/:id/messages?after=<messageId>`

**Files:**

- Modify: `src/main/lib/db/conversation-queries.ts:108-114`
- Modify: `src/main/lib/server/routes/philharmonic-conversations.ts:179-182`
- Modify: `src/renderer/services/philharmonic-chat.ts:34`, `src/renderer/components/philharmonic/chat/group-chat.tsx:77-87`
- Test: `tests/unit/main/lib/db/conversation-messages-after.test.ts` (new, real PGlite),
  `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts`

**Interfaces:**

- Produces:
  - `getMessagesByConversationId(conversationId: string)` — unchanged signature, now ordered by
    `asc(createdAt), asc(id)`.
  - `getMessagesAfter(conversationId: string, afterId: string): Promise<ConversationMessageRow[] | null>` — the rows
    strictly after the anchor in that order; `null` when the anchor is not a row of that conversation.
  - Route: `?after=` absent → all rows; present and found → the rows after it; not found → `NotFoundError` (404).
  - Renderer: `getConversationMessages(id: string, after?: string)`.

- [ ] **Step 1: Write the failing DB tests** on `createMigratedPglite()`:
  - three rows with distinct times: `getMessagesAfter(conv, first.id)` → `[second, third]`.
  - two rows with the same `createdAt`: whichever sorts first by `id`, `after` it returns exactly the other one.
  - the last row as anchor → `[]`; an id of another conversation → `null`.
- [ ] **Step 2: Write the failing route tests**: `?after=x` calls `getMessagesAfter('id', 'x')`; a `null` result
      answers 404; no query calls `getMessagesByConversationId`.
- [ ] **Step 3: Run** both files — FAIL.
- [ ] **Step 4: Implement** the query (look the anchor up, then `where (createdAt, id) > (anchor.createdAt, anchor.id)`
      with `or(gt(createdAt), and(eq(createdAt), gt(id)))`) and the route branch.
- [ ] **Step 5: Renderer**: `GroupChat` keeps a full read on mount and when the conversation changes; the re-read
      after a `revision` bump asks `after` the last saved row and appends what comes back (a 404 → full read).
- [ ] **Step 6: Run** the two files plus `tests/unit/renderer` philharmonic tests — PASS.
- [ ] **Step 7: Commit** `feat(philharmonic): read a group's messages after a given one`. CLAUDE.md: the route, the
      order, and the rule "rows can change after they are saved (agent cards) — a client reads everything when it
      (re)connects and uses `after` only for the re-read that follows a `message_end`".

### Task 3: Group photos are fitted data URLs

**Files:**

- Modify: `src/renderer/hooks/use-philharmonic-upload.ts` (remove the S3 path: `isS3Configured`, `s3PublicUrl`,
  `uploadViaS3`, the settings read and the fallback warning)
- Modify: `src/main/lib/server/routes/philharmonic-conversations.ts:202-235` (attachment schema + fitting)
- Modify: `src/main/lib/ai/utils/image-fit.ts` (a data-URL entry point)
- Remove the now-unused catalog key `chat.uploader.s3FallbackTitle` from all 12 `philharmonic.json` catalogs if
  nothing else reads it.
- Test: `tests/unit/main/lib/ai/utils/image-fit.test.ts`, `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts`

**Interfaces:**

- Produces: `export function fitImageDataUrl(url: string, contentType: string): { url: string; contentType: string }`
  in `image-fit.ts` — `fitImagePart` applied to `{ type: 'image', data: url, mimeType: contentType }`; returns its
  input unchanged when nothing needed fitting.
- Route: an attachment whose `contentType` starts with `image/` must have a `url` starting with `data:image/`,
  else 400 `Invalid message`; each image attachment goes through `fitImageDataUrl` before
  `createConversationMessage`.

- [ ] **Step 1: Write the failing tests**: route — an `https://…` image attachment → 400; a data URL is passed to
      `fitImageDataUrl` (mocked) and the fitted URL is what `createConversationMessage` receives. `fitImageDataUrl`
      — returns the same object for a non-image content type (no nativeImage call).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both, and strip the S3 path from the upload hook (every photo goes through
      `prepareImageFile` then `uploadViaBase64`).
- [ ] **Step 4: Run** the tests and `bun run i18n:check` — PASS.
- [ ] **Step 5: Commit** `fix(philharmonic): group photos are saved like Chat's` — body names both defects (the
      `/s3-uploader` path that 404s, the S3 link handed to the model as image data). CLAUDE.md: one line.

### Task 4: `GET /costs?days=7|30`

**Files:**

- Modify: `src/main/lib/db/philharmonic-queries.ts:287-296`
- Modify: `src/main/lib/server/routes/philharmonic-conversations.ts:312-315`
- Modify: `src/renderer/services/philharmonic-chat.ts:89-90`, `src/renderer/components/philharmonic/cost-analysis.tsx:235-260`
- Test: `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts`

**Interfaces:**

- Produces: `getPhilharmonicCostRows(since?: Date)` — rows with `taskExecution.startedAt >= since` when given;
  route `?days=` accepts exactly `7` or `30` (anything else present → 400 via `validateSchema`), passes
  `since = startOfLocalDay(now) - (days - 1) days` so "7 days" is today and the six before it, matching the chart's
  local-day buckets (`localDateStr`); `getPhilharmonicCosts(days?: 7 | 30)` in the renderer; `CostAnalysis` reloads
  when `period` changes, mapping `'7d'` → 7, `'30d'` → 30, `'all'` → none.

- [ ] **Step 1: Write the failing route tests**: `?days=7` calls `getPhilharmonicCostRows` with the start of the
      local day six days before a frozen `now`; `?days=abc` and `?days=0` → 400; no `days` → called with `undefined`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the query filter, the route parsing, the service parameter and the renderer reload.
- [ ] **Step 4: Run** the file — PASS.
- [ ] **Step 5: Commit** `fix(philharmonic): the Costs period switch filters the figures`. CLAUDE.md: one line.

### Task 5: Whole-branch gate and hand-off

- [ ] **Step 1:** `bun run fmt && bun run lint && env PWD=<worktree> bun run typecheck && bun run i18n:check && bun run test` — all pass (re-run a lone failing file once before believing it; see the load-flake memory).
- [ ] **Step 2:** Report to the owner with the branch name and ask before merging to master.
