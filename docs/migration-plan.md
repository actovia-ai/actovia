# Business-code migration plan: universal-client → actovia

## Purpose

`actovia` now has a verified, working base architecture (native electron-forge +
Vite + bun, no electron-vite, no electron-builder — see git history / session
notes for the full base-migration). `universal-client` is the mature codebase
where all business features actually live, and where active development
(currently i18n) continues. This document is the plan for porting that
business code over, written _before_ execution so the actual migration can
run as a checklist rather than a from-scratch investigation.

**Status (2026-09-19): executed.** All eight phases have been carried out;
each phase section below keeps the plan as written and adds a "What actually
happened" record of where reality diverged. Everything in `universal-client`
is unmodified. The section "Status and what is left" (before the standing
checklist) lists what is still open. Read the "Decide once, up front" section
and the standing checklist before changing build or packaging code.

**Compiled from:** three parallel research passes over `universal-client`
(backend+DB, AI/agent layer, renderer+i18n), each read-only, each skimming
signatures/imports rather than full file contents. Treat file/line counts
below as approximate scale indicators, not exact specs — re-check the actual
file when a phase starts, since `universal-client` keeps moving.

---

## Repository / git strategy (user instruction, 2026-09-19)

The end state is **one repository using `universal-client`'s `.git`
history**, not `actovia`'s:

- **Executed (2026-09-19):** all three steps below are done — see "Status and
  what is left". The history is `universal-client`'s; the migration is one
  commit on top of `dev`.
- **Already done (2026-09-19):** `actovia`'s own `.git` has been deleted.
  It had zero commits — everything in this whole base-migration effort
  (every phase described in this document, plus the entire prior
  base-architecture session) sat as uncommitted working-tree changes the
  whole time, so there was no history to lose. Verified empty (`git log`,
  `git stash list`, `git remote -v`, `git branch -a`) before deletion; the
  working-tree files themselves were untouched by removing `.git`.
  `actovia`'s directory is now a plain, non-git working tree.
- **At migration time:** copy `universal-client`'s `.git` directory
  straight into `actovia`'s working tree (its history is the real, valuable
  one — years of actual feature development — and must not be lost or
  replaced). This is the whole mechanism, per direct user instruction — no
  history-rewriting, cherry-picking, or diff-carrying needed.
- After that copy, `actovia`'s working tree (base architecture + whatever
  business code has been ported per the phases below) will show as a large
  set of uncommitted changes against `universal-client`'s last commit —
  **commit that with a real, well-described message** documenting what the
  base-architecture pass and migration actually did. Don't leave it
  uncommitted and don't squash it away silently — the work should be
  traceable in the log even though it happened in a separate scratch repo
  first.

---

## Decide once, up front

These five things are referenced by almost every phase below. Getting them
wrong once and propagating the mistake through 20 ported files is much more
expensive than deciding correctly before Phase 1 starts.

**Outcome (all five resolved by 2026-09-19):** #1 restored (Phase 1 / 4) ·
#2 the full `ErrorCode` enum restored in one pass (Phase 1 / 5) · #3 option
(a), a nested preload bridge (Phase 6) · #4 needed no `asar.unpack` at all —
`getResourcePath()` over `extraResource` covers the migrations and the Swift
helper (Phases 1 and 7) · #5 done phase by phase. The text below is the plan
as written; each phase section records what happened.

### 1. Restore two pieces this session deleted as "dead code" — they aren't

- **`src/main/lib/logger/trace-context.ts`** (`withTrace`, `bindTraceAttributes`,
  `currentTrace`, `newTraceId`) — deleted because nothing called it yet. It's
  a hard dependency of the Hono server's `traceMiddleware` (wraps every
  `/api/*` request) and `jobs/worker.ts` (`bindTraceAttributes`/`withTrace`
  around job processing). Restore it verbatim (it's still in git history /
  `universal-client`) before or alongside Phase 4 (server) or Phase 2 (jobs),
  whichever lands first. Also restore the `traceId`/`originTraceId` fields on
  `LogRecord` (`logger/record.ts`) and the enrichment branch in
  `logger/index.ts`'s `write()` that were simplified away alongside it.
- **`paths.ts`'s `getDatabaseDir()`** — deleted as unused; it's a hard
  dependency of `db/db.ts`. Restore alongside Phase 1 (DB layer).

### 2. Error-code strategy for `@actovia/shared`

`packages/shared/src/constants/error-codes.ts` currently has 8 generic codes
(trimmed during the base migration). `universal-client`'s `ErrorCode` enum
has ~50+ domain codes (`CHAT_NOT_FOUND`, `CONFIG_MISSING_OPENAI`,
`DEEP_RESEARCH_NOT_FOUND`, `AGENT_NOT_FOUND`, `APP_LOCKED`, etc.), and its
i18n `errors.json` namespace maps every one of them 1:1 via
`errors:code.<CODE>` keys with `{{param}}` interpolation.

**Decision needed:** restore the full `ErrorCode` enum (+ `ErrorCodeToStatus`

- `ErrorMessages`) in `@actovia/shared` in one pass before Phase 1, rather
  than growing it piecemeal per-phase and re-touching the same file 10 times.
  Also restore the feature-specific `AppError` subclasses (`AIError`,
  `RateLimitError`) dropped alongside the trim. Do this as the very first
  concrete migration step — everything else (server routes, AI tools, i18n
  `errors` namespace) references this enum.

### 3. Renderer↔main IPC bridge shape mismatch

`universal-client`'s `src/renderer/lib/ipc.ts` calls
`window.electron.ipcRenderer.invoke(...)` / `.on(...)` /
`.removeListener(...)` — i.e. it expects the nested shape
`@electron-toolkit/preload`'s `electronAPI` provides. `actovia`'s
`src/preload/preload.ts` (written this session, deliberately _not_ using
`@electron-toolkit/preload`) exposes a flatter bridge:
`window.electron = { send, invoke, on, off }`.

**Decision needed before any renderer code migrates (Phase 6):** either (a)
reshape actovia's preload bridge to nest under `.ipcRenderer` to match every
existing renderer call site, or (b) keep actovia's flat shape and rewrite
`renderer/lib/ipc.ts`'s call sites during migration. (a) is less invasive
per-file since dozens of renderer files call through `lib/ipc.ts`'s
abstraction, not `window.electron` directly — check how many call sites
actually touch `window.electron` raw vs. go through `lib/ipc.ts`'s wrapper
before picking; if it's mostly the wrapper, (b) might be a one-file fix.

### 4. Packaging: asar-unpack, not `extraResource`, for anything native/SQL

