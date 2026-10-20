# Secrets & Exfiltration Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** every secret Actovia stores is encrypted at rest and never leaves the main process in plaintext; injected
instructions cannot pull it out; secrets elsewhere on the machine sit behind a user approval gate.
**Spec:** `docs/superpowers/specs/2026-09-25-secrets-and-exfiltration-hardening-design.md` (read it first).
**Tech:** Electron `safeStorage`, Hono routes, Drizzle/PGlite, pi-agent-core `beforeToolCall`, React Query, Vitest,
Playwright (faux provider).

## Global Constraints

- Branch `feat/react-query`, shared tree: never stage/format/revert another session's uncommitted files, never `git
  stash`. If the pre-commit hook fails only because of their files (today `itinerary-card.tsx` TS18048), commit with
  `$SCRATCH/commit-via-worktree.sh "<message>" <files…>` (the real hook runs in a temp worktree; it moves the branch).
- Gate before each commit: `bun run fmt` (check `git status` for foreign changes) → `bun run lint` → `bun run
  typecheck` (TS1149 → `env PWD=/Users/yanceyleo/Code/actovia/actovia`) → `bun run i18n:check` → `bun run test`.
  Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.
- Secrets never appear in logs, errors, SSE events, test snapshots or tool results. Tests never touch the real
  `~/.actovia` (temp `ACTOVIA_HOME`), never a real keychain (`safeStorage` mocked).
- User-facing strings: catalog keys, 10 locales in the same commit. Interactive elements: `TEST_IDS` + a Playwright
  reference. CLAUDE.md updated in the same change (stage only your hunks — `git apply --cached`).
- `docs/security-hardening.md` updated as items land (move from Open to In place).

## Review Focus

- A secret field added to the schema later without a registry decision → the coverage test fails.
- The desktop autosave posting a whole section with masks → the stored secret is unchanged (not overwritten by the
  mask).
- A decrypt failure on startup (changed signing identity) → keys read as unset + a notice; nothing sends ciphertext.
- A terminal command that merely mentions `.ssh` in a comment/echo → may prompt (acceptable false positive), never
  silently allowed when it reads a key file.
- An approval pending when the run is stopped or the window closes → denied, the run ends cleanly.

---

### S1: Secret registry + masked API

Files: new `src/main/lib/secrets/registry.ts` (+ `mask.ts`), `routes/settings.ts`, `routes/mcp.ts`, the list-models
route, `db/queries.ts` (write path), tests under `tests/unit/main/lib/secrets/` and the route tests.

- [ ] Registry of secret paths per spec §2.2 (grep the schema + Settings pages; include `mcp_server.env`/`headers`
      values) and a coverage test: every schema string field whose name matches `/key|secret|password|token/i` is either
      in the registry or on an explicit, commented non-secret list.
- [ ] `maskSecret(value)`: `"•••• " + last4` (≥12 chars) else `"••••"`; null/empty stay null.
- [ ] GET /settings and GET /mcp return masks; write path: equal-to-current-mask → keep stored value; null/"" →
      clear; else set. `settings/models` substitutes the stored key when given a mask.
- [ ] Tests for each rule, per registry field, incl. the autosave whole-section post.

### S2: safeStorage encryption at rest

Files: new `src/main/lib/secrets/crypto.ts`, settings load/save in `db/queries.ts` (cache), MCP server queries, a
startup migration hook (`main.ts` / db init), db-io export, a status accessor for the UI, CLAUDE.md, security doc.

- [ ] `encryptSecret`/`decryptSecret` with `enc:v1:` prefix over `safeStorage`; unavailable backend → plaintext +
      `status.encryption = 'unavailable'`; decrypt failure → field unset + recorded in `status.needsReentry[]`.
- [ ] Encrypt on write, decrypt into the in-process cache; startup migration (idempotent) encrypts plaintext values.
- [ ] db-io export masks secrets out (check what export includes first); backups keep ciphertext.
- [ ] `GET /api/v1/settings/secrets-status` → `{ encryption: 'on'|'unavailable', needsReentry: string[] }`.
- [ ] Tests: round trip, migration idempotent, unavailable, decrypt failure, export, no plaintext in the DB after
      migration (read raw rows).

### S3: Desktop UI for masks and status

Files: provider/tool key inputs under `settings-form/**`, a notice in Settings (settings-kit `SettingsNotice`),
hooks/services, i18n, TEST_IDS.

- [ ] Key inputs show the mask; typing replaces it; clearing clears; nothing else changes for the autosave.
- [ ] Notices: encryption unavailable; keys needing re-entry (named).
- [ ] Component tests; e2e reference for the new ids.

### S4: Remote images load on tap

Files: `src/renderer/components/markdown.tsx` (+ a small `RemoteImage` component), i18n, TEST_IDS, tests.

- [ ] `data:`, `/api/v1/media/…`, and hosts in the run's web-search results load; others show host + "Load image".
- [ ] Render-path guard stays green (`messages-rerender.test.ts`, markdown-blocks tests).

### S5: web_fetch cannot reach Actovia

Files: `calling-tools/web-fetch.ts` (and deep research's fetch if separate), `net/safe-fetch.ts` helpers, tests.

- [ ] Refuse loopback / local-interface / LAN-IP hosts on ports 60223 and 63129 (incl. `localhost`, `0.0.0.0`,
      `[::1]`), every redirect hop; other local ports allowed.

### S6: Approval gate for secrets outside Actovia

Files: new `src/main/lib/ai/kernel/approval.ts` (matcher + pending registry), `kernel/run.ts` (`beforeToolCall`),
`routes/chat.ts` + `chat-sse.ts` (event), new route `POST /api/v1/chat/approval`, `ChatSseEvent` type, renderer
approval card in the timeline + hook, `prompts.ts`, i18n, TEST_IDS, e2e (faux provider scripts a sensitive
`read_file`).

- [ ] Matcher per spec §2.5, table-tested (paths, workspace `.env`, terminal heuristics, false positives).
- [ ] `lock.dat` / `tls/` refused outright; other `~/.actovia` reads pass (ciphertext only).
- [ ] Pause → `approval_required` event → decision route → resume; deny/timeout (10 min)/Stop → declined result.
- [ ] Card: summary (path/command), Allow once / Deny, states after decision; iOS shows nothing new yet (unknown event
      ignored) — iOS task follows.
- [ ] Prompt lines in `<hard_stops>`; `prompts.test.ts` pins them.

### S7: The iOS app follow-up

- [ ] Providers page with masked keys (display, unchanged save, replace); secrets-status notice.
- [ ] Approval card on the phone (`approval_required` + the decision route) — the remote principle.

### Final: whole-branch review (most capable model), one fix wave, re-review.
