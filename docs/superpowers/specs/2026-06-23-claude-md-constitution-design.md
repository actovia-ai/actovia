# CLAUDE.md Constitution (SP1) — Design

Date: 2026-06-23
Status: Approved (design), pending implementation plan

## Summary

Make `CLAUDE.md` an accurate, enforceable "constitution" for the project so its
conventions survive AI context resets. Three parts: (1) an **accuracy pass**
that corrects every stale architecture claim and documents the features added
since it was last updated; (2) a **global-constraints** section codifying the
rules new work must follow; (3) a **maintained code-structure map** — all
backed by **cheap automated guards** (a path-freshness test and a stale-token
denylist test) plus the existing pre-commit hook and test-id linkage test.

This is **SP1** of a larger initiative. **SP2** (broad `data-testid` + E2E
retrofit across existing features, in prioritized slices) is a separate
spec/plan and is out of scope here.

## Goals

- CLAUDE.md reflects the codebase as it actually is today.
- The rules an agent/human must follow are written down once, prominently.
- A concise, correct directory→responsibility map lives in CLAUDE.md.
- Drift is caught automatically where cheap: dead paths and retired claims fail
  `pnpm test`.

## Non-goals

- The broad testid/E2E retrofit of existing UI (that is SP2).
- Custom lint rules for hard-to-automate rules (e.g. "prefer @/components/ui");
  those stay documented, not enforced.
- A fully auto-generated structure map (curated + path-checked instead).

## Part 1 — Accuracy pass

Re-explore the codebase, then correct/add. Known corrections (non-exhaustive;
the implementer re-verifies each against the code):

- **Port:** `localhost:3000` → `localhost:60223` (`SERVER_PORT`). All occurrences.
- **DB path:** `~/.app/Database` → `~/.actovia/database` (see `src/main/lib/paths.ts`).
- **AI stack:** "Vercel AI SDK v6 / `streamText()`" → `@mariozechner/pi-ai` +
  `@mariozechner/pi-agent-core` ("pi-mono"); chat runs through `agentLoop`
  (`src/main/lib/server/routes/chat.ts`), not `streamText`.
- **Routes:** replace the list with the real 17 routes registered in
  `src/main/lib/server/app.ts`: `chat, lcm, history, project, settings, audio,
  db-io, deep-research, tools, philharmonic, s3, skills, mcp, memory, usage,
  logs, backup, artifacts`. Remove non-existent `/api/setting`, `/api/workflow`,
  `/api/custom-uploader`.
- **MCP:** "Connects to MCP servers on startup" → MCP connection is **archived**
  (see commented code in `app.ts`); there is an `/api/mcp` route + settings.
- **Tools:** replace the invented list (`calculator.ts`, `date.ts`) with the
  real `src/main/lib/ai/calling-tools/` set: `create-artifact, deep-research,
  edit-file, find-files, grep, image-generation, lcm-describe, lcm-expand,
  lcm-grep, list-directory, map-itinerary, read-file, terminal, weather,
  web-fetch, web-search, write-file`.
- **Providers:** fix mislabeled list; real files in `src/main/lib/ai/providers/`:
  `openai-gpt, azure-openai, anthropic-claude, google-gemini, xai-grok, ollama`
  (+ shared `resolve-model.ts`). Model lists live in
  `src/shared/constants/models.ts`.
- **Add sections** for the features CLAUDE.md omits entirely:
  - **Philharmonic** (multi-agent "Groups"): `src/main/lib/ai/philharmonic/`,
    `src/renderer/components/philharmonic/`, `/api/philharmonic`.
  - **App Lock**: `src/main/lib/lock/`, the `423` lock-gate middleware, IPC-only
    unlock, `~/.actovia/lock.dat`.
  - **LCM (context management)**: `src/main/lib/ai/context-management/`, `/api/lcm`.
  - **Test-ID checkpoints**: `src/shared/constants/test-ids.ts`, linkage test,
    release-only strip.
  - **Sub-apps**: `src/renderer/sub-apps/{searchbar,quick-chat,artifacts}`.
  - **Build/strip**: `electron.vite.config.ts` strips `data-testid` when
    `STRIP_TEST_IDS=1` (set in `build:mac/win/linux`).