`db/migrate.ts` and `computer/helper.ts` both assume electron-builder's
`asarUnpack` → `app.asar.unpacked/...` layout (accessed via
`@electron-toolkit/utils`'s `is.dev` to pick dev vs. packaged paths). This
session confirmed empirically that actovia's `packagerConfig.extraResource`
copies to `Contents/Resources/resources/*` — a _different_ mechanism, not
asar-unpacking. Forge has its own equivalent
(`packagerConfig.asar.unpack: '**/*.{node,sql}'`-style glob, or per-file) —
set this up once, in `forge.config.ts`, before Phase 1 (migration SQL) or
Phase 7 (native helper binary) needs it. Replace every `is.dev` reference in
ported code with `app.isPackaged` (actovia's established convention) and drop
the `@electron-toolkit/utils` dependency — same pattern already applied to
`window.ts`/`tray.ts`/`ipc.ts` this session.

### 5. `@shared/*` → `@actovia/shared` rename

Every ported file that currently does `import ... from '@shared/...'` needs
that rewritten to `@actovia/shared` (or a relative import within the package,
if the code is moving _into_ `packages/shared` itself — e.g. more of
`src/shared/types`, `src/shared/constants`, `src/shared/schemas` will likely
want to join `packages/shared` alongside the errors code already there).
Mechanical, but repo-wide — budget time per phase for it, don't treat it as
a final cleanup pass.

---

## Explicitly not migrating (yet)

- **`packages/pi-lcm`** — confirmed orphaned: zero consumers anywhere in
  `universal-client`'s `src/`, and its own `pnpm-workspace.yaml` never
  actually registered it as a workspace member. It's a parallel,
  never-wired-up reimplementation of `ai/context-management/` +
  `ai/memory/manager.ts` + the three `lcm-*` calling-tools. **Do not port it
  as-is.** It may be a useful _design reference_ for eventually extracting a
  `packages/lcm` in actovia once `ai/context-management/` itself has
  migrated and proven stable — but the live code to port is the in-app
  version, not this package.
- Anything not listed in the phases below (it wasn't surveyed, or is a
  leaf so small it'll be obvious when its dependents land).

---

## Migration order

Phases are ordered by dependency, not by user-facing priority — DB has to
exist before almost anything else is meaningful. Within a phase, port +
typecheck + lint + test before moving to the next; don't batch multiple
phases into one unverified pass (this session's own experience: bugs hide
until you actually run the full pipeline, not just `tsc`).

### Phase 1 — Data layer (`src/main/lib/db/`) — ✅ done (2026-09-19)

- `schema.ts` (27 `pgTable()` calls — project, settings, deep_research(+message),
  mcp_server, team, agent(+memory), chat/message, task(+execution+event),
  conversation_plan, plan_step, knowledge_doc, discover_feed,
  memory(+usage_log), lcm_summary, and more), `db.ts`, `migrate.ts` (fix
  per decision #4 above), 9 `*-queries.ts` files (conversation, discover,
  knowledge, mcp, memory, philharmonic, plan, project, team, + general
  `queries.ts`), root `drizzle.config.ts`.
- Only 3 migration SQL files exist (`resources/drizzle/0000`–`0002`) —
  small enough that regenerating via `drizzle-kit generate` against the
  copied `schema.ts` is a reasonable alternative to carrying migration
  history verbatim, if starting actovia with a fresh data directory is
  acceptable (it should be — different `~/.actovia/database` state isn't
  shared with `universal-client`'s users regardless).
- Add dependencies: `@electric-sql/pglite`, `@electric-sql/pglite-pgmq`,
  `@electric-sql/pglite-pgvector`, `drizzle-orm`, `drizzle-kit` (dev).
- This is the single highest-leverage phase — nearly everything downstream
  (jobs, server routes, most of `ai/`, most renderer services) depends on
  it existing.

**What actually happened, and where this diverged from the plan above:**

- **Prerequisite chain was bigger than scoped.** `schema.ts` pulls in
  `settings-schema.ts` (17 zod schemas), `types/discover.ts`, and
  `types/web-search.ts` before it will even typecheck. All three got
  ported into `@actovia/shared` (as `./schemas/settings-schema`,
  `./types/discover`, `./types/web-search` subpath exports) as part of
  this phase rather than blocking on a re-plan. Also restored: the full
  ~50-code `ErrorCode` enum in `@actovia/shared` (had been trimmed to 8
  generic codes) and the `AIError`/`RateLimitError` subclasses — `queries.ts`
  needs both. One Chinese string found and translated per the
  English-default rule: `S3Schema`'s zod validation message.
- **Decision #4 (migration-folder packaging path) turned out to already be
  solved.** `getResourcePath()` (built during the base migration, for
  icons) works unchanged for `resources/drizzle` — no new `asar.unpack`
  config was needed, just `migrate(db, { migrationsFolder:
  getResourcePath('drizzle') })`.
- **`getSettings()` was deliberately NOT wired into boot.** Auto-updater/
  tray/login-item behavior that reads settings is real integration work,
  better scoped to its own pass once IPC handlers exist. `runMigrate()`
  and the two stale-task cleanup functions (`cleanupStaleWaitingTasks`,
  `cleanupStaleRunningTasks`) are wired into `main.ts`'s boot sequence;
  nothing else is yet.
- **The 9 query files (all `*-queries.ts` + `queries.ts`) are ported but
  UNWIRED** — no IPC handler calls any of them yet (that's Phase 6/IPC
  work). `knip` correctly flags them as unused files; this is expected,
  same situation as the pre-installed shadcn UI kit components.
- **`~/.actovia` collides with `universal-client` in dev — this was wrong
  in the plan above, and caused a real incident.** The assumption that
  "different `~/.actovia/database` state isn't shared... regardless" is
  only true for separate END USERS. On this machine, in dev, actovia and
  `universal-client` both resolve `getActoviaHome()` to the literal same
  `~/.actovia`. Running actovia's `bun run dev` after wiring the DB layer
  ran real migrations and the new task-cleanup UPDATE against
  `universal-client`'s live dev database (confirmed: 14 real chats, 176
  messages). No data loss resulted (the `task` table was empty, and the
  queries that ran either no-opped against already-applied migrations or
  failed outright before any write) — confirmed via a read-only PGlite
  inspection script — but it could have gone worse. **Fix**: `getActoviaHome()`
  now appends `-dev` to the directory name whenever `!app.isPackaged`,
  leaving the packaged (production) path unsuffixed and unchanged — actovia
  is meant to eventually ship AS the real Actovia app, sharing that
  directory with other installs by design; only unpackaged dev runs needed
  isolating. **Standing rule**: never run `bun run dev`/`package`/`make`
  for this repo against the real `~/.actovia` — always verify the active
  binary resolved the suffixed dev path (or a sandboxed `$HOME` for
  packaged-build testing) before trusting a DB-touching test.
  **Superseded (2026-09-19, after the migration):** the `-dev` split existed
  because actovia was then a half-built base that mutated a live database.
  Once actovia became a faithful port — same schema, same 3 migrations,
  verified on a copy of the real database — it hid the user's data in dev
  ("where did my chats go?"), so at the user's request unpackaged builds now
  use `~/.actovia` too (`getActoviaHome()` no longer looks at
  `app.isPackaged`). The standing rule became: **never run two Actovia
  processes — a dev build, the packaged app, universal-client — against one
  data directory at once (PGlite is single-process)**; the e2e suite sandboxes
  `$HOME` and its fixture refuses to run otherwise. `ACTOVIA_HOME` remains as an
  explicit override.
- **`db.ts` had a latent directory-creation-order bug**, also present
  verbatim in `universal-client`. Its module-level `export const pglite =
  new PGlite({ dataDir })` runs at ES-import time — before
  `ensureActoviaDirs()` ever executes inside `app.on('ready')` — and
  PGlite's own internal `mkdir` isn't recursive, so it depends on some
  _other_ module having already created the parent directory as a side
  effect. This was silently masked in both repos by `~/.actovia` already
  existing from prior runs; it only surfaced once the `-dev` suffix
  pointed at a genuinely new path. Fixed by having `db.ts` `mkdirSync(dbPath,
  { recursive: true })` itself before constructing `PGlite`, rather than
  relying on caller/import ordering.
- **`@electric-sql/pglite` cannot be bundled into the single main.js Vite
  output — this is the biggest real finding of the phase.** PGlite
  resolves its own WASM/data assets relative to its package's real
  location on disk (via `__filename`/`import.meta.url` internally).
  Bundling it in breaks that resolution (`TypeError: Invalid URL` at
  `pglite.waitReady`, silently swallowed since `migrate.ts`'s catch block
  only showed a native `Notification`, not a log — also fixed, it now
  logs via `logger.error`). `universal-client` never hit this because it
  uses `electron-vite`, which externalizes main-process deps by default;
  `@electron-forge/plugin-vite` does not. Fix, in two parts:
  - `vite.main.config.mts`: `build.rollupOptions.external` lists
    `@electric-sql/pglite`, `-pgmq`, `-pgvector`, AND the subpath import
    `@electric-sql/pglite/contrib/pg_trgm` explicitly — an exact-string
    array, not a predicate function (Vite's Rolldown bundler rejects a
    plain JS function for `external` in watch mode). The subpath needs
    its own entry; it doesn't inherit externalization from the bare
    package name.
  - `forge.config.ts`: `@electron-forge/plugin-vite` auto-injects
    `packagerConfig.ignore` to keep only `.vite/**`, assuming full
    bundling — which would silently drop the now-external `node_modules/
    @electric-sql/*` from the packaged app. Providing an own `ignore`
    (which the plugin then leaves alone) keeps `.vite/**` plus
    `/node_modules/@electric-sql/**`. Getting this right required keeping
    every _ancestor_ directory too (`/node_modules` itself, `/node_modules/
    @electric-sql`), not just the deep leaf paths — the packager's walker
    prunes recursion at the first directory that matches "ignore", so an
    ignore rule that only recognized the full deep path left nothing on
    disk to recurse into (verified empirically: first attempt produced a
    packaged asar with zero `@electric-sql` files despite the rule being
    "correct" for leaf files).
  - Verified end to end with a real `electron-forge package` build: the
    asar contains 339 `@electric-sql/*` files, and the packaged binary
    (launched directly, output captured, `$HOME` sandboxed to a scratch
    dir to avoid the same collision as above) logs `Migrations completed`
    cleanly with all 27 tables created.

### Phase 2 — Platform services (main process) — ✅ done (2026-09-19)

Port together since they're peer-level and lightly cross-dependent:

- **`jobs/`** (`handlers.ts`, `queries.ts`, `types.ts`, `worker.ts`,
  `origin-trace.ts`) — 5 pgmq queues (`index-message`, `lcm-post-turn`,
  `memory-consolidate`, `kb-sync`, `discover-refresh`). Needs
  `trace-context.ts` restored (decision #1).
  - ✅ `types.ts` (already landed in Phase 1 as a prerequisite),
    `origin-trace.ts`, `queries.ts` — all self-contained, ported verbatim.
  - ⬜ `handlers.ts` / `worker.ts` — **not portable yet**: `handlers.ts`
    imports `LcmManager` (`ai/context-management`, Phase 3),
    `runMemoryConsolidation` (`ai/memory/manager`, Phase 3),
    `runDiscoverRefresh`/`resetStuckDiscoverRefresh` (`discover/manager`,
    below), `contentHash`/`resolveKnowledgeBase`/`reconcileKnowledgeIndexStatus`
    (`knowledge-base/`, below) — none of which exist in actovia yet. Land
    these two once Phase 3 + `discover/` + `knowledge-base/` all land; this
    is the real reason the plan's "port together" framing undersold the
    coupling here — only 3 of the 5 files in this directory are actually
    independent of downstream phases.
- ✅ **`search/`** (`resolve-search-provider.ts`, `types.ts`,
  `providers/elasticsearch-search.ts`, `providers/pglite-search.ts`) —
  genuinely self-contained (only `db/`, `logger`, `@elastic/elasticsearch`).
  Ported verbatim; one lint fix needed — Elasticsearch's response field is
  literally named `_id`, tripping `no-underscore-dangle`, fixed via
  bracket access (`hit['_id']`) rather than a config exception, since it's
  a one-off third-party field name, not a repo-wide pattern.
- ✅ **`lock/`** (`idle-watcher.ts`, `ipc.ts`, `lock-config.ts`,
  `lock-manager.ts`, `lock-notifications.ts`, `pin-store.ts`) — ported +
  fully wired: `main.ts` (lock-on-launch, `IdleWatcher` + `powerMonitor`
  suspend/lock-screen hooks — inserted after `createWindow()`/`setTray()`,
  before `setupAutoUpdater()`), `main/lib/ipc.ts` (`setupLockIPC()` called
  first inside `setupIPC()`), `main/lib/menu.ts` ("Lock Now" item, File
  submenu — the `menu:lockNow` i18n key already existed from the Phase 5
  i18n port). `philharmonic-notifications.ts` (the shared native-OS-notification
  bridge `lock-notifications.ts` depends on) landed now too, verbatim —
  despite the filename/header comment, none of its code is actually
  philharmonic-specific, confirmed by reading it; Phase 3's philharmonic
  work will consume the same file rather than needing its own copy.
  `packages/shared/src/types/lock.ts` added as a new `@actovia/shared`
  subpath export (`./types/lock`). `paths.ts` gained `getLockSecretPath()`/
  `getLockConfigPath()`.
- ⬜ **`discover/`** (`manager.ts`, `brave-news-client.ts`) — depends on Brave
  News API + a slice of `ai/memory` and `ai/utils` for LLM query generation.
  Sequence after at least `ai/memory/manager.ts` (Phase 3) and `db/discover-queries.ts`
  (Phase 1, already done).
- 🟡 **`knowledge-base/`** (`lightrag-client.ts`, `reconcile.ts`,
  `resolve-knowledge-base.ts`, `errors.ts`) — external dependency on a
  self-hosted **LightRAG** HTTP service (not bundled — comment in-file notes
  the API "moves roughly monthly," so re-verify the client against whatever
  LightRAG version is actually deployed when this phase starts).
  **Ported verbatim (2026-09-19), pulled forward** because Phase 3's
  `utils/tool-binding-util.ts` and `calling-tools/search-knowledge-base.ts`
  import it — 250 lines, only touches Phase 1's `db/` + `logger`. Its 3 unit
  tests came with it and pass, but they mock the HTTP layer: the client has
  **not** been checked against a live LightRAG server, so the re-verify
  requirement above is still open.

Verified: full typecheck/lint/fmt/test sweep clean, real `bun run dev`
boots cleanly against the isolated `-dev` database with `Migrations
completed` and `Lock IPC ready { safeStorage: true, touchId: true }` both
logged, no errors.

**Closed (2026-09-19, final pass):** `discover/` (`manager.ts`,
`brave-news-client.ts`), `jobs/handlers.ts` and `jobs/worker.ts` — all
ported verbatim once their Phase 3 dependencies existed — plus `backup.ts`
(the daily PGlite backup scheduler; not in this plan's original survey) with
`paths.ts`'s backup directories and `migrateFromLegacyLocation()`. The one
thing still open from this phase: `knowledge-base/` has only been tested
against mocks, never a live LightRAG server.

### Phase 3 — AI/agent layer (`src/main/lib/ai/`) — ✅ done (2026-09-19)

Land roughly in this sub-order (later items depend on earlier ones):

1. ✅ **`providers/`** (537 lines) — 6 LLM providers (OpenAI, Azure OpenAI,
   Anthropic, Google, xAI, Ollama) via `@mariozechner/pi-ai`; `list-models/*`
   hand-rolled REST calls per provider, no extra SDKs needed there. Ported
   verbatim except: `@shared/types/ai` (AiProviders enum + McpTools, genuinely
   shared logic) → new `@actovia/shared/types/ai` subpath (needs
   `@mariozechner/pi-agent-core`, added as a dependency); `@shared/types/db`
   (a renderer-facing passthrough of `db/schema.ts` row types) was
   deliberately NOT replicated in `@actovia/shared` — that would invert the
   workspace package's dependency direction (shared → app instead of app →
   shared). Since `providers/` is main-process-only code, it just imports
   `Settings` directly from `../../db/schema`, matching the `search/`
   precedent from Phase 2. One lint fix: 4 files' `[...arr].sort()` →
   `arr.toSorted()` (`no-array-sort`).
2. ✅ **`context-management/`** (1236 lines, 7 files) — the app-wide LCM
   (`LcmManager`, `compaction.ts`, `context-assembler.ts`, `lcm-status-bus.ts`,
   `queries.ts`, `token-counter.ts`, `prompts.ts`). Zero `@shared/*` imports
   at all — ported 100% verbatim, only touches `db/`, `logger`, `pi-ai`.
3. ✅ **`memory/manager.ts`** (409 lines) — cross-session memory,
   LLM-as-judge writes. Also 100% verbatim — only touches
   `db/memory-queries` (Phase 1) and `logger`.
4. ✅ **`calling-tools/`** (20 files, 2184 lines) — filesystem/shell tools
   (no issues, main-process Node), web tools (need
   `@langchain/community`'s `WebPDFLoader` + `cheerio` + `turndown` via
   `ai/utils/web-search-util`), media tools (`openai` SDK for image-gen,
   `@googlemaps/places` for itinerary), app-integration tools
   (`search-knowledge-base` needs Phase 2's `knowledge-base/`,
   `computer-use` needs item 6 below, `lcm-*` need item 2 above).
5. ✅ **`deep-research/`** (413 lines, 5 files) — query generation → search →
   process → report pipeline.
6. ✅ **`computer-use/`** (376 lines, 3 files — `ClaudeComputerAgent`,
   `action-tools.ts`, `system-prompt.ts`) — the model-facing half; needs
   the OS-level half (`src/main/lib/computer/`, Phase 7) to actually work,
   but can be ported/typechecked before Phase 7 lands.
7. ✅ **`mcp.ts`** (220 lines) — MCP client manager
   (`@modelcontextprotocol/sdk`), backed by `db/philharmonic-queries` — so
   needs at least that one query module from Phase 1, even though
   philharmonic itself lands later.
8. ✅ (seam only — deprecated by user decision, see third pass below)
   **`skills/skills-manager.ts`** (362 lines) — **external dependency on a
   live third-party Convex endpoint** (hardcoded URL) — confirm this is
   still the correct/intended backend before porting verbatim, not just an
   SDK-shape thing.
9. ✅ **`artifacts.ts` + `artifacts-migration.ts`** (199 lines total) — file
   storage under `getArtifactsDir()`; the migration file follows the same
   legacy-location pattern already used by actovia's own trimmed `paths.ts`.
10. ✅ **`prompts.ts`** (160 lines) — pure string building from settings, no
    external deps, trivial.
11. ✅ **`utils/`** (1622 lines, 10 files) — shared helpers most of the above
    already depend on; in practice port pieces of this alongside whatever
    first needs them rather than as a standalone step.
12. ✅ **`philharmonic/` + `philharmonic/lcm/`** (2348 lines, 19 files) —
    **land last within this phase**: it's the largest, most interconnected
    subsystem (PM-coordinator + employee agents + own scoped LCM + scheduler
    - plan DTOs), and pulls in 5 separate DB query modules
      (`philharmonic-queries`, `plan-queries`, `conversation-queries`,
      `team-queries`, `queries`), i18n (`mainT`), `knowledge-base/`, the
      `search-knowledge-base` tool, and `philharmonic-notifications.ts`. Don't
      attempt it until everything it imports already compiles.

Verified (items 1–3): full typecheck/lint/fmt/test sweep clean, real
`bun run dev` still boots cleanly (these three land as standalone modules
with no consumer yet, so this is a build-compiles-cleanly smoke test, not a
runtime exercise of the new code — the first real exercise comes once
`jobs/handlers.ts` or `philharmonic/` actually calls into `LcmManager`/
`runMemoryConsolidation`).

**Items 4–11, second pass (2026-09-19) — what actually happened:**

- **Ported:** 5 (`deep-research/`), 6 (`computer-use/`), 7 (`mcp.ts`), 9
  (`artifacts.ts` + `artifacts-migration.ts`), 10 (`prompts.ts`), 11
  (`utils/`, all 10 files), and 4 (`calling-tools/`) minus one file. The order
  followed real import edges, not the numbering above: `utils/` first
  (everything else imports it), `calling-tools/` last.
- **`calling-tools/computer-use.ts` deliberately NOT ported.** It imports
  `computer/guard`, `computer/liveness` and `computer/session` — the whole
  OS-facing half (Phase 7, 1611 lines, macOS-only, needs the Swift helper).
  Its two registration sites, `calling-tools/index.ts` and
  `utils/tool-binding-util.ts`, have the `computerUse` line removed (a
  one-line comment marks the second). Re-add both when Phase 7 lands. Only
  `computer/types.ts` (+ `@actovia/shared/types/computer-use`) was pulled
  forward, since `ai/computer-use/` imports `Action`/`ComputerState` from it.
- **`knowledge-base/` pulled forward from Phase 2** (see above) — both
  `utils/tool-binding-util.ts` and `calling-tools/search-knowledge-base.ts`
  import it.
- **Five more `@actovia/shared` subpath exports:** `types/chat`,
  `types/deep-research`, `types/computer-use`, `constants/systems`,
  `utils/http`. `@shared/types/db` was again replaced by direct
  `../../db/schema` imports (4 tools), and `@shared/errors/*` /
  `@shared/constants/error-codes` became imports from the package root
  (`@actovia/shared`) — actovia exports them there, not as subpaths.
- **`utils/http.ts` is the one file that needed real edits, not just import
  rewrites.** It's dual-use (renderer services + the main-process
  `deepResearch` tool) and was written against DOM typings; actovia's
  `tsconfig.node.json` and `packages/shared/tsconfig.json` deliberately have
  no DOM lib. Rather than add DOM to main's `lib` (which would let main code
  quietly use `window`/`document`), four small edits made it
  environment-neutral: `window.setTimeout` → `setTimeout`, `BodyInit` →
  `RequestInit['body']`, a tuple annotation on the `URLSearchParams`
  entries, and a cast on the error-body `response.json()` (Node's `fetch`
  types return `unknown`, DOM's return `any`). The `window.setTimeout`
  change also fixes a latent runtime bug: it would throw `ReferenceError` in
  main whenever `timeout > 0`. Upstream only escaped it because the one
  main-process caller found (`calling-tools/deep-research.ts`) never passes
  a timeout.
- **`paths.ts`** gained `getArtifactsDir()`, and `ensureActoviaDirs()` now
  also creates it.
- **Lint fixes (no behaviour change):** `no-array-sort` ×2 → `toSorted()`;
  `preserve-caught-error` ×7 → `{ cause }` added to re-thrown errors in the
  file tools and `image-generation`.
- **Tests:** 16 upstream test files came along
  (`calling-tools/{map-itinerary,search-knowledge-base,web-fetch,web-search}`,
  `computer-use/agent`, `utils/*` ×7, `knowledge-base/*` ×3,
  `shared/utils/http`) — the suite went from 3 to 19 files / 116 tests, all
  passing. Adjusted for oxlint: `toSorted`, two hoisted helpers, and a
  redundant `PGlite` class mock dropped from two files (they already mock
  `db/db`). Dead `vi.mock('@electron-toolkit/utils')` lines removed. **Not
  ported yet:** the `providers/*`, `context-management/*` and
  `memory/manager` tests covering items 1–3 (they exist upstream).
- **New dependencies:** `@modelcontextprotocol/sdk`, `openai`,
  `@googlemaps/places`, `@langchain/community` + `@langchain/core`,
  `cheerio`, `turndown` (+ `@types/turndown`), and `pdf-parse` — a real peer
  dependency of `WebPDFLoader`, which loads it via a runtime
  `import("pdf-parse")` (literal specifier, so Rollup can see it; checked in
  `node_modules`, **not** yet checked in a packaged build — do that with
  `bun run package` when `web-search` gets wired). `node-cron` was added in
  the third pass below; `jszip` turned out not to be needed for skills (its
  other user is the server's `db-io` route, Phase 4), and `cron-parser` is
  needed by the _renderer's_ philharmonic schedule UI (Phase 6).
- **Items 8 and 12 were held for user decisions** — both are done, see the
  third pass below.

Verified: `typecheck` (node/web/shared), `lint` (0 errors), `fmt:check` and
`test` (19 files / 116 tests) all clean; a real `bun run dev` boots
cleanly against `~/.actovia-dev` with `Migrations completed` + `Lock IPC
ready` and no errors, and `~/.actovia-dev/artifacts` was created by the
updated `ensureActoviaDirs()`. As with items 1–3, the new modules have no
consumer yet, so `start` proves the boot path still works, not that the new
code runs — the unit tests are the real evidence for these.

**Items 8 and 12, third pass (2026-09-19) — user decisions, then the port:**

- **Decision (user): skills is deprecated — backend _and_ frontend.** They
  have a replacement design researched and will build it once the migration
  is finished; the ask was only to "leave an entry". So **open question #5
  is resolved: the Convex marketplace is not ported.** What exists instead is
  a seam: `ai/skills/skills-manager.ts` exports only the three functions live
  code still calls — `listInstalledSkills()` (the philharmonic-crud route),
  `getSkillsContentBySlugs()` (philharmonic's employee loop) and
  `getActiveSkillsContent()` (the chat route) — all returning "no skills"
  (`[]` / `''`). `@actovia/shared/types/skills` is cut down to the single
  `InstalledSkill` interface those signatures need. Not migrated: the other
  7 upstream functions (registry list/search, install/uninstall/toggle,
  local/zip install), the Convex types, `constants/external-urls` (nothing
  migrated needs it), and the `jszip` dependency (its only other user is
  `server/routes/db-io.ts`, Phase 4). **For later phases:** don't port
  `server/routes/skills.ts` (Phase 4) or the skills-market frontend
  (`containers/skills-market/*`, `settings-form/skills-market.tsx`,
  `services/skills-service.ts` — Phase 6); leave a nav/settings entry for
  the replacement instead. Known side effect: skills already installed
  under `~/.actovia/skills` via universal-client stop being injected into
  prompts until the replacement lands.
- **12 (`philharmonic/` + `philharmonic/lcm/`, 19 files, 2348 lines)
  ported verbatim**, per the user's instruction to migrate this area
  as-is ("they haven't tested it themselves either") — no cleanup, no
  behaviour changes, its ~100 lint warnings (upstream style) left alone.
  Only `@shared/*` → `@actovia/shared/*` rewrites. Every `mainT()` key it
  uses type-checks against the shared catalog. New shared modules:
  `@actovia/shared/types/philharmonic` (214 lines) and `/constants/avatar`.
  `paths.ts` gained `getGroupsDir()` / `getGroupDir()` (lazy `mkdir`, used
  by `plan-mirror.ts`).
- **Dependencies:** `node-cron@^4.6.0` added. **Not** added:
  `@types/node-cron` (upstream lists the v3 types, but node-cron 4 ships its
  own) and, at this point, `cron-parser` — nothing in `src/main` or
  `src/shared` imports it (only the renderer's schedule UI does, added with
  Phase 6, so this plan's original survey entry was right after all).
- **Tests:** the 13 upstream philharmonic test files came along; the suite
  is now 32 files / 163 tests, all passing.
- **Verified:** `typecheck`, `lint` and `fmt:check` all exit 0; `test`
  32 files / 163 tests. No fresh `bun run dev` this pass — nothing new is
  wired into boot and `ensureActoviaDirs()` is unchanged. Like the rest of
  this phase, philharmonic has no consumer yet (Phase 4's server routes and
  `initScheduler()` are what will call it), so the tests are the only
  runtime evidence.

**Phase 3 status:** complete. `calling-tools/computer-use.ts`, the one file
held back here, landed with Phase 7 (see there).

Add dependencies (versions from `universal-client`'s `package.json` at
survey time — re-check current versions when this phase starts):
`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`,
`@modelcontextprotocol/sdk`, `openai`, `@googlemaps/places`,
`@langchain/community` (+ possibly `@langchain/core`), `uuid`, `jszip`,
`zod`, `cheerio`, `turndown`, `node-cron`, `cron-parser`.

No electron-vite-specific imports or sandboxed-preload-incompatible APIs
were found anywhere in this layer — it's all main-process Node/fetch/SDK
code, which already matches actovia's architecture. The real risk here is
the DB/i18n/knowledge-base fan-out (worst in philharmonic and
skills-manager's external dependency), not environment compatibility.

### Phase 4 — Hono server (`src/main/lib/server/`) — ✅ done (2026-09-19)

- `app.ts` (`connectHttpServer()`, wires `initScheduler()` +
  `initJobQueue()` on start), `instance.ts`.
- Middlewares: `lock-gate.ts` (needs Phase 2's `lock/`), `trace.ts` (needs
  decision #1's restore), `error-handler.ts` (already compatible with
  `@actovia/shared`'s `AppError`/`isAppError`/`toAppError` once decision #2
  lands).
- 26 route files — full list and one-line-each already captured in the
  backend-survey notes; port grouped by what they depend on (e.g.
  `chat.ts` at 618 lines is the biggest single file and needs `pi-agent-core`'s
  `agentLoop` from Phase 3 fully working first).
- **Skip `routes/skills.ts`** — skills is deprecated (Phase 3, third pass).
  `chat.ts` and `philharmonic-crud.ts` still import from
  `ai/skills/skills-manager`; that keeps working against the seam.
- **Flag:** `routes/tools.ts` imports `BrowserWindow` directly (used as an
  off-screen PDF renderer) — confirms the server isn't cleanly separable
  from the Electron main process as it exists today. Relevant if "split the
  Hono server out" ever means a genuinely separate deployable process rather
  than just a separate `packages/*` workspace package — revisit that
  ambition against this coupling before committing to a deployment topology.
- `SERVER_PORT` and other config live in `@shared/constants/systems` —
  **already ported** (as `@actovia/shared/constants/systems`, together with
  `@actovia/shared/utils/http`, the HTTP client shared by renderer and main),
  because Phase 3's `deepResearch` tool POSTs to `/api/deep-research` through
  it. **Resolved — `SERVER_PORT` stays `60223`.** It was briefly changed to
  `63129` (to keep two dev builds from fighting for the port, and to stop an
  actovia renderer from reaching universal-client's server and, through it, that
  app's database) and reverted the same day, on the user's correction. The
  collision rationale had gone away — the data directory is shared anyway now,
  and universal-client is to be deleted — and 60223 is this backend's public
  address: **the iOS app defaults to `http://localhost:60223`**
  (`NetworkingKit/ServerConfigStore.swift`; its README says the API is on
  60223). **Correction:** an earlier version of this note claimed no sibling
  repo referenced 60223; that check was made before the iOS app grew those
  references and never repeated. Never change the port without grepping the
  sibling repos again.
- This phase is what makes all 17 renderer `services/*.ts` (Phase 6)
  meaningful — none of them can do anything useful before this lands.

**What actually happened (2026-09-19):**

- **Ported:** the 47 upstream server files (`routes/skills.ts` skipped —
  skills is deprecated) plus a new `server/types.ts`: `@shared/*` →
  `@actovia/shared/*` rewrites only. `Variables` (`@shared/types/server`, which
  imports the app's `Settings`) moved into `server/types.ts` for the same
  dependency-direction reason as `types/db`; `@shared/types/db` became direct
  `db/schema` imports; `@shared/errors/app-error` and
  `@shared/constants/error-codes` got subpath exports in `@actovia/shared`, so
  the many files importing them stay verbatim. `logger/` was restored to the
  full upstream version (`routes/logs.ts` needs `normalizeToLogRecord`,
  `LogRecord`, `localDateStr`), with only `is.dev` → `app.isPackaged`.
- **A real bundling bug, found only by booting the app:** `node-cron` 4's ESM
  build runs `fileURLToPath(import.meta.url)` at module load (to locate its
  background-task daemon). In the single bundled CJS `main.js`,
  `import.meta.url` compiles to `{}.url`, so the app died at load with
  `The "path" argument must be of type string ... Received undefined` —
  typecheck, lint and unit tests were all green. electron-vite
  (universal-client) never hit it: it leaves main-process deps external. Fix,
  in `vite.main.config.mts`: `define: { 'import.meta.url':
  'process.getBuiltinModule("node:url").pathToFileURL(__filename).href' }`.
  The first attempt, `require("node:url")`, failed differently — Rolldown
  renames free `require` identifiers to avoid collisions and turned it into a
  broken `require$1`. Lesson: after adding a dependency to main, boot the app.
- **`main.ts`** runs the upstream sequence (legacy-location migration →
  migrations → i18n → artifacts migration → stale-task cleanup → Hono server
  → backup scheduler → menu → shortcuts → IPC → window → lock screen →
  settings-driven auto-updater / login item / tray), merged with what the base
  migration already had. Quit path: `will-quit` closes PGlite in a 5 s race
  and then `app.exit()`s, releasing the server port first — a stuck WASM
  teardown or a cron job can otherwise keep the event loop alive forever.
- **Dev isolation, removed:** there is no `-dev` anything any more — dev and
  packaged builds share `~/.actovia` (see the Phase 1 "Superseded" note) and
  Electron's default `userData` (`~/Library/Application Support/Actovia`; an
  interim `-dev` suffix on it was dropped too, at the user's request, since
  universal-client is to be deleted once migration testing is done). With
  that shared `userData`, the legacy-location migration finds only an old
  `logs/` there and `~/.actovia/logs` is non-empty, so it is a no-op.
- **`ipc.ts`** is upstream's handler set (find-in-page, quick-chat,
  fullscreen, theme, login item, menu bar, reveal artifact, updater, …) minus
  the skill-package picker, on actovia's `toAppError`-based `safeHandle`. The
  three demo handlers from the base migration (`open-file-dialog`,
  `open-logs-folder`, `show-item-in-folder`) are gone — nothing calls them.
- **`window.ts` / `tray.ts` / `menu.ts`:** the search bar (`WebContentsView`)
  and quick-chat window are back, both loaded through one `loadSubApp()`, and
  use actovia's sandbox + context isolation rather than upstream's
  `nodeIntegration`. Tray left-click toggles quick-chat as upstream does;
  show/hide of the main window stays in the tray context menu. The "Find"
  menu item is back, and `ACTOVIA_WEBSITE` now comes from
  `@actovia/shared/constants/external-urls` (`menu.ts` had its own copy saying
  `exdous.yancey.app` — a typo).
- **Auto-updater:** `update-electron-app` stays (base decision), but
  `auto-updater.ts` exposes the same state machine and IPC the renderer's
  update panel already speaks (`updater-get-state/check/download/install/
  set-auto-download`, `updater-state-changed`), driven by Electron's built-in
  `autoUpdater` events. Squirrel downloads by itself and reports no progress,
  so `available` is skipped (`downloading`, indeterminate, then `ready`);
  download is a no-op and set-auto-download only gates manual checks.
  Unpackaged, a manual check reports an error state by design.
- **`i18n.ts`** is the upstream version again (persisted `language` setting) —
  this closes the Phase 5 "thread the setting through once settings exists"
  TODO.
- **Verified:** typecheck / lint / unit tests, then a real boot — migrations,
  i18n, Hono on 60223, backup scheduler, lock IPC and the philharmonic
  scheduler all log up, and `GET /api/settings|history|project|mcp|usage`
  return 200. The `Unable to set login item` line in dev is macOS refusing it
  for an unsigned binary.

### Phase 5 — i18n — ✅ done (2026-09-18/19)

Migrated ahead of Phases 1–4 at the user's explicit request, once
`universal-client`'s i18n work landed. Notes below are what actually
happened, kept for the phases still ahead.

- `src/shared/i18n/` → `packages/shared/src/i18n/` (new `@actovia/shared/i18n`,
  `/i18n/locales`, `/i18n/namespaces`, `/i18n/catalog-audit` subpath
  exports, matching upstream's import shape almost verbatim). 10 locales at
  migration time (`ru` had been dropped since this document's original
  survey — always re-check live, per this doc's own opening note), 13
  namespaces, 139 files. `locales.ts`/`types.d.ts`/`catalog-audit.ts`
  ported verbatim.
- Decision #2 executed: `@actovia/shared`'s `ErrorCode` enum, `AppError`
  subclasses (`AIError`, `RateLimitError` included), and `error-codes.ts`
  restored to the full set in one pass, matching `errors.json`.
- **Main process**: `main/lib/i18n.ts` ported, but `initMainI18n()`
  no longer calls `getSettings()` — no settings/DB layer exists yet
  (Phase 1), so locale resolution always defers to the OS's preferred
  languages. Thread a persisted `LanguageSetting` through here once
  settings migrates. `menu.ts`/`tray.ts` `mainT()` calls restored for
  every label that already existed (Lock Now / Find stay out — lock and
  the searchbar sub-app are still unmigrated).
- **Renderer**: `renderer/lib/i18n.ts` ported verbatim. `i18n-provider.tsx`
  ported **without** `LocaleBridge` — it depends on a `useSettings()` hook
  backed by the Hono server, neither of which exist yet. Restore it once
  Phase 1 (settings) and Phase 6 (a renderer IPC wrapper) both land; until
  then the locale resolved once at boot (`?locale=` → `window.api.locale`
  → `'en'`) is what's in effect for the whole session. `preload.ts`/
  `preload.d.ts` restored `api.locale` (`ipcRenderer.sendSync('get-app-locale')`).
- `scripts/i18n-check.ts` / `i18n-status.ts` ported (via `bun run
  scripts/*.ts` directly — no `tsx` dependency needed, bun runs TS
  natively), wired into `package.json` scripts and `.husky/pre-commit`.
  `i18n-audit.ts` (the interactive/write-side audit tool) wasn't ported —
  only the two read-only report scripts were needed this pass.
- **Real, production-breaking bug found and fixed** — see the standing
  checklist below: `resourcesToBackend`'s runtime
  `import(`./locales/${lng}/${ns}.json`)` pattern never got resolved by
  Rollup once the code moved into the `@actovia/shared` workspace package —
  it shipped completely unresolved in a real `electron-forge package`
  build, meaning **zero translations would have loaded in any packaged
  build** despite working perfectly in dev mode. Replaced with
  `import.meta.glob`. This is exactly the kind of thing to re-check if any
  future phase adds another dynamic-import-based loader.
- Proof this actually works, not just typechecks: unit tests
  (`tests/unit/shared/i18n/engine.test.ts`) load real English _and_
  Japanese catalog content through the full pipeline; a real
  `electron-forge package` build was inspected byte-for-byte to confirm
  translated strings (`"Save"`, `"Delete"`, `"保存"`) are actually present
  in the shipped bundle, not just the dev server.

### Phase 6 — Renderer — ✅ done (2026-09-19)

Sequence: apply decision #3 (IPC bridge shape) first — it blocks everything
else here.

1. **Hooks + services + stores** — 20 hooks, 17 services (all assume
   Phase 4's server exists — literally none of them are meaningfully
   portable before that), 6 jotai stores. One exception to flag:
   `use-updater.ts` currently talks to `electron-updater`'s IPC channels,
   which actovia already removed this session in favor of
   `update-electron-app`'s much simpler model (no manual check/download/state
   surface) — this hook needs a redesign, not a port, matching what was
   done to `main/lib/ipc.ts`.
2. **Components** (non-`ui/`, already in actovia) — ~35 top-level files +
   9 subfolders (`calling-tools/`, `chat/`, `deep-research/`, `home/`,
   `lock/`, `philharmonic/` (largest — chat/employees/schedule/teams/workforce
   subfolders), `settings/` (26-file `settings-form/`), `web-search/`,
   `icons/`). Land roughly in dependency order with containers/layouts.
   **Skip the skills-market UI** (`settings-form/skills-market.tsx`,
   `containers/skills-market/*`, `services/skills-service.ts`) — skills is
   deprecated; leave a nav/settings entry for the replacement instead.
3. **Containers + layouts + routes** — `react-router` `createHashRouter`
   (hash routing, correct for a `file://`-loaded Electron renderer). Routes:
   `/settings` and `/philharmonic` lazy-loaded (Monaco/recharts-heavy);
   `/`, `/chat/:id`, `/project/:id` under a `ChatLayout`. Port the router
   shell + `ChatLayout`'s 8-file sidebar/nav system before individual
   feature pages.
4. **`index.html`** — universal-client's version has a strict CSP meta tag
   (Google APIs/fonts, TradingView, diagrams.net iframes,
   `connect-src` including a hardcoded dev port `localhost:60223` — **must
   be updated to match whatever port Phase 4's server actually uses in
   actovia**) and an inline-CSS boot-splash spinner that paints before the JS
   module graph loads (theme-aware via `prefers-color-scheme`). Both are
   worth preserving; re-validate the CSP's allowlisted origins against
   what's actually still in use.
5. **Sub-apps** (`searchbar/`, `artifacts/`, `quick-chat/`) — **land last**:
   each is a separate Vite renderer entry (own `main.tsx` + `index.html`).
   actovia's `forge.config.ts` currently declares only one
   `renderer: [{ name: 'main_window', ... }]` — each sub-app needs its own
   entry added to that array. Correspondingly, `window.ts`'s
   `registerSearchMenu()`/`registerQuickChat()` (deliberately stripped this
   session as "business features that don't exist in this repo") need to
   come back, along with the tray/menu wiring that opens them.

**What actually happened (2026-09-19):**

- **Decision #3 (IPC bridge shape) → (a).** Outside `lib/ipc.ts` only 5
  places in the whole renderer touch `window.electron` raw, but every call site
  and the ~35-function `lib/ipc.ts` wrapper use the nested
  `window.electron.ipcRenderer.*` shape — so actovia's preload was reshaped to
  match, mirroring `@electron-toolkit/preload`'s `electronAPI`
  (`ipcRenderer.{send,invoke,on,once,removeListener,removeAllListeners}` +
  `process.{platform,versions,env}`), reimplemented without the dependency.
  Nothing in actovia used the old flat bridge. `invoke` is typed
  `Promise<any>`, like the toolkit's.
- **Copy:** 259 files from `universal-client/src/renderer`; `@shared/types/db`
  → `@/types/db` (a renderer-side passthrough of `db/schema`, same reasoning as
  in main) and `@shared/*` → `@actovia/shared/*` (120 files touched). Both UI
  kits are shadcn `base-mira` on `@base-ui/react`, but universal-client
  customized its copy (rounder buttons, other sizes, `cn` from `@/lib/utils`
  rather than the `cn` npm package), so all 56 differing overlap files (the
  `components/ui` kit plus `i18n-provider.tsx`) were replaced by upstream's.
  actovia's demo `index.tsx` and `styles/globals.css` are gone
  (`assets/stylesheets/globals.css` now; `components.json` follows).
- **Layout constraint:** Vite's `root` stays the repo root.
  `@electron-forge/plugin-vite` sets it and merges the user config over it,
  but `build.outDir` is relative to `root`, so overriding it would mean
  hard-coding an absolute outDir tied to the plugin's internals. Consequences:
  `index.html` lives at the repo root (upstream's content, entry
  `/src/renderer/main.tsx`, CSP port updated), and the sub-apps (search bar,
  quick-chat, artifacts) are extra `rollupOptions.input` entries that keep the
  `src/renderer/sub-apps/<name>/` prefix in the output. Two places had to
  know: `window.ts` (`loadSubApp()`) and `artifact-card.tsx`, whose
  sandbox-iframe URL used electron-vite's `ELECTRON_RENDERER_URL` — it now uses
  `window.location.origin` in dev and `./src/renderer/sub-apps/artifacts/
  index.html` when packaged.
- **React Compiler is off, and stays off** (the base template had `babel({
  presets: [reactCompilerPreset()] })`). It was trialled on 2026-09-19 and
  dropped; `@rolldown/plugin-babel` and `babel-plugin-react-compiler` are
  uninstalled. What the trial found, for whoever reconsiders it:
  - It builds, and compiles 438 of 482 components/hooks — but only on
    `@babel/core` 7. The hoisted `@babel/core` was 8.x, whose `LVal` no longer
    covers `AssignmentPattern`, so the compiler silently skipped every
    component that destructures props with defaults (115 of them). Pin
    `@babel/core@^7` first.
  - **It would break the settings forms.** Their children take `form` as a prop
    and read `form.watch('field')` during render — 29 reads in 12 files. The
    compiler's react-hook-form guard only catches a component that calls
    `useForm()` itself; these were compiled, so each `watch()` result would be
    cached on the (stable) `form` and never update. They need `useWatch()` or a
    `'use no memo'` directive before the compiler can be on.
  - The chat hot path gains little: `messages.tsx` and `markdown.tsx` are
    already memoized by hand, and `Chat` / `useChat` are skipped anyway (they
    write refs during render).
  - Cost: the renderer build goes from 2.3s to 5.9s (+0.8% JS), and every dev
    transform gains a Babel pass. There are next to no renderer component
    tests, so a regression would only show up by hand or in e2e.
  - If it is ever wanted, the Babel-free route is plugin-react's native port
    (`react({ compiler: true })` + `oxc-transform-react`), still marked
    experimental as of plugin-react 6.1 — and the `form.watch()` problem
    applies to it just the same.
- **`data-testid` stripping** (the `strip-data-testid` plugin, gated on
  `STRIP_TEST_IDS=1`) is ported; `bun run make` / `publish` set it, `package`
  doesn't — the e2e suite needs the ids.
- **Skills market:** not migrated (user decision).
  `settings-form/skills-market.tsx` is a placeholder (existing i18n key, no
  new copy) so the nav entry stays; `containers/skills-market/*` and
  `services/skills-service.ts` are not copied; the test block in
  `settings-namespace.test.ts` that exercised that container was removed.
- **A dev-only i18n failure, found by the user right after hand-over
  (`messageList.greetingTitle` on screen instead of text).** In `bun run
  start`, Forge's `resolve.preserveSymlinks: true` keeps the `@actovia/shared`
  workspace package under `node_modules`, so Vite pre-bundled it with esbuild
  — which replaced the i18n loader's `import.meta.glob('./locales/*/*.json')`
  with `Object.assign({})`. No catalog ever loaded. Production builds (Rollup
  expands the macro), unit tests and the e2e suite (which drives the
  production build) were all green, so nothing caught it: until then the real
  renderer had never been rendered in dev mode. Fix:
  `optimizeDeps.exclude: ['@actovia/shared']` in `vite.renderer.config.mts`
  (guarded by `tests/unit/config/vite-renderer-config.test.ts`) — **and a second
  trap behind it, found when a port change didn't take effect**: Forge forces
  `resolve.preserveSymlinks: true`, which keeps the package under
  `node_modules`, so the dev server serves its modules as `?v=<hash>` URLs with
  `Cache-Control: max-age=31536000,immutable` and the watcher never matches them
  to a changed file. Any edit to `packages/shared/**` then stayed invisible to
  the dev renderer — across restarts too, since the URL is stable — until a hard
  reload (the running app kept calling the old `SERVER_PORT`). Fixed with
  `resolve.preserveSymlinks: false` in the same config: shared code is now
  ordinary source (`/packages/shared/src/...`, `no-cache`, watched, hot
  reloaded). Verified old-vs-new on an open dev page (touching a shared file:
  old = nothing happens, new = the page reloads) and on a scratch production
  build, whose output is **byte-identical** to the old config's — production
  never had the problem (hash-named files loaded via `file://`, no dev server,
  no `?v=`). Verified in a
  real Chromium against the dev server — baseline reproduced the raw keys,
  fixed showed `New chat / Search chats / Hello there!`, `ja` and
  `zh-Hant-TW` catalogs load too, `/settings` renders, and no module-resolution
  errors on the heavy routes.
- **Small restorations:** `UseFormReturnType` in
  `@actovia/shared/schemas/settings-schema` (Phase 1 left a note to re-add it
  with the settings form), and the `cron-parser` dependency (used by the
  philharmonic schedule UI).
- **New dependencies** (versions from upstream): `hono`, `@hono/node-server`,
  `@aws-sdk/client-s3` + `s3-request-presigner`, `jszip`, `@dicebear/core` +
  `collection`, `next-themes`, `sucrase`, `cron-parser`, and the renderer
  libraries (`jotai`, `swr`, `react-router`, `react-hook-form`,
  `monaco-editor`, `three` + `@react-three/*`, `react-markdown` +
  remark/rehype/katex, `framer-motion`/`motion`, `sileo`, …). Deliberately
  **not** installed: `electron-builder`, `electron-vite`, `electron-updater`,
  `@electron-toolkit/*`, `@tailwindcss/postcss` / `postcss` (actovia uses
  `@tailwindcss/vite`), semantic-release, `react-doctor`,
  `rollup-plugin-visualizer`, `@electron/asar`.
- **Lint:** actovia's oxlint config (`suspicious: error`, `pedantic: warn`) is
  stricter than universal-client's (`correctness` only) and produced ~70
  errors across 7 style rules in the ported code (`no-underscore-dangle`,
  `no-shadow`, `no-array-sort`, `no-array-reverse`,
  `prefer-add-event-listener`, `consistent-function-scoping`,
  `no-extraneous-class`). Those seven are `warn` in `.oxlintrc.json` (with a
  comment). An `oxlint --fix --fix-suggestions` pass was tried first and
  **rolled back**: among its ~190 changed lines, `(a + 0x9e3779b9) | 0` became
  `Math.trunc(a + 0x9e3779b9)` — not equivalent (the `| 0` wraps to 32 bits).
  At that scale it cannot be reviewed, so: no unattended auto-fixing of ported
  code.
- **Verified:** `typecheck` (node / web / shared), `lint` (0 errors),
  `fmt:check`, unit tests; a real `bun run package` (the asar holds the main
  page and the 3 sub-app pages at the expected paths, 325 assets, the 5 Monaco
  workers, preload and `main.js`); the built app launched under Playwright
  renders the real UI (sidebar, composer, projects) with no console errors or
  CSP violations; Settings opens via `Cmd+,` and via the account menu and lists
  every section, including the Skills Market placeholder.

### Phase 7 — Native computer-use helper (`src/main/lib/computer/`) — ✅ done (2026-09-19)

- `helper.ts` spawns a prebuilt **Swift binary**
  (`resources/bin/actovia-input`, built from `helper-src/actovia-input/main.swift`)
  via `child_process.spawn`, NDJSON over stdin/stdout. **macOS-only**
  (explicit in source). Has a full in-memory `mockHelper` behind an
  `ACTOVIA_INPUT_MOCK` env var — good precedent, port that too for testability.
- Needs: the Swift binary actually built and committed (or a build step
  added — check if `helper-src/` has its own build script, or if it's built
  ad hoc), decision #4's asar-unpack config so it's reachable in packaged
  builds, and `is.dev` → `app.isPackaged` replacement.
- `capture.ts`, `guard.ts`, `hands.ts`, `liveness.ts`, `session.ts`,
  `target.ts`, `types.ts`, `ask-registry.ts` all consume `helper.ts`'s
  `InputHelper` interface — port together once `helper.ts` itself works.
- This is what makes Phase 3's `ai/computer-use/` (the model-facing half)
  actually functional end to end, not just typecheck-clean.
- **Already pulled forward:** `computer/types.ts` (+
  `@actovia/shared/types/computer-use`), because `ai/computer-use/` imports
  `Action`/`ComputerState` from it. **Still to do here:** port
  `ai/calling-tools/computer-use.ts` (imports `guard`, `liveness`,
  `session`) and re-add the `computerUse` registration in
  `calling-tools/index.ts` and `utils/tool-binding-util.ts` (a one-line
  comment marks the spot). Its upstream test
  (`tests/unit/main/lib/ai/calling-tools/computer-use.test.ts`) comes with
  it, along with the 8 `tests/unit/main/lib/computer/*` files.

**What actually happened (2026-09-19):**

- `computer/` (the 8 files left after `types.ts` came with Phase 3) and
  `ai/calling-tools/computer-use.ts` are ported. The tool is registered again
  in `calling-tools/index.ts` and `utils/tool-binding-util.ts` (the Phase 3
  stub comment is gone). Their upstream unit tests (8 + 1) came along and pass.
- **Helper path:** `helper.ts` resolved the binary through electron-toolkit's
  `is.dev` plus an `app.asar.unpacked` fallback. It now just calls
  `getResourcePath('bin/actovia-input')` — dev `<repo>/resources/bin`, packaged
  `Contents/Resources/resources/bin` (`extraResource: ['./resources']`).
  **Decision #4 needed no `asar.unpack` config after all:** the binary is an
  `extraResource`, not inside the asar. Verified in a real package: present,
  mode `-rwxr-xr-x`.
- **Swift source and prebuilt binary** are both committed
  (`helper-src/actovia-input/main.swift`, `resources/bin/actovia-input`), as
  upstream does. `bun run build:helper` uses **`xcrun swiftc`**, not a bare
  `swiftc`: with a swiftly-installed toolchain first on `PATH`,
  `swiftc -target arm64-apple-macos13` fails with `unknown argument:
  '-target-arch-variant'`; through Xcode's toolchain it compiles cleanly to a
  same-size binary (146 608 bytes; not byte-identical — Mach-O UUID/paths).
- **Verified as far as it goes without granting permissions:** in the built
  app, Settings → Computer Use lists the installed apps (`GET
  /api/computer-use/apps` → the Swift helper) and adding "Chess" to the
  allowlist works (an e2e spec covers it). **Not exercised:** an actual
  computer-use session — that needs the macOS Screen Recording and
  Accessibility permissions granted to the app.

### Phase 8 — Tests — ✅ ported (2026-09-19; api/providers suites need `.env.test`)

Not a separate final pass — port the relevant slice of `tests/unit/` and
`tests/e2e/` alongside whatever phase they cover, same as this session did
for `packages/shared`'s error tests and the logger tests. Rough scale for
context: `tests/unit/renderer/` is thin (8 files against a much larger
component/hook surface — most renderer logic is currently untested in the
source too, so don't over-invest trying to backfill coverage that doesn't
exist upstream). `tests/e2e/` has ~20 Playwright specs (see below).

**What actually happened (2026-09-19):**

- **Unit tests:** every upstream unit test that has a home here is ported —
  136 files / 862 tests (incl. the two `tests/unit/config/` guards added in the wrap-up), all passing (the suite was 3 files at the start of
  Phase 3); `tests/unit/**` mirrors `src/`. Mechanical rewrites only
  (`@shared/*` → `@actovia/shared/*`, `@shared/types/db` →
  `@main/lib/db/schema`, dead `vi.mock('@electron-toolkit/utils')` removed).
  Adapted rather than copied: `paths.test.ts` (rewritten and run against a
  scratch `$HOME` — upstream's created directories in the
  real home), the i18n tests (locales moved to `packages/shared/src/i18n/
  locales`), `claude-md-freshness` (actovia's config files), the
  `no-hardcoded-strings` allowlist (it pins line numbers), and the skills-market
  block removed. `jobs/worker.test.ts` gained a `db/db` mock like its
  siblings — several upstream tests import the real `db/db` and would open a
  PGlite at import time.
- **`CLAUDE.md`** (required by two meta tests, and for future sessions) is
  upstream's, adapted: bun / Forge commands, `@actovia/shared`, ports, plus new
  sections on dev-vs-packaged isolation, the skills seam and this migration.
  `docs/` (specs, plans, the research and setup guides), `README.md`,
  `CHANGELOG.md` and `screenshots/` were carried over as they are;
  `tsconfig.test.json` (editor support for tests) was added.
- **Playwright suites** (`tests/e2e`, `tests/api`, `tests/providers`,
  `tests/fixtures`, `tests/helpers`, `playwright.config.ts`) are ported. The
  Electron fixture launches the repo root (`electron .`, so `package.json`'s
  `main` → the production build in `.vite/`), and `bun run test:e2e:electron`
  runs `electron-forge package` first: a `bun run dev` session overwrites
  `.vite/build` with a dev build, which broke a run mid-session. It runs
  **unpackaged on purpose** — the packaged app's Electron fuses disable the
  inspector Playwright attaches through. Isolation: `playwright.config.ts`
  points `$HOME` at a scratch dir and the fixture passes `--user-data-dir`, so
  nothing touches a real `~/.actovia` — the fixture wipes `~/.actovia` under that
  scratch `$HOME` before every test (settings persist, and a test that switched
  the language leaked it into the next one), so it **throws at import unless
  `$HOME` is the scratch dir** and blanks any `ACTOVIA_HOME` from the
  developer's shell.
- **Fixture / spec repairs — all upstream staleness, not port bugs (confirmed
  by driving the same paths by hand):** the composer autofocuses on mount and
  `use-keyboard-shortcuts` ignores every shortcut except Escape while a
  textarea has focus, so specs that press `Cmd+,` right after launch pressed
  into a no-op — the fixture now blurs after the first render; five specs
  looked for a sidebar "Settings" button that no longer exists (settings live
  in the account menu) and use a shared `tests/helpers/open-settings.ts` now;
  one assertion (`getByText('Chess')`) matched both the chip and the
  still-open option and is scoped to the chip; and a spec that assumed "AI
  Providers" was the default settings section now opens it explicitly.
- **Results:** Electron e2e — **28 passed, 0 failed, 7 skipped** (the skips
  are the specs that need a real model key or an Elasticsearch cluster).
- **`.env.test` was not copied** — it holds real OpenAI / Claude / Brave /
  Google Cloud keys (and is git-ignored in both repos). The `api` and
  `providers` projects need it (and `api` a running app), so they were not
  run; copy the file over to run them.

---

## Status and what is left (2026-09-19)

**Done and verified:** `typecheck` (node / web / shared), `lint` (0 errors),
`fmt:check`, 136 unit-test files / 862 tests, a real `bun run package`, and 28
Electron e2e specs passing (7 skipped — they need a real model key or an
Elasticsearch cluster). The built app boots, serves its API on 60223 and
renders the real UI without console errors.

**Wrap-up done (2026-09-19):**

- **Git.** `universal-client/.git` was copied in and the whole migration is one
  `build:` commit on branch `migrate/forge-vite-bun`, cut from `dev`. The commit
  shows a lot of deletions: files upstream has that actovia deliberately does not
  (`electron-builder.yml`, `electron.vite.config.ts`, `pnpm-lock.yaml` /
  `pnpm-workspace.yaml`, `dev-app-update.yml`, `src/shared/**` — now
  `packages/shared` — `packages/pi-lcm`, `scripts/asar-sniff.ts`, `.npmrc`,
  the skills-market sources). Anything dropped is recoverable from history at
  `370e146f` (universal-client's last commit), e.g.
  `git show 370e146f:packages/pi-lcm/<file>`.
- **CI / release.** `release.yml` was rewritten for bun + Forge, keeping the
  semantic-release flow (dry run → build matrix → tag / CHANGELOG / version
  commit → attach assets): each OS runs `bun run make` and uploads
  `out/make/**` (ZIP + DMG, Squirrel, deb, rpm). `playwright.yml`, `pr-check.yml`
  and `dependabot.yml` follow bun, `master` and the Forge scripts;
  `.releaserc.json` and `doctor.config.json` were carried over.
- **Package metadata.** `package.json` is at 1.14.0 (universal-client's last
  release) with `homepage` / `repository` set, so `update-electron-app` (which
  derives the repo from `repository`) and `PublisherGithub` point at
  `actovia-ai/actovia`.
- **Release-build checks.** `bun run make` on macOS arm64 produced a valid DMG
  and a ZIP (`hdiutil verify` OK; `Actovia.app` is version 1.14.0, bundle id
  `app.yancey.actovia`). With `STRIP_TEST_IDS=1` all 50 of our own `data-testid`
  attributes are gone from the renderer bundle; 6 remain, all third-party
  (`@vis.gl/react-google-maps`, `react-resizable-panels`) — out of scope by
  design, see `stripTestIdPlugin`.

**First GitHub run (PR #225 → master, 2026-09-19) and what it taught:**

- **Linux `make` failed** on `deb` / `rpm`: "could not find the Electron app
  binary at `out/Actovia-linux-x64/actovia`". The packager names the executable
  after `productName` (`Actovia`); `MakerDeb` / `MakerRpm` default `bin` to
  package.json's `name` (`actovia`). macOS and Windows filesystems are
  case-insensitive, so a local macOS `make` could not show it. Fixed with
  `bin: 'Actovia'` on both makers; reproduced (exit 1, same message) and fixed
  (exit 0, `.deb` + `.rpm`) in an ubuntu 24.04 container. **Reproduce Linux
  problems on the container's own filesystem** — a bind mount from macOS is
  case-insensitive too, and hid the bug in a first, invalid attempt.
- **The Windows PR Check leg failed `fmt:check` on all 946 files**: the runner
  checks out CRLF (`core.autocrlf=true`), oxfmt expects LF. `.gitattributes`
  (`* text=auto eol=lf`) fixes it. The source gates (lint / fmt / typecheck /
  i18n / tests) are OS-independent and now run once on ubuntu; the three-OS
  matrix builds the installers with `bun run make`, the release workflow's
  command, so packaging failures surface on the PR.
- **The Playwright workflow had never passed** (51 failures, 0 successes — it
  failed before the migration too). The repo defines no `OPENAI_API_KEY` /
  `CLAUDE_API_KEY` secret, so model-backed API specs got empty replies. They now
  skip without a key (`tests/helpers/require-key.ts`). The Electron E2E job
  (macOS, 28 passed / 7 skipped, about 3 minutes) was green.
- Switching `dependabot.yml` from `npm` to `bun` made Dependabot open 28 PRs at
  once, each triggering every workflow. The Slack notification workflow was
  removed.

**Second run (PR #233 merged, 2026-09-19):** PR Check — including the three-OS
`bun run make`, Squirrel on `windows-latest` among them — Playwright (its first
success ever) and React Doctor were green. The Release run got Linux and macOS
through `make`, but the Windows job died before it, in "Set package version", with
`The variable '$NEXT_VERSION' cannot be retrieved`. Windows runners default to
PowerShell, where an environment variable is `$env:NEXT_VERSION`; the step was
written for bash. Fixed with `defaults.run.shell: bash` on the build job.
Lesson: a PR check that runs `make` does not exercise the release workflow's own
shell steps — the two can pass and fail independently, so read each OS's release
job, not just PR Check. (Formatter quirk met while writing this: oxfmt reads a
bare pair of `$` in markdown prose as inline math and strips the spaces after
inline code between them — keep `$VARS` inside code spans.)

**Third run (Windows shell fix merged, 2026-09-19):** the Release run succeeded.
semantic-release cut **v1.15.0** (`chore(release): 1.15.0 [skip ci]`, db824b02)
and the release carries seven assets: `.rpm`, `.deb`, `.dmg`, the macOS `.zip`,
and Windows `Setup.exe` / `.nupkg` / `RELEASES` (GitHub turns the space in
`Actovia-1.15.0 Setup.exe` into a dot). So the `release` job — merge artifacts,
tag, CHANGELOG, attach assets — is now proven end to end. The same PR's
Playwright run failed once, on `settings-knowledge-base`, and did not block the
release: the spec points the knowledge base at `localhost:9621`, nothing listens
there, so `kb-sync` moves the doc Pending → Failed in milliseconds and the
assertion on the transient `Pending` badge is a race a slower runner loses. The
spec now asserts that the row carries _a_ status (any of the five labels). That
was checked against a replica of the row's markup in Chromium, not end to end
(a dev instance held port 60223).

**Open — needs the user:**

- **Merge the e2e fix** (`fix/e2e-kb-status-race`); its own Playwright run is the
  end-to-end check. Nothing else is waiting: the migration and the CI fixes are
  on `master` (PR #225, #233 and the Windows shell fix) and v1.15.0 is out.
  Existing Dependabot PRs pick up the CI fixes with `@dependabot rebase`.
- **The replacement for skills** (see Phase 3): plug it into
  `ai/skills/skills-manager.ts` and the Settings → Skills Market placeholder.

**Open — unverified rather than broken:**

- **Signing and notarization** — builds are unsigned and not notarized; adding
  `osxSign` / `osxNotarize` (and a Windows certificate) needs credentials.
- **No installer was ever launched.** The DMG was only checked as a file
  (`hdiutil verify`); Squirrel, deb and rpm were built and uploaded, not
  installed.
- `knowledge-base/` against a live LightRAG server (mock-tested only).
- A real computer-use session (needs Screen Recording + Accessibility
  permission for the app).
- `WebPDFLoader`'s runtime `import("pdf-parse")` in a packaged build.
- The `api` and `providers` Playwright projects (they need `.env.test` — not
  copied, it holds real keys — and, for `api`, a running app).
- Auto-update end to end (needs a signed macOS build and a GitHub release).

**After `universal-client` is gone** (the user's plan, once testing is done):
nothing in actovia depends on it at runtime, and the "never two Actovia processes
on one data dir" caution stops involving a second app (it still holds for a dev
build vs the packaged app). Not updated for that (it is another repo):
`ios/README.md` says to run `pnpm dev` in `../universal-client` for the
API — it must point at actovia instead.

**Known, accepted divergences from universal-client:** React Compiler off
(evaluated and dropped, see above);
seven oxlint style rules downgraded to warnings; the auto-updater state machine
rebuilt on `update-electron-app`; the sub-app windows use
sandbox + context isolation.

---

## Standing checklist (apply every phase, not just once)

Lessons from this session's base-architecture work — these bugs were all
real, all shipped past a "looks fine" check, and were only caught by doing
the thing listed on the right:

- **Entry file basename collisions**: `@electron-forge/plugin-vite` names
  build output by the entry file's own basename (`[name].js`), not by the
  forge `target`. Any new top-level entry (a new sub-app's `main.tsx`, say)
  needs a basename that doesn't collide with an existing one in the same
  output directory. → _Verify by running `bun run package`, not just
  `bun run dev`_ — dev mode doesn't exercise this path.
- **`packagerConfig.extraResource` nests under the source folder's own
  basename** (`Contents/Resources/resources/*`, not flattened) — don't
  assume a resource path without checking the actual packaged output.
  → _Verify by inspecting a real `electron-forge package` output, not by
  reading the docs and computing the path by hand._
- **Sandboxed preload (`webPreferences.sandbox: true`) can't
  `require()` arbitrary Node builtins** — confirmed only `process.platform`/
  `arch`/`getSystemVersion()`-style properties work; a plain `import os from
  'os'` throws `module not found: os` _silently_ unless something listens
  for the `preload-error` event (actovia's `window.ts` already does). Any
  newly-ported preload code needs the same scrutiny. → _Read full launch
  output, don't just check the process stayed alive._
- **`"type": "module"` in `package.json` breaks
  `@electron-forge/plugin-vite`'s CJS main/preload output** (`formats:
  ['cjs']`, hardcoded in the plugin) — don't re-add it.
- **`is.dev` (from `@electron-toolkit/utils`) isn't available and shouldn't
  be added** — use `app.isPackaged` everywhere, per the established
  convention.
- **A runtime dynamic `import(`./relative/${var}.json`)` inside a
  workspace package (`@actovia/shared` or any future `packages/*`) doesn't
  get resolved by Rollup once it ships** — it survives completely
  unresolved in a real `electron-forge package` build (confirmed by byte-
  grepping the output), meaning it silently does nothing at runtime, while
  working perfectly in dev mode (Vite's dev server serves any file live,
  masking the problem). This bit i18n's locale loader. Use
  `import.meta.glob('./relative/*/*.json')` instead — a Vite compile-time
  macro, not a runtime heuristic — for any future loader with this shape
  (needs `"types": ["vite/client"]` added to whichever tsconfig(s)
  typecheck the file, since it's Vite-specific syntax `tsc` doesn't know
  natively). → _Verify by grepping the actual built bundle for real
  content (a literal string you know should be there), not just "the
  build didn't error."_
- **Verification bar for "this works"**: `bun run typecheck && bun run
  lint && bun run fmt:check && bun run test`, _then_ `bun run dev` with
  full log output actually read (not just "process is alive"), _then_
  `bun run package` (and ideally `bun run make`) with the real binary
  launched and its console output captured, _and_ for anything involving
  bundled data (locale files, etc.) grep the actual built output for real
  content — this session's four real bugs (three in the base migration,
  one here) were only found by doing this, never by dev mode or typecheck
  alone.
- **A dependency added to the main process can crash the bundle at load — and
  nothing but booting the app shows it.** `node-cron` 4 passed typecheck,
  lint and every unit test, then killed the app with
  `fileURLToPath(undefined)` because `import.meta.url` compiles to `{}.url`
  in the single bundled CJS `main.js` (see Phase 4). After adding any runtime
  dependency to `src/main`, run `bun run dev` (or a Playwright launch) and
  read the log. → _Verify by booting, not by the green gates._
- **Dev mode is a separate pipeline from the production build, and
  everything else here only exercises the latter.** Vite-only macros
  (`import.meta.glob`, `?worker`, …) inside a workspace package are silently
  broken by the dev pre-bundler unless the package is in
  `optimizeDeps.exclude`. After touching the renderer build config or
  `packages/shared`, render the real UI from `bun run dev` (or a standalone
  Vite instance on another port + a stub Electron shell), not just from a
  package build. Dev also serves anything under `node_modules` as immutable
  (`?v=` + a year of caching): keep workspace packages out of that path
  (`preserveSymlinks: false`). → _Verify by rendering in dev._
- **`.vite/` is shared by `bun run dev` (dev bundles, dev-server URL baked
  in) and `bun run package` (production bundles).** Whoever ran last wins, and
  an app launched with `electron .` silently loads the wrong one
  (`ERR_CONNECTION_REFUSED` on `localhost:5173`). `test:e2e:electron`
  packages first for this reason.
- **No unattended auto-fix on ported code.** `oxlint --fix --fix-suggestions`
  changed ~190 lines in one go, including a 32-bit `| 0` wrap that became a
  non-equivalent `Math.trunc`. Fix lint errors by hand, or downgrade the rule
  in `.oxlintrc.json`.

---

## Open questions for the user (resolve before or at the start of execution)

1. IPC bridge shape (decision #3) — reshape actovia's preload to nest under
   `.ipcRenderer`, or rewrite renderer call sites?
2. Error-code enum (decision #2) — restore the full ~50-code enum in one
   pass now, or grow it per-phase as routes/tools land?
3. DB migration history — regenerate fresh via `drizzle-kit generate`
   against the copied schema, or carry the 3 existing SQL files verbatim?
4. "Split the Hono server out" — given `routes/tools.ts`'s direct
   `BrowserWindow` dependency, does that still mean "own `packages/*`
   workspace package" (compatible with today's coupling) or "separate
   deployable process" (needs decoupling work first, out of scope for a
   straight port)?
5. `ai/skills/skills-manager.ts`'s hardcoded Convex endpoint — still the
   intended backend, or should this be reconsidered during migration rather
   than ported as-is? **Resolved 2026-09-19:** deprecated, backend and
   frontend; only a stub seam is kept (see Phase 3, third pass).

**All five resolved (2026-09-19):** #1 → (a), a nested preload bridge
(Phase 6) · #2 → the full enum, in one pass (Phase 1) · #3 → the 3 existing SQL
migrations carried verbatim in `resources/drizzle` (Phase 1) · #4 → the server
stays inside the main process, ported as-is under `src/main/lib/server` — no
split · #5 → skills deprecated, stub seam only.