- Preserve sections that are already correct (testing setup, path aliases,
  shadcn workflow, etc.) — verify, don't rewrite for its own sake.

## Part 2 — Global constraints

Add a prominent **"## Project Constraints (read first)"** section near the top:

- **Tests + checkpoints with UI:** when adding a key interactive element, add a
  `TEST_IDS` entry + `data-testid`, and reference it from a Playwright test.
  Ids are a durable contract (never rename/regenerate). (Enforced by the
  linkage test.)
- **Before committing:** `pnpm format` → `pnpm lint` → `pnpm typecheck` →
  `pnpm test` must pass. The pre-commit hook runs them; do not `--no-verify`
  except for the documented flaky PGlite teardown in
  `context-management/index.test.ts`.
- **Reuse UI primitives:** prefer existing `@/components/ui` (shadcn) components
  over hand-rolled equivalents (e.g. use the shadcn `Select`, `InputOTP`).
- **Copy language:** new user-facing strings default to **English**.
- **Keep this file current:** any change to architecture, routes, or structure
  updates CLAUDE.md in the same change.
- **Provider/model rules:** use shared `resolveModel()`; model lists in
  `src/shared/constants/models.ts`.

## Part 3 — Code-structure map

A concise **"## Code Structure"** section: a directory → one-line-responsibility
map for the trees that matter (`src/main/lib/{ai,server,lock,db}`,
`src/renderer/{components,components/ui,containers,stores,hooks,services,sub-apps}`,
`src/shared/{types,constants,schemas,utils}`, `tests/{api,e2e,providers}`,
`docs/superpowers/{specs,plans}`). Curated, not an exhaustive file listing. Paths
here are what the freshness guard checks.

## Part 4 — Durability guards (cheap automation)

New Vitest tests (run in `pnpm test` + pre-commit; pure `fs`, no Electron/PGlite).
They must live under `src/**` so the Vitest config (`src/**/*.test.ts`) collects
them — e.g. `src/shared/meta/claude-md-freshness.test.ts` and
`src/shared/meta/claude-md-staleness.test.ts` — reading `CLAUDE.md` and
`package.json` via an absolute path resolved from `__dirname`:

- **`claude-md-freshness.test.ts`** — parse the **"## Code Structure"**
  section of `CLAUDE.md`, extract backtick-wrapped repo paths (those starting
  with `src/`, `tests/`, `resources/`, `docs/`, or `electron.vite.config.ts`),
  and assert each exists on disk. Scoped to that section to avoid false
  positives from illustrative snippets elsewhere.
- **`claude-md-staleness.test.ts`** — assert CLAUDE.md does **not** contain
  retired tokens: `Vercel AI SDK`, `streamText`, `localhost:3000`,
  `~/.app/Database`, `/api/setting\b`, `/api/workflow`, `/api/custom-uploader`,
  `calculator.ts`; **and** assert it references the real AI dependency
  `@mariozechner/pi-ai`, cross-checked against `package.json` dependencies (read
  `package.json`, confirm `@mariozechner/pi-ai` is a dep and is named in
  CLAUDE.md). Fails the instant a retired claim reappears.
- **Existing guards (document, don't rebuild):** the husky pre-commit hook
  (format+lint+test) and the test-id linkage test.

## Error handling / edge cases

- **Freshness false positives:** scoping to the Code Structure section + only
  checking concrete repo-path prefixes avoids matching example code or prose.
- **Denylist false positives:** tokens are specific retired phrases, not common
  words; `/api/setting\b` uses a word boundary so it won't match `/api/settings`.
- **package.json cross-check** tolerates the dep being under `dependencies` or
  `devDependencies`.

## Testing / verification

- `pnpm test` includes both new guard tests (green only when CLAUDE.md is
  corrected).
- `pnpm typecheck` + `pnpm lint` clean.
- Manual read-through confirming each corrected section matches re-explored code.

## Out of scope / future (SP2)

- Broad `data-testid` + E2E retrofit across existing features, in prioritized
  slices (onboarding → chat → settings → philharmonic → …), governed by this
  now-accurate constitution.
