# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Actovia is a cross-platform desktop AI chat application built with Electron, React, and Node.js. The toolchain is electron-forge + Vite (via `@electron-forge/plugin-vite`) + bun, with a `packages/shared` workspace package (`@actovia/shared`). It features multi-provider LLM support, a knowledge base (RAG), Deep Research, Philharmonic (multi-agent Groups), MCP (Model Context Protocol) routes, an app lock, lossless context management (LCM), and a memory/personalization layer.

### Naming

The product is **Actovia**. Visible names
come from `APP_DISPLAY_NAME` (`packages/shared/src/constants/brand.ts`) and the
i18n catalogs; the repo is `actovia-ai/actovia`, the site `actovia.yancey.app`,
the CLI `@actovia-ai/cli` (command `actovia`). Internal identifiers that hold data
or pair devices **keep the old name** — renaming them would orphan user data:
`package.json` `name: "actovia"` / `productName: "Actovia"` (they derive the
Keychain item "Actovia Safe Storage", Electron `userData` and the
single-instance lock — **never call `app.setName` or change `productName`**; a
unit test guards it), the bundle ids, `~/.actovia` and every `ACTOVIA_*`
variable, the Windows `Actovia.exe`, the LAN certificate subject `CN=Actovia`
(devices pin its fingerprint), the `actovia://` and `actovia-artifact://`
schemes, the `actovia-*` fences and `x-actovia-presence`, the DB enum value
`'actovia'`, the `actovia-color-tone` localStorage key, `~/Actovia Projects`, the
`actovia-input` helper, and code names such as `@actovia/shared`,
`ACTOVIA_REPO` or `brand/Actovia.icon`. Spec:
`docs/superpowers/specs/2026-10-19-actovia-rebrand-design.md`.

## Project Constraints (read first)

These rules are mandatory. Some are automated (noted); the rest are conventions
you must uphold.

- **Tests + checkpoints with UI.** When adding a key interactive element, add a
  `TEST_IDS` entry (`packages/shared/src/constants/test-ids.ts`) + `data-testid`, and
  reference it from a Playwright test. Test ids are a durable contract — never
  rename or regenerate an existing id. _Enforced by `test-ids.linkage.test.ts`._
- **Pre-commit gate.** Before committing, `bun run fmt` → `bun run lint` →
  `bun run typecheck` → `bun run i18n:check` → `bun run test` must pass. _The
  husky pre-commit hook runs lint-staged (oxlint + oxfmt on staged files),
  typecheck, i18n:check and `bun run test:staged` — `vitest related` over the
  staged `.ts`/`.tsx`/`.mts` files, so only the tests that import them (with git's hook variables such as `GIT_INDEX_FILE` cleared, or tests that run `git` act on this repo's index); run the
  full `bun run test` yourself before a change that spans many modules._ Do not `--no-verify` except for one known,
  standing cause: a flaky PGlite WASM teardown (`RuntimeError: Aborted()`
  during an `invoke_viiiiii`/wasm abort in `@electric-sql/pglite`) under
  the parallel-worker test isolation — a race in PGlite's WASM teardown,
  not a bug in one specific test file. It has surfaced attributed to
  `src/main/lib/ai/context-management/index.test.ts` and to
  `src/main/lib/jobs/worker.test.ts` on different runs of an unrelated,
  passing (785/785) suite — before invoking `--no-verify` for this,
  confirm all tests actually passed and the only failure is this
  unhandled-rejection-during-teardown pattern, then retry `bun run test`
  once (it's intermittent and often passes clean on a second run) before
  reaching for `--no-verify`. (A second, long-standing exception — an
  orphan `TEST_IDS.providerModels.modelSelect` id — was resolved
  2026-09-18 when `model-picker.tsx`'s i18n pass applied the id to its
  `ComboboxInput`, satisfying the linkage test the Playwright spec had
  been waiting on since before this id existed.)
- **Reuse UI primitives.** Prefer existing `@/components/ui` (shadcn) components
  over hand-rolled equivalents (e.g. shadcn `Select`, `InputOTP`).
- **Copy language.** New user-facing strings are keys in
  `packages/shared/src/i18n/locales/en/<namespace>.json`, rendered via `t()` /
  `<Trans>` (renderer) or `mainI18n.t()` (main) — never hardcoded literals.
  English is the source catalog. `bun run i18n:check` gates catalog parity.
- **Keep this file current.** Any change to architecture, routes, or directory
  structure updates CLAUDE.md in the same change. _Partly enforced by
  `claude-md-freshness.test.ts` (paths) and `claude-md-staleness.test.ts`
  (retired claims)._
- **Models & providers.** Use the shared `resolveModel()`
  (`src/main/lib/ai/providers/resolve-model.ts`); model selection is now
  live-fetched per provider from Settings.

## Development Commands

### Running the Application

```bash
bun run dev              # Start the dev build via electron-forge (Vite dev servers, hot reload)
```

### Building

```bash
bun run package          # Package the app for the current platform into out/ (keeps data-testid markers — e2e needs them)
bun run make             # Build installers/archives (Squirrel, ZIP, DMG, deb, rpm); strips data-testid (STRIP_TEST_IDS=1)
bun run publish          # Publish a release to GitHub (needs GITHUB_TOKEN)
bun run build:helper     # Rebuild the macOS Swift computer-use helper into resources/bin/actovia-input
```

Every build (dev, `package`, `make`) writes hidden source maps beside the
files in `.vite/`, and they ship inside `app.asar`: an error in the log names
`src/…:line:column` instead of a position in a minified chunk. See
`src/main/lib/logger/` and the Vite configs under Code Structure.

### Code Quality

```bash
bun run typecheck        # Run TypeScript checks for node (main + preload), web (renderer) and the shared package
bun run typecheck:node   # Check main process + preload code only
bun run typecheck:web    # Check renderer process code only
bun run typecheck:shared # Check packages/shared only
bun run lint             # Run oxlint (replaces ESLint, ~50-100x faster)
bun run lint:fix         # Run oxlint with auto-fix
bun run fmt           # Format all files with oxfmt (replaces Prettier, ~30x faster)
bun run fmt:check     # Check formatting without modifying files
```

### Testing

```bash
bun run test             # Run all unit tests with Vitest
bun run test:watch       # Run tests in watch mode
bun run test:coverage    # Run tests with V8 coverage report
bun run test:e2e:electron  # Playwright Electron E2E (packages first: it drives the production build in .vite/; the app boots pi's scripted provider — ACTOVIA_FAUX_PROVIDER=1 from the fixture — so chat specs need no key)
bun run test:e2e:api       # Playwright API integration (needs a running app + .env.test)
bun run test:e2e:providers # Provider compatibility (needs API keys in .env.test)
```

### Database

```bash
bun run db:generate      # Generate Drizzle migrations from schema
```

### Other

```bash
bun run i18n:check       # Verify catalog parity across all locales (also runs in the pre-commit gate)
bun run i18n:status      # Print the translation-review status board per locale
bun run icons            # Regenerate every icon, the tray glyph, web assets and the boot splash from brand/art.mjs
```

## Architecture

### Electron Process Model

Actovia uses a three-process architecture:

1. **Main Process** (`src/main/main.ts`):
   - Manages Electron app lifecycle, window creation, and IPC
   - Runs Hono HTTP server on `localhost:60223` (constant `SERVER_PORT` in `packages/shared/src/constants/systems.ts`)
   - Initializes PGlite database with pgvector extension
   - Connects the active MCP servers on demand — each chat request (and each Philharmonic employee loop) calls `getMcpTools()` (`src/main/lib/ai/mcp.ts`, a 5-minute per-server cache); nothing connects at startup
   - Handles updates (`src/main/lib/auto-updater.ts`, which keeps the state machine the renderer's update panel speaks): Squirrel via `update-electron-app` for a signed build, a release-page link for an unsigned one — see "Updates and code signing"

2. **Renderer Process** (`src/renderer/`):
   - React 19 application with React Router v7
   - Communicates with main process via HTTP (localhost:60223)
   - Uses Jotai for global state management
   - @tanstack/react-query for server state fetching
   - Entry points: main app plus the sub-apps searchbar, quick-chat, artifacts

3. **Preload Process** (`src/preload/preload.ts`):
   - Provides secure bridge between renderer and Electron APIs
   - Context isolation + sandbox enabled
   - Exposes `window.electron` (`ipcRenderer.{send,invoke,on,once,removeListener,removeAllListeners}` + `process.{platform,versions}` — deliberately not `process.env` — the same nested shape as `@electron-toolkit/preload`'s `electronAPI`, reimplemented without the dependency) and `window.api` (`os`, `locale`)

### Data directory, ports and isolation

Actovia is the successor of the older `universal-client` app and shares its
`~/.actovia` layout, so a dev build sees the same chats, settings and memories:

- **Data dir**: `~/.actovia` for packaged _and_ unpackaged runs (`bun run dev`,
  `electron .`) — `getACTOVIAHome()` in `src/main/lib/paths.ts`; startup logs the
  directory in use (`Data directory`); `~/.actovia/analytics` holds the DuckDB
  chat-audit snapshot; `~/.actovia/media/<chatId>/` holds generated images
  (`getMediaDir()`, and a chat's or Group's own dir only through
  `mediaDirFor()` in `media/store.ts`, which refuses an id that would leave
  it; a Philharmonic Group's go to `media/_groups/<conversationId>/`). **PGlite is single-process: never run two
  Actovia processes (a dev build, the packaged app, universal-client) against it
  at the same time** — the database can be corrupted (backups live in
  `~/.actovia/backups`). Between Actovia builds this is enforced:
  `src/main/lib/single-instance.ts` takes Electron's single-instance lock from
  `db/db.ts`, before PGlite is constructed (dev and packaged share `userData`,
  so they share the lock); a second launch exits and the running app raises its
  window, or — if the holder is quitting — waits for it. universal-client has
  its own `userData` and is not covered. `ACTOVIA_HOME` points a run at another directory.
- **Electron `userData`**: the default `~/Library/Application Support/Actovia`
  for every build — it only holds Chromium state (localStorage, caches) and is
  where the legacy-location migration looks. There is no `-dev` variant of
  anything.
- **Server ports** (`packages/shared/src/constants/systems.ts`): `SERVER_PORT =
  60223` is plaintext HTTP bound to loopback only (`127.0.0.1` and `::1`) — the
  renderer, the Actovia CLI, `tests/api` and the iOS Simulator; nothing on the LAN
  can reach it. `LAN_SERVER_PORT = 63129` is what `actovia-ios` on a device
  connects to. Don't change either without updating the clients.
- **E2E**: `playwright.config.ts` points `$HOME` at a scratch dir
  (`<tmpdir>/actovia-e2e-home`); the electron fixture wipes `~/.actovia` under it
  before every test and throws at import unless `$HOME` is that dir. It also
  refuses to launch while anything answers on `localhost:60223`: the renderer
  always talks to that port, so a running dev build (`bun run dev`) would be
  driven by the suite instead of the app under test — reading and writing the
  real `~/.actovia` through it. To test a
  packaged build by hand, sandbox `$HOME` and pass `--user-data-dir` the same way.

### Updates and code signing

The macOS releases are **ad-hoc signed** (no Apple Developer account yet).
Squirrel.Mac only accepts an update that satisfies the _running_ app's
designated requirement, and an ad-hoc app's requirement is its own `cdhash` —
so no update can ever pass, whatever the network does. The updater therefore
has two modes (`UpdateMode`, in the payload the panel receives):

- **`auto`** — Squirrel through `update-electron-app` (10-minute re-checks,
  downloads by itself, `ready` → "Restart & Install"). Windows, and any mac
  build with a real signature.
- **`manual`** — a mac build with an ad-hoc or missing signature. Squirrel is
  never started (its re-check would download the ~180 MB zip and fail every ten
  minutes); one lookup of the same update.electronjs.org feed at launch and one
  per manual check say whether a newer version exists, and the panel's button
  opens the GitHub releases page (`updaterDownload()`).

Which one is decided at runtime by `detectUpdateMode()` reading
`codesign -dv` on the running bundle (`Signature=adhoc` → `manual`) — no build
flag, so a build signed with a Developer ID switches to `auto` by itself.

The packaged bundle's signature is made self-consistent by the `postPackage`
hook in `forge.config.ts` (`codesign --force --deep --sign -`, skipped as soon as
`packagerConfig.osxSign` is set). Without it the bundle fails
`codesign --verify` with "invalid Info.plist (plist or signature have been
modified)": the packager rewrites `Info.plist`, and flipping fuses re-signs only
the executable — that was the exact error every downloaded update failed with.

**When a Developer ID exists** (none of this is wired or tested yet):

- forge: `osxSign` (identity, hardened runtime, an entitlements file for
  Electron's JIT/unsigned-memory needs) and `osxNotarize`; the secrets and
  certificate import in `release.yml`. Every Mach-O in the bundle must be signed,
  including the unpacked DuckDB `.node`/dylib and `resources/bin/actovia-input`,
  or notarization fails.
- The first signed release cannot be reached by auto-update from an ad-hoc one
  (the old requirement is a `cdhash`): users install it by hand once.
- On the first signed build, check what is bound to the signing identity:
  `safeStorage` data (`lock.dat`, the LAN certificate's private key — a lost key
  means a new fingerprint and every paired device has to re-pair), and the
  Accessibility / Screen Recording grants Computer Use needs.
- The settings secrets are `safeStorage`-bound too: every registry value in
  `settings` and every MCP secret is stored `enc:v1:…` under the same key
  (`src/main/lib/secrets/`). If the new identity cannot open them, nothing
  crashes and no ciphertext is ever sent — each key reads as unset,
  `GET /api/v1/settings/secrets-status` lists it in `needsReentry`, and the
  user pastes each API key (and MCP token) in again once; a save that does not
  touch a key keeps its old ciphertext until then.
- `quitAndInstall()` together with the "closing the window only hides it"
  handler in `window.ts` has never run (no update has ever got past validation):
  test it with two consecutive signed builds.

### Skills (skills.sh)

Agent Skills come from **skills.sh** (the ClawHub marketplace was dropped for
quality reasons). `src/main/lib/ai/skills/`:

- `skills-sh-client.ts` — list / search / detail / audit against the BFF relay
  `SKILLS_SH_BFF_URL` (`https://skills-md.yancey.app`, the same relay
  the Actovia CLI uses; `ACTOVIA_SKILLS_BFF_URL` overrides it).
- `skills-store.ts` — installs a skill's `files[]` under
  `~/.actovia/skills/<slug>/` and records it in `~/.actovia/skills/.lock.json`
  (files first, lockfile last; paths that escape the slug dir are refused).
  Same directory and lockfile shape as the Actovia CLI, so skills installed by
  either are visible to both.
- `skills-manager.ts` — the seam chat + Philharmonic consume:
  `listInstalledSkills()`; for chat, `getActiveSkillsIndex()` — one line per
  active skill (slug, the SKILL.md frontmatter `description` folded onto one
  line, the absolute path of its SKILL.md) that the system prompt carries in
  `<skills>`, so the model reads a skill's body with `read_file` only when a
  task matches (the Agent Skills spec's own model; constant prompt cost);
  for Philharmonic, `getSkillsContentBySlugs()` / `getActiveSkillsContent()`
  (full bodies, frontmatter stripped, `$SKILL_DIR` baked to the install path,
  wrapped in `<active_skills>`).

Route `/api/v1/skills` (`src/main/lib/server/routes/skills.ts`): `GET
/registry?view&page&per_page`, `GET /search?q`, `GET /curated` (the registry's
publishers, each with every skill it maintains — ~2 MB, no parameters), `GET
/detail?id`, `GET /audit?id` (`null` when unaudited), `GET /installed`, `POST
/install {id}`, `DELETE /:slug`, `PATCH /:slug/toggle`. Skill ids are
`owner/repo/slug`, hence query params. UI: Settings → Skills Market
(`src/renderer/components/skills-market/`), built from the Settings kit like
every other page (one-line list rows — rank, name, source, an "Installed"
badge, installs on the right; no icon tiles, no mono outside commands and file
paths): Discover (search; All time / Trending / Hot leaderboards, same-repo
rows collapsed behind "+N more"; Curated — `curated.tsx`, publishers sorted by
installs, each opening to its skills with the registry's featured pick
badged) → detail page (security audit card, the copyable `actovia skills
install <id>` command, README card, bundled files) → install / toggle /
uninstall; an Installed tab. The page header is one short band: the intro on
the left and, on the right, a compact terminal block for the Actovia CLI
(`cli-notice.tsx`: package-manager tabs + two copyable commands, built from the
same `CommandLine` the detail page uses); it stacks in a narrow window. Spec:
`docs/superpowers/specs/2026-09-19-skills-sh-market-design.md`.

### Chat Audit (DuckDB)

Settings → Developer → Chat Audit is a read-only SQL console over a DuckDB
snapshot of the user's data (`src/main/lib/analytics/`, route
`/api/v1/analytics`, page `settings-form/chat-audit.tsx`). `snapshot.ts`
copies `chat` / `message` (and Philharmonic's `conversation_message` and `pm_round_event` as
`group_messages` / `pm_round_events`, scrubbed with the current secrets — empty when they cannot be read; preset `pmDecisions`) out of PGlite via NDJSON into
`~/.actovia/analytics/actovia.duckdb` (usage flattened to `*_tokens` /
`cost_usd` columns, `content` kept as JSON) and copies
`~/.actovia/logs/*.jsonl` into a `logs` table; `duckdb.ts` lazy-`import()`s
`@duckdb/node-api` on first use (never at boot), opens the file
`READ_ONLY` for queries and `READ_WRITE` only while rebuilding, serialised
on one promise chain, and caps results at 500 rows. The query instance runs
with `enable_external_access = false` + `lock_configuration = true`, so no
query can read a file (`read_text`, `read_json`, `COPY`, `ATTACH`) — which is
why `logs` is a table built at rebuild, not a view over the files. The copy
masks every current secret value (`secrets/scrub.ts`): an old log line could
quote a key. The editor is Monaco
(`settings-form/chat-audit-editor.tsx`, SQL language, ⌘↩ bound via the editor,
completions from `packages/shared/src/constants/chat-audit-schema.ts`, which
is also what `snapshot.ts` builds the tables from). Presets live in
`packages/shared/src/constants/chat-audit-presets.ts` and every one is
executed against a fixture snapshot in
`tests/unit/main/lib/analytics/snapshot.test.ts`. PGlite stays the only
write path. Packaging: the package is a Vite external and forge keeps
`node_modules/@duckdb/**` + `detect-libc` and unpacks `@duckdb/**` from
asar (the `.node` dlopens `libduckdb` beside itself). Research notes:
`docs/duckdb-research.md`; spec:
`docs/superpowers/specs/2026-09-19-duckdb-chat-audit-design.md`.

### Colour tone

The accents are the owner's reference of 2026-09-29 (ChatGPT's accent
colours) and the ones actovia-ios draws; neutral is shadcn's black and white.
They are too light to be text, so a tone is a fill (`--primary`, with
`--primary-foreground` on it) and an ink (`--primary-ink`: links, tinted
text, focus rings, thin lines — `text-primary-ink`, never `text-primary`),
plus `--bubble` for the user's message. `tests/unit/renderer/tone-palette.test.ts`
holds the colours, their contrast and the class rule. The tone colours a
conversation, not the page around it (owner, 2026-10-09): a
`data-tone-scope="neutral"` region is drawn with the neutral tone's accents
(`--primary`, `--primary-ink`, `--accent`, `--ring`, `--bubble`,
`--chart-1`, `--sidebar-primary`…; the greys keep the tone's hue, as Chat's
do) and `data-tone-scope="tone"` inside it takes the chosen tone back
through `--toned-*`, which `:root` computes from the tone on `<html>`
(globals.css, "Where the tone stops"). Philharmonic's layout is neutral; a
group's transcript and composer (`group-chat.tsx`) are toned.

**What leaves the app** (same date): Copy writes an answer's `【N-source】`
markers as `[n]` with a References list under it (`lib/citation-references.ts`,
the rule of the Deep Research PDF and of actovia-ios's copy); a `web_search`
brings back about ten sources in one Brave request — two per site, 8k
tokens — and deep recall (three phrasings plus a breadth pass, six requests)
is off unless switched on (`SEARCH_LIMITS` in `ai/utils/web-search-util.ts`;
Deep Research keeps its own volume, `DEEP_RESEARCH_LIMITS`). Sources are
numbered through a chat, not per run: the tools' rank registry is made anew
for every request, so the chat route hands `bindCallingTools` the highest
number the conversation has got to (`highestSourceRank()` in
`chat/sources.ts`, the highest `rank` of the chat's `chat_source` rows) and
the run counts on from it — a `【3-source】` means one source in the whole
chat. A picture or video from `media="images"` hangs on the
source whose page it came from (`attachMedia()`), never on the first
source — the model cites a picture by that page; one from a page the search
did not read is a source of its own ("the page itself was not read"), and
renditions of one picture (`-1140x815` / `-120x86`) count once. The gallery
under an answer and its lightbox show only the thumbnail Brave fetched,
never the site's own file — it may refuse a hotlink, be gone or not answer
(owner, 2026-09-30); an image with no thumbnail is left out
(`collectGalleryImages()`; actovia-ios `SearchGallery`, `SearchViewerImage`).

Settings → General → Color tone (`generals.tsx`) persists `settings.colorTone`
(`ColorToneSchema`: neutral | emerald | blue | violet | rose | orange | yellow;
a `text` column defaulting to `neutral`). The value becomes `data-tone` on
`<html>`, and `globals.css` carries one `[data-tone='…']` /
`.dark[data-tone='…']` token block per tone (neutral is the base
`:root` / `.dark`). `src/renderer/lib/tone.ts` applies the attribute and
mirrors it to localStorage (`actovia-color-tone`) so every entry (`main.tsx`

- the three sub-apps) can call `bootTone()` before React mounts (no flash);
  `components/app/tone-bridge.tsx` follows `useSettings()` in the main window and
  sub-apps follow via the `storage` event. The light/dark/system mode stays in
  next-themes' `vite-ui-theme` key.

### Icons, tray and boot splash

The mascot is **Ody the Traveller**, a marshmallow gumdrop with a polka-dot
bindle over its shoulder, on sunflower yellow; the menu bar glyph is Ody's
head alone, leaning in from the corner (a head reads better than the full
figure at 22 pt). The art is SVG-building functions in `brand/art.mjs`
(shared helpers in `brand/lib.mjs`), and `bun run icons`
(`scripts/render-icons.mjs`: Playwright's Chromium or an installed Chrome,
plus `iconutil`) renders everything from it:

- `build/icon.icns` and `build/icon-dock.png` — from the Icon Composer export
  `brand/liquid-glass/light.png`, on Apple's 824-in-1024 grid with a drop
  shadow; `build/icon.ico`, `build/icon.png`, `build/<n>x<n>.png` for the
  other packagers
- `build/icon.icon` — a copy of `brand/Actovia.icon`, the Icon Composer
  document (layer order, glass, shadow; the background swaps to
  `background-dark.svg` in the dark appearance via `hidden-specializations`),
  with its layer SVGs refreshed from `brand/icon-composer/`. @electron/packager
  compiles it with `actool` into `Assets.car` + `CFBundleIconName`, so macOS 26
  follows System Settings → Appearance → Icon & widget style (Default /
  Dark / Clear / Tinted — not the light/dark appearance itself); older macOS
  falls back to `icon.icns`. That needs macOS 26 + Xcode 26 on the packaging machine
  and fails the build otherwise, which is why every macOS job in CI
  (`release.yml`, `pr-check.yml`, `playwright.yml`) runs on `macos-26`, not
  `macos-latest`
- `src/renderer/assets/images/logo-light.png` and `logo-dark.png` — the
  Liquid Glass exports at 256 px for the header of Settings → About (the
  app theme picks one)
- `resources/icon.png` (Linux window icon) and
  `resources/trayTemplate{,@2x,@3x}.png` (22 pt, black + alpha: the
  `Template` suffix lets macOS tint it; `tray.ts` loads the 1x name)
- `brand/svg/` masters, `brand/icon-composer/` layers (Ody without its
  contact shadow — Icon Composer adds its own), `brand/ios/AppIcon.appiconset`
  (light, dark, tinted; no alpha), `brand/web/` (favicons, touch icon, PWA
  icons + manifest, `og-image.png` set in Fredoka from `brand/fonts/`)
- the boot splash in `index.html`, between its `boot-splash:start` /
  `boot-splash:end` markers: Ody walks in, hops with the bindle swinging,
  blinks, and three dots pulse while the module graph loads. It lives inside
  `#root`, so React's first render replaces it (the e2e fixture waits for
  `#boot-splash` to go), has no background of its own (window vibrancy), and
  animates only `transform` / `opacity` on separate HTML layers — those run
  on the compositor, so the motion does not freeze while the main thread is
  busy.

A dev run (`bun run dev`) is node_modules' prebuilt `Electron.app`, so
macOS shows Electron's own icon and name. `setDevDockIcon()`
(`src/main/lib/dock-icon.ts`, first thing on `ready`, dev + macOS only)
points the Dock at `build/icon-dock.png` (`nativeImage` cannot read
`.icns`). The menu bar title stays "Electron":
it is that bundle's `CFBundleName` and cannot change at runtime; patching
its `Info.plist` would also invalidate the signature the Accessibility /
Screen Recording grants are tied to, so it is deliberately left alone.

Never edit a generated file by hand. `brand/` is deliberately outside
`resources/`, which is copied into the app bundle whole (`extraResource`).

### Migration status

`docs/migration-plan.md` records how the business code was ported from
universal-client and every place it deliberately diverges (React Compiler left
off, seven oxlint style rules downgraded to warnings, auto-updater state machine
rebuilt on `update-electron-app`, …). Read it before changing build/packaging code.

### Backend Server Architecture

The main process runs a **Hono HTTP server** that handles all business logic:

**Server Routes** (`src/main/lib/server/routes/`, registered in `src/main/lib/server/app.ts`):

Every business endpoint is mounted on one versioned sub-app (`app.route('/api/v1', v1)`), so the public paths are `/api/v1/<route>`; the lock/trace/settings middlewares still match `/api/*`. A breaking API change ships as a new `/api/v2` sub-app beside v1 rather than mutating v1 in place. Any client of this backend (the renderer, `tests/api`, `actovia-ios`) must address `/api/v1/...`.

`/api/v1/chat`, `/api/v1/lcm`, `/api/v1/history`, `/api/v1/knowledge-base`, `/api/v1/settings`, `/api/v1/skills`, `/api/v1/audio`, `/api/v1/db-io`, `/api/v1/deep-research`, `/api/v1/discover`, `/api/v1/tools`, `/api/v1/philharmonic`, `/api/v1/s3`, `/api/v1/mcp`, `/api/v1/memory`, `/api/v1/usage`, `/api/v1/logs`, `/api/v1/backup`, `/api/v1/artifacts`, `/api/v1/media`, `/api/v1/maps`, `/api/v1/computer-use`, `/api/v1/analytics`, `/api/v1/pair`, `/api/v1/devices`, `/api/v1/workspace`, `/api/v1/lock` (mounted directly on `app`, ahead of the lock gate — see App Lock).

The `/api/v1/settings` route includes `POST /api/v1/settings/models` — dispatches to the appropriate list-models handler based on the provider in the request body, reading the API key from the request (not from saved settings) to fetch live model catalogs; a posted mask stands for the stored key, and only with the stored (or default) base URL — a mask with another base URL is a 400 ("re-enter the API key"; code `SECRET_REENTRY_REQUIRED`, `params.field: 'apiKey'` — the model picker shows it inline under the key), so a stored key is never sent to a caller-chosen host.

The `/api/v1/chat` route serves history a page at a time (spec `docs/superpowers/specs/2026-10-01-chat-history-and-context-design.md` §C3, `src/main/lib/chat/page.ts`): `GET /api/v1/chat/:id/page?runs=10&before=<runId>&through=<runId>` → `{ messages, sources, questions, hasOlder, olderCursor }` — the newest `runs` runs (1–50, default 10) before `before`'s group, reaching back at least to `through`'s (the outline's jump), whole runs and a regenerate group never split; `messages` in `GET /:id`'s row shape without what no client reads (`compactRow`: `searchText`, `chatId`, a successful result's text when `details` carry the payload — computer use keeps it for its screenshot — a search result's `content` extract, an artifact call's `code`), a row still over 64 KB cut to 8 KB per string with `truncated: true` (`limitRow`); `sources` every `chat_source` row of the chat without its text, each with its `runId`; `questions` one per run group (≤ 200 characters); `404 RUN_NOT_FOUND` for a cursor not of the chat. `GET /api/v1/chat/:id/messages/:messageId` is one row whole (`404 MESSAGE_NOT_FOUND`). `GET /api/v1/chat/:id` (every row, whole) is unchanged. Both clients open a chat on its newest page.

The `/api/v1/chat` route includes `POST /api/v1/chat/:chatId/choose` (`{ runId }` → `{ attempts }`) — keeps one answer of a regenerate group (see Chat Flow); `404 RUN_NOT_FOUND` for a run not in a group of that chat, `409 ATTEMPT_LOCKED` once a later run exists (repeating the current choice always answers). Deliberately not in `PRESENCE_PATHS`: it only picks which of the user's own answers the model sees next, and actovia-ios calls it over the LAN.

**Secrets leave the main process as masks only** (`src/main/lib/secrets/`): `GET /api/v1/settings` and the `/api/v1/mcp` responses turn every registry field (`registry.ts` — provider keys, Google / Brave / LightRAG keys, S3 credentials, the legacy `mcpServers` blob; `mcp_server.env` / `headers` values, everything under a secret-named `extraConfig` key, and secrets inside an MCP `url` / `args`: userinfo, secret-named query values, capability path segments, `--token` / `--api-key=` / `--header "Authorization: …"` values) into `"•••• " + last4` (`"••••"` under 12 characters). A posted mask means "unchanged": `updateSettings` / `updateSettingField` and the MCP create/update swap it back for the stored value (read through `current.ts`'s plaintext accessors — the seam at-rest encryption plugs into), `null` / `""` clear, anything else sets — so the desktop autosave and actovia-ios, which post whole sections/columns back, need no knowledge of masks. `getSettings()` / `c.get('settings')` stay plaintext inside main. A write that moves a secret's destination (`SECRET_DESTINATIONS`: a provider base URL / Azure endpoint, the LightRAG URL; for MCP the effective `url` / `transportType` for `headers` and the `extraConfig` secrets, `command` / `args` — and any edit to `env` itself (an entry added, removed or changed: `PATH`, `npm_config_registry`, `HOME`, `BASH_ENV`… each can swap the program), which counts as a new command — for `env` — a partial PUT that leaves the secrets out clears them too, `prepareMcpUpdate` in `at-rest.ts`) while the secret comes back as its mask, or is not re-sent, clears it — a stored key is never carried to a new host. Secret `args` go only to the command they were saved with: a new `command` refuses masked args, and a PUT that changes `command` without sending `args` writes `args: []` (none of the stored ones follow). A url / args / env / headers / secret `extraConfig` value (or anything on an MCP create) that holds `••••` without being the exact mask is a 400 "re-enter the secret" (`SECRET_REENTRY_REQUIRED`, `params.field` naming the column: `url` / `args` / `env` / `headers` / `extraConfig`) — a mask is never stored. At rest the values are `enc:v1:…` (see Security Considerations); `GET /api/v1/settings/secrets-status` answers `{ encryption: 'on' | 'unavailable', needsReentry: string[] }` for the Settings notices — `needsReentry` holds both the secrets that do not decrypt and those a destination move cleared (`moved.ts`), as plain names. A new schema field whose name `isSecretName()` flags (`…key`, secret, password, token, auth, bearer, credential, cookie, session, `pat` — word by word, so `path` / `author` / `keyboard` are not, nor the allowlisted `max-tokens` / `token-limit` / `session-name` / `session-timeout` / `signature-version` / `pass-through`; a value after a secret flag or under a secret name is masked whatever its shape — all digits (`-u root -p 98765432`, `DB_PASSWORD=12345678`) included) fails `registry.test.ts` until it is put in the registry or on its commented non-secret list.
**The desktop Settings form and masks** (`components/settings/secret-fields.tsx`, `lib/secrets.ts`): every key input is a `SecretInput` — the mask shows as text with a "Saved" addon (and is named for a screen reader as "Saved key ending in abcd" / "No key saved", never read out as bullets); typing (or pasting) replaces the whole mask and deleting from it clears the key (`replaceMask`); an untouched mask posts back as "unchanged", so the per-field autosave is unaware of it. A field a saved secret is sent to is a `DestinationInput`, which says from focus until its edit is saved that changing it clears the secret: `AddressInput` for the provider base URLs, the Azure endpoint, the LightRAG URL, and in the MCP form the url (clears the headers) and the command (with the args: clears the env and masked args). `buildSettingsSave` applies the same destination rule to the payload (`clearMovedSecrets`, a copy of `SECRET_DESTINATIONS` that `tests/unit/renderer/lib/secrets.test.ts` holds equal to main's, and the one shared `normalizeBaseUrl` from `@actovia/shared/utils/base-url`) and posts that key as `null`. The server records every secret a destination move cleared — settings keys and MCP `env` / `headers` / `extraConfig` values — in `needsReentry` until a new value is saved (`secrets/moved.ts`, names only, in `~/.actovia/secrets-reentry.json`, so the prompt survives a restart and reaches actovia-ios; a data reset clears it); the key input asks for it (`clearedSecretsAtom` only mirrors the move until that read lands), and the MCP server card and its form fields list theirs. The MCP form posts the `env` it shows (masks included — never `null`), and shows a `SECRET_REENTRY_REQUIRED` 400 under the field it names (the create/update hooks list that code in `meta.inlineCodes`, so it is not toasted too). Settings → General opens with the notices from `secrets-status` (`settings-form/secrets-notices.tsx`: keychain unavailable; each key to re-enter, by name, MCP servers included).

**Middleware Pipeline** (order in `app.ts`):

0. Compression (`compressLan`, `middlewares/compress.ts`) — registered first so
   it sees every response, refusals and errors included: on the LAN listener
   only (the phone, at home or over Tailscale; loopback is left alone), a
   JSON/text body of 1 KB or more goes out brotli (quality 5) when the client
   takes it — URLSession does over HTTPS by itself — else gzip; never an
   event stream (each frame must leave at once). A chat's history measured
   2.4 MB raw, 360 KB brotli, 725 KB gzip (2026-10-01)
1. Origin gate (`createOriginGate`) — a request must carry no `Origin` (actovia-ios, the Actovia CLI, `tests/api`, and the packaged renderer: a `file://` page in Electron sends none) or, in a dev build only, exactly the Vite renderer's; anything else — a website, another loopback port, `null`, an extension, the artifact sandbox — gets `403`, as does a request on the loopback listener addressed by a public `Host` (DNS rebinding). Runs before CORS so a refused origin gets no `Access-Control-Allow-Origin`. Which listener took a request is in the bindings (`listenerOf(c)` in `server/types.ts`)
2. CORS middleware (`hono/cors`)
3. Auth gate (`authGate`) — on the LAN listener a request needs `Authorization: Bearer <token>` of a paired device (`401` otherwise), except `POST /api/v1/pair`, which the pairing window guards; `/api/v1/devices*` is refused there outright (`403`). Loopback passes straight through. Ahead of the lock gate so an unauthenticated request learns nothing, not even that the app is locked
4. Lock gate (`lockGate`) — rejects all `/api/*` with `423` while the app is locked. `POST /api/v1/lock/unlock` is mounted just before it (after `authGate`), so a paired device can unlock the app from the phone
5. Presence gate (`presenceGate`) — `POST /api/v1/chat/approval` and every `/api/v1/devices*` route stand for "the user said so", and the model can reach loopback (`curl` through `terminal`): on loopback they need the `x-actovia-presence` header, a per-launch token held in main's memory and handed only to the main window's top frame over IPC (`api:presence-token`, `src/main/lib/presence.ts`; the renderer's `lib/presence.ts` attaches it) — `403 PRESENCE_REQUIRED` otherwise, so a model can neither approve its own paused call nor pair itself a device. On the LAN `authGate` already required a paired device's token
6. Trace gate (`traceMiddleware`) — wraps each `/api/*` request in an `AsyncLocalStorage` trace (see `src/main/lib/logger/`), sets the `x-trace-id` response header
7. Settings injection — `getSettings()` set on the Hono context per request (served from a cache in `db/queries.ts` that `updateSettings` / `updateSettingField` invalidate — write the `settings` table only through those two)
8. Error handler (`app.onError`, returns JSON errors)

There is no MCP middleware: the chat route itself fetches the active servers' tools per request (see MCP below).

### Database Layer

**Database**: PGlite (embedded Postgres) with pgvector extension

- Location: `~/.actovia/database` (`getDatabaseDir` in `src/main/lib/paths.ts`)
- ORM: Drizzle ORM with Zod schemas
- Schema: `src/main/lib/db/schema.ts`
- Migrations: `resources/drizzle/`

**Key Tables**:

- `settings` - Global settings (models, API keys, preferences, `colorTone`)
- `knowledge_doc` - Knowledge base source documents + per-doc LightRAG sync status
- `deep_research` / `deep_research_message` - Deep research jobs and progress updates
- `memory` / `memory_usage_log` - User memory and audit trail
- `mcp_server` - Configured MCP servers
- `paired_device` - Devices allowed onto the LAN listener: a name and the SHA-256 of
  the device's token, never the token. Machine-local — deliberately not part of
  `db-io` export/import or of a data reset
- `chat_source` - a chat's numbered sources (migration 0012): every result of
  its `web_search` calls and every page `web_fetch` read, one row per (chat,
  call, rank) with the text the model was given (`content`: a search result's
  extract, a fetched page whole) and the card fields. Derived from `message`,
  which stays the record: `RunRecorder.persist()` saves a run's sources, and
  `ensureChatSources()` (`src/main/lib/chat/sources.ts`) fills in a chat older
  than the table — or restored by `db-io`, which carries messages only — the
  first time it is read. A rank repeats in a chat numbered before 2026-09-29
  (every run counted from 1); the newest row of a rank is that rank. Serves
  `recall({ source })` and the next run's numbering
- `lcm_summary` - a conversation's own memory: what compaction wrote of its
  older part. The text is `content`, one row per summary, by `chatId` (`kind`
  `leaf` | `condensed`, `depth`, the span it covers in `earliestAt` /
  `latestAt`); `lcm_summary_messages` names the messages a leaf stands for,
  `lcm_summary_parents` the summaries a condensed one was made of, and
  `lcm_context_items` is what the chat's context is made of now, in order (a
  `refId` is a `message.id` or an `lcm_summary.id`). A conversation that never
  outgrew its budget has no summaries: its messages are its memory.
  Philharmonic keeps its own in `philharmonic_session_summary`
- `message.runId` - the run a row belongs to: the id of the run's user message
  (backfilled by migration 0008 by walking each chat in `createdAt` order; a
  row with no user row before it is a run of its own). `runId` is on every
  `ChatMessage` on the wire too
- `message.alternateOf` / `message.attempt` - regenerate groups, meaningful on
  a run's user row only (migration 0011, no backfill): `alternateOf` is the
  group's first run, on every run a Regenerate created; `attempt` is
  `comparing` | `chosen` | `folded` | `hidden` (null for an ordinary run).
  Written only by `src/main/lib/chat/attempts.ts`; on the wire as optional
  fields of `ChatUserMessage` (`GET /api/v1/chat/:id` returns them on every row)
- Philharmonic: `agent`, `agent_memory`, `team`, `task`, `task_execution`, `task_execution_event`, `conversation_plan`, `plan_step`, `pm_round_event` (a PM round's decision trail)

The full chat/message tables and indexes are defined in `src/main/lib/db/schema.ts`.

### AI/LLM Integration

**Multi-Provider Support** (built on `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` 0.85):
pi 0.85 has no global registry: every request is routed by `model.provider`
to a provider registered on a `Models` collection, and the process's one
collection is `getKernelModels()` in `src/main/lib/ai/kernel/models.ts` —
the five built-in providers through pi's factories, plus Ollama as a dynamic
provider `ollama` (empty catalog; `providers/ollama.ts` hand-builds the model
per request with `provider: 'ollama'`). `streamFn` from the same file is what
every `Agent` / `agentLoop` streams through; the API key from Settings is
passed explicitly per request and wins over anything a provider would
resolve from the environment. The `/compat` entrypoint is not used.

Model resolution lives in `src/main/lib/ai/providers/`. The catalog-backed
providers (OpenAI GPT, Azure OpenAI, Anthropic Claude, Google Gemini, xAI Grok)
are one `SPECS` table + a `fromSpec` factory in `index.ts` — a row only supplies
the base-URL setting, its fallback, the default model ids, and the pi-ai
`provider` / `api` strings (xAI is `openai-responses`: pi 0.85's xai provider
serves the Responses API only). Every path resolves through the shared
`resolveModel()` in `resolve-model.ts` (do not duplicate model-resolution
logic); it looks the id up in the collection's catalog and accepts an
optional live-fetched `snapshot` parameter (from `POST /api/v1/settings/models`)
to override it. Per-provider fallback defaults (contextWindow, cost) and
`MODEL_METADATA_FALLBACK` (narrower scope: only what a provider's own list API
omits) live there. Live model lists are fetched per-provider from
`src/main/lib/ai/providers/list-models/`.

**Chat kernel** (`src/main/lib/ai/kernel/`, spec
`docs/superpowers/specs/2026-09-22-chat-kernel-design.md`):

A **run** is one user message through the final answer, with every model
step and tool result in between; `message.runId` (the user message's own id,
on every row of the run) is the unit that context assembly, compaction and
rendering work in.

- `models.ts` — the `Models` collection and `streamFn` (above)
- `run.ts` — `runAgent(input): AsyncIterable<KernelEvent>` wraps pi's `Agent`
  (`convertToLlm` asserts the run invariant, `beforeToolCall` blocks tools
  disabled in settings and holds a call that touches a secret outside Actovia
  for approval) and yields the kernel's own events, each stamped with
  `runId`: `message_update` · `message_end` · `tool_start` · `tool_update` ·
  `tool_end` · `approval_required` / `approval_resolved` (between a paused
  call's `tool_start` and `tool_end`) · `run_end` (always, with the messages
  that completed) · `error` (after `run_end`, when a provider failed). Stop
  aborts the agent; a partial answer is kept, marked `aborted`
- `approval.ts` — the approval gate's matcher (spec
  `docs/superpowers/specs/2026-09-25-secrets-and-exfiltration-hardening-design.md`
  §2.5): `sensitiveTarget(toolName, args, workspaceDir)` → `ask` (the file
  tools on `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker/config.json`,
  `~/.netrc`, `~/.npmrc`, `~/.yarnrc.yml`, `~/.pypirc`, `~/.git-credentials`,
  `~/.vault-token`, `~/.azure`, `~/.config/{gh,gcloud,op}`,
  `~/.password-store`, `~/.pgpass`, `~/.my.cnf`, `~/.s3cfg`, `~/.boto`,
  `~/.gem/credentials`, `~/.m2/settings.xml`, `~/.config/{hub,rclone}`,
  `~/.local/share/keyrings`, the browser profiles (Chrome and its channels,
  Chromium, Brave, Edge, Firefox, Arc, Vivaldi, Opera; `~/Library/Cookies`), a `*credentials*` under `~/.config`,
  `~/.cargo` or `~/.terraform.d`, the keychains, or a `.env*` / `*.pem` /
  `*.key` / `id_*` (and their `.bak` / `.old` / `~` … copies) outside the
  chat workspace — resolved through `~`, the cwd and symlinks (async, 250 ms per path
  and 3 s per call: a path not resolved in time is asked about, a
  network root is never resolved); a `terminal`
  command naming one of those, running `security find-*-password` or a CLI's
  print-token command (`gh auth token`, …), or listing other processes'
  arguments (`ps` with options, `pgrep -a` / `-lf`, `/proc/<pid>/environ`), a
  documented heuristic; a `grep` root outside the workspace whose tree holds
  a secret-named file; a `call_mcp_tool` whose argument strings match any of
  those), `refuse` (`~/.actovia/lock.dat`, `~/.actovia/tls/`, and the raw data
  `~/.actovia/database`, `~/.actovia/backups`, `~/.actovia/analytics` — plaintext
  in a pre-encryption backup or while encryption is unavailable, and a glob
  that can expand into them; a `call_mcp_tool` URL or bare port number at
  Actovia's own API ports — blocked, never asked) or
  null.
  Paths compare case-folded on macOS / Windows and without the
  `/System/Volumes/Data` firmlink prefix; a command's summary leads with what
  triggered it. Philharmonic's loops use the same matcher through
  `philharmonic/sensitive-guard.ts` but refuse instead of asking (no window
  to ask in).
  `pending-approvals.ts` holds each paused call until `allowed` / `denied`
  (`POST /api/v1/chat/approval`), `timed_out` (10 minutes) or `stopped` (the
  run's abort — Stop, or the window's request closing); anything but
  `allowed` gives the model "The user declined access to <summary>." Allow
  once is per call, never remembered. The card's Allow button is disabled
  for its first 600 ms and ignores untrusted (script-dispatched) clicks
- `record.ts` — `RunRecorder`: fed every event, `persist()` from the route's
  `finally` saves the run's rows with its duration, puts them into LCM's
  context items **then and there** (`trackContextMessages()` — needs no model
  or key, skips what is tracked, seeds a chat that has rows and no items; it
  used to be the queued job's work, which a quick follow-up did not wait for
  and which a missing key skipped for good), and enqueues the post-run jobs
  with ids only: `lcm-post-turn` compacts, `memory-consolidate` reads the
  conversation when it runs (no conversation travels through the queue)
- `invariant.ts` — `dropBrokenRuns()`: a provider request starts with a user
  message and every tool result follows its tool call; a violating run is
  dropped and logged, never sent (the 2026-09-21 `unexpected tool_use_id` 400)
- `events.ts` — the `KernelEvent` union; `faux.ts` / `faux-boot.ts` — pi's
  scripted provider for tests (see Testing)

**The chat API's contract is `docs/chat-api.md`** — every endpoint, the SSE events and their order, what the model
is sent of earlier runs, regenerate, sources, pages, approvals, compatibility, the invariants and the tests that hold
them, and the checklist for changing it. Read it before changing the chat route, the kernel, context assembly or
either client's chat code, and keep it true in the same change.

**Chat Flow** (`src/main/lib/server/routes/chat.ts`):

1. Retrieve user settings (model selection, API keys); settle regenerate
   groups (`src/main/lib/chat/attempts.ts`, spec
   `docs/superpowers/specs/2026-09-26-regenerate-compare-design.md`) before
   any context is assembled: a user message with `alternateOf` is a
   Regenerate — its row is saved, it and the group's newest other visible run
   become `comparing`, older attempts `hidden`
   (`recordRegenerate`); an ordinary message first closes an open comparison
   (`settleOpenComparison`: the newest answer that did not fail or stop is
   `chosen`, else the older; the other `folded`). A client-sent `attempt` is
   ignored. **The server owns the conversation** (spec
   `docs/superpowers/specs/2026-10-01-chat-history-and-context-design.md`
   §C1–C2): a send is `{ id, message, protocol: 2, advancedTools, … }` — the
   new question only — and the history is read from the database
   (`chat/history.ts`: `loadChatHistory()`, `rowToChatMessage()`, every field
   kept), never from what a client posts (an older client's `messages` is
   accepted; only its last message is used). The question is stamped with the
   server's clock (every read orders by `createdAt`). With `protocol: 2`,
   `done` is `{ messages: <the run: its question as stored, then its
   answer>, attempts: <every group's stored state> }` and the client merges
   (`mergeRun()` in `packages/shared/src/utils/run-merge.ts`; actovia-ios
   `RunMerge`, same vectors); without it, `done` echoes the whole
   conversation (read from the database) as before
2. Assemble the context (LCM, in whole runs) and bind built-in tools based on
   the `AdvancedTools` selection and `settings.tools.disabledTools`. The
   context leaves out the runs a regenerate group keeps from the model
   (`excludedRuns` in `packages/shared/src/utils/attempts.ts`): `folded` and
   `hidden` attempts and, for a Regenerate, every other run of its group —
   the new answer sees neither the answer it stands beside nor the question
   twice. One filter for both paths: the LCM assembler and compaction start
   from `contextRuns()` (so the fresh tail counts runs the model sees, and a
   folded answer never reaches a summary — the span a summary replaces takes
   its context items with it), and with LCM off the stored history goes
   through `runsForContext()`
3. `for await` over `runAgent()`, mapping each kernel event onto one SSE
   event through `createSseWriter` (`routes/chat-sse.ts`): streaming
   `message_update` snapshots are coalesced to one per
   `STREAM_FLUSH_INTERVAL_MS` (each carries the whole message so far), other
   events flush first so order holds, and writes become no-ops once the
   client has gone. Wire shapes are unchanged; every message carries `runId`.
   A paused call adds `approval_required` (`runId`, `toolCallId`, `toolName`,
   `summary`, `expiresAt`; the summary is the path or command, never
   contents, and is sanitized once at the source — `sanitizeSummary()` in
   `kernel/approval.ts` strips bidi/format controls, shows a line break as
   `⏎` and a tab as `⇥` — then bounded once, centrally, by `capSummary()`:
   `EVENT_SUMMARY_MAX` (8000 chars) for this event, cut from the end so the
   matched trigger survives, with `truncated` / `hiddenChars` set when it
   was; a shorter `MODEL_SUMMARY_MAX` (300) applies only to the separate copy
   the model reads back on decline/refuse (`declinedReason` /
   `refusedReason` / `groupRefusedReason`), never to what the card shows —
   cutting the event summary itself at 300 previously hid a long command's
   dangerous tail from the person approving it (I1 re-review). The desktop
   card renders the event's copy in full, wrapped (`break-all`), never
   CSS-truncated, in a scrolling max-height region, with a "N more
   characters not shown" note when `truncated`; a future actovia-ios client
   mirrors the same rules) and later `approval_resolved` (`outcome`); the
   answer is
   `POST /api/v1/chat/approval` with `runId`, `toolCallId` and a `decision`
   of `allow` or `deny`
   (behind the presence gate; `{ outcome }`, idempotent — the first answer
   stands; `404 APPROVAL_NOT_FOUND` once nothing waits). The renderer keeps
   them in the React Query cache `['approvals', chatId]` (`hooks/use-approvals.ts`,
   written by `stream-manager.ts`) and shows the card at the run's foot
   (`components/chat/run-approvals.tsx`: Allow once / Deny, then the settled
   state), beside the memory lines
4. However the run ends — done, a provider error midway, or Stop (which
   cancels the response stream) — `RunRecorder.persist()` saves the messages
   that completed and enqueues background jobs (LCM compaction, memory
   consolidation) onto the pgmq-backed job queue (`src/main/lib/jobs/`) rather than running
   them inline

**Tool Architecture** (`src/main/lib/ai/calling-tools/`):
Each tool has a description for LLM understanding, a TypeBox parameter schema, and an execute function.

Built-in tools (files in `src/main/lib/ai/calling-tools/`), named in
snake_case on the wire — the names are `TOOL_NAMES` in
`packages/shared/src/constants/tool-names.ts`, the single source of truth for
the tool definitions, the binder, the system prompt, the renderer's dispatch
and the settings registry (migration 0007 rewrote stored rows from the old
camelCase; `toToolName()` maps a pre-rename `disabledTools` key):

`computer_use`, `create_artifact`, `deep_research`, `edit_file`, `find_files`, `grep`, `image_generation`, `lcm_describe`, `lcm_expand`, `lcm_grep`, `list_directory`, `map_itinerary`, `read_file`, `recall`, `search_knowledge_base`, `terminal`, `update_memory`, `weather`, `web_fetch`, `web_search`, `write_file`.

`map_itinerary` enriches places through Google Places from main with
`googleCloud.googleApiKey`. That key is masked by the API like every other
secret; the card (`components/calling-tools/map-itinerary/`) gets it for
Maps JS over IPC (`maps:js-key`, answered for the main window's top frame
only — `hooks/use-maps-key.ts`, `lib/maps-key.ts`), and loads Places photos
through `GET /api/v1/maps/photo?name=places/…/photos/…&maxWidth=<1–4800>`
(`routes/maps.ts`: the name is validated, the key added in main, fetched with
`fetchPublicHttps()` from the fixed Places host, `Cache-Control: private,
max-age=86400`) — the same route actovia-ios uses over the LAN.

`weather` is Open-Meteo (no key: a geocoding call, then seven days with 24
hourly points, WMO codes, all in the place's local time). The card reads
`details` (everything); the model reads the text block, which is
`summarizeForModel()` — now, a line per day, hours at three-hour steps for
today and tomorrow — because the full week is ~18 k characters and a tool
result stays in the context for the rest of the chat. The result type
(`packages/shared/src/types/weather.ts`) has not changed shape since the
wttr.in years, so rows saved then still render: `conditionNameOf()` reads
WMO and WWO codes alike and `weatherClockHours()` reads ISO, "06:52 AM" and
"300". The card (`components/calling-tools/weather/`) is compact in the
transcript — a line of now, the day's temperature curve on the colour tone's
accent, three segmented days — and opens in place on Details to the
headline, the readings and the week as range-bar rows.

`image_generation` saves every image the moment it has it — a GPT image
model's base64 decoded, a DALL·E link fetched at once (it expires in an hour)
through `fetchPublicHttps()` (`src/main/lib/net/safe-fetch.ts`: https only,
no loopback / private / link-local / metadata address, redirects re-checked,
the connection pinned to the vetted address) — as `~/.actovia/media/<chatId>/<uuid>.<png|jpg|webp>` (`src/main/lib/media/
store.ts`; typed by magic bytes; one failed image fails the call and removes
the files it already wrote). `ImageGenerationDetails` (`types/chat.ts`)
carries per image `{ mediaId, chatId?, mimeType, width?, height?,
revisedPrompt? }` and never bytes; the model's text block gets only the count
and revised prompts. `GET /api/v1/media/:chatId/:file` (`routes/media.ts`)
serves the file — no index, the path is the storage layout; both segments
must match what `saveMedia` writes and resolve inside the media dir, else
400 — with `Cache-Control: private, max-age=31536000, immutable`. Deleting a
chat or a Group removes its media dir (best-effort,
logged); "reset all data" removes `~/.actovia/media`; `db-io` export does not
carry media. Rows written before this (`url`: a `data:` URL or an expired
DALL·E link) still render through `imageSrcOf()`'s legacy branch (a `data:` URL only
when it is a raster image, the chat's remote-image rule). The card
(`components/calling-tools/image-generation/`, built on the beui.dev
`image-generation-loading.tsx`) is a block of the turn of its own kind
(`TurnBlock` `image`, keyed by the call's id and placed where the call was
made), not something `MessageCallingTools` draws, so the frame that shows
the dither field while the call runs is the same element the image resolves
in (with its zoom); a call left without a result by Stop shows nothing.
A `create_artifact` call holds its place the same way: while its arguments
stream (pi keeps a partial call's arguments parsed, and every
`message_update` carries them) the block's `draft` — the title and the code
so far — is drawn as `ArtifactDraft` (`calling-tools/artifact/artifact-card.tsx`:
the card's frame and 400 px height, the newest lines of the code at its
foot), and the result swaps the real card in at the same place. Gemini sends
a call's arguments whole, so there the draft stays empty until the end.

**MCP toolbox** (`calling-tools/mcp-toolbox.ts`): MCP servers are not bound
tool by tool (providers cap the tools array — OpenAI at 128 — and one server
can exceed it alone). Two tools stand in for all of them: `list_mcp_tools({
server?, query? })` returns each tool's server, name, description and
parameter schema; `call_mcp_tool({ server, tool, arguments })` forwards the
call and returns the result unchanged; the prompt's `<mcp_servers>` block
carries one line per connected server so the model knows what exists.

**Prompt cache** (spec
`docs/superpowers/specs/2026-10-01-chat-history-and-context-design.md` §A):
providers cache a request by its prefix — tools, then system, then messages —
so nothing in the tools or the system prompt may change between two requests
of a chat unless something real changed. No time in a tool description (the
system prompt has the date, day granularity); the skills index and the MCP
directory are sorted (by slug, by server name); the memory block is per run
(above); the kernel passes the chat id as pi's `sessionId` (OpenAI's
`prompt_cache_key`). Chat Audit's **Prompt cache by run** preset reads each
run's first call (`hit_pct`, `input_cost_units` at Anthropic's 1 / 1.25 /
0.1); before this, the first call of every run read 0 % from cache.

**Tool output ages** (same spec, §B; `ai/context-management/aging.ts`): a
tool's output is for the step that called it, so the runs before this one
carry a **digest** of it — a line per numbered source for a search, a
command and its last ten lines for `terminal`, a path and a size for
`read_file`, the first 1 000 characters for most others — past the age
`TOOL_POLICIES` sets per tool (a run's age: how many runs came after it).
`web_search` / `web_fetch` stay whole through the next run (follow-ups dig
into the same results); everything else is whole only in the run that called
it; `image_generation`, `update_memory` and every failed call are never
digested, and a result under 600 characters is left as it is. A past call's
string arguments over 300 characters (a file's content, an artifact's code)
become a note of their length. Every digest names its way back:
`recall({ source: N })` / `recall({ call: "<id>" })`
(`calling-tools/recall.ts`) returns the stored text byte for byte, no
network — except the weather, whose digest says it is stale and to call
`weather` again. Nothing is deleted, calls are never removed and every result
keeps its call (`dropBrokenRuns` holds after aging), and a digest is a pure
function of the stored row, so a past run is the same bytes on every request
and stays cached; changing a digest is a `DIGEST_VERSION` bump. The chat route
ages only while `recall` is bound (it can be switched off in Built-in Tools —
then the context is sent whole), on both paths (LCM on and off); LCM's leaf
compaction summarises from the digests too (`digestAll()`), so a search dump
is not paid for twice and a summary cites sources by number. A new built-in
needs a `TOOL_POLICIES` row (`satisfies Record<ToolName, ToolPolicy>`).

**System prompt** (`src/main/lib/ai/prompts.ts`, `getSystemPrompt({
mcpDirectory, workspaceDir, skillsIndex })`): the policy is autonomy — use
tools without asking or announcing, chain calls until the task is done, stop
only for a real ambiguity or a `<hard_stops>` item (deleting/overwriting
outside the workspace, `sudo`, system-wide installs, `git push`, anything sent
or paid on the user's behalf). Every built-in is explained by its wire name
(`tests/unit/main/lib/ai/prompts.test.ts` holds that — a new tool must be
added there), grouped research / files & shell / output / memory / computer;
HTML and anything visual goes through `create_artifact`. `<workspace>`,
`<skills>` and `<mcp_servers>` render only when given; citations live under
`<citation_rules>`.

**Chat workspace**: `getChatWorkspaceDir(chatId)` = `~/.actovia/workspace/<chatId>`
(`paths.ts`; not created until used). `terminal(defaultCwd)` and
`findFiles(defaultRoot)` are factories, bound to the workspace when
`bindCallingTools` gets a `chatId` and to the user's home otherwise
(Philharmonic keeps `~/.actovia/groups/<id>` as its own).

**Workspace files, opened from the chat** (`src/main/lib/workspace-files.ts`,
shared contract `packages/shared/src/types/workspace-files.ts`): a write_file /
edit_file call draws a compact file card (`calling-tools/workspace-file/`,
one per file a turn touched — `createBlocks` in `messages.tsx` keeps the first
call's card; write_file's `details.created` says Created / Edited) with Open
(the system's app), Reveal in Finder and Quick look (an in-app read-only
preview: Markdown through `Markdown`, anything else monospaced; past
`WORKSPACE_FILE_MAX_BYTES` (1 MB) or binary it says so and offers Open). An
inline code span in an answer that is an absolute or `~/` path to an existing
file under `~/.actovia/workspace` becomes a link (`components/markdown/workspace-path-code.tsx`:
click opens, right-click is the native Open / Reveal / Quick Look menu); the
lexical rule is `workspacePathCandidate`, then main's cached stat
(`hooks/use-workspace-files.ts`). Every action goes over IPC
(`WORKSPACE_FILE_CHANNELS`, `src/main/lib/workspace-file-actions.ts`, top
frames only) and through `statWorkspaceFile` first: a regular file whose real
path — every symlink resolved — is inside the root, else refused. Open never
runs a file (`opensSafely`: an app, a script, an installer, an executable bit
→ revealed instead). The phone reads one through `GET
/api/v1/workspace/:chatId/file?path=…` (`routes/workspace.ts`; path absolute,
`~/` or relative to that chat's workspace, confined to it; `{ path, name, size,
modifiedAt, kind, content }`; `400 INVALID_PATH`, `403 OUTSIDE_WORKSPACE`,
`404 FILE_NOT_FOUND`, `413 FILE_TOO_LARGE`, `415 FILE_NOT_TEXT`).

### Knowledge Base (LightRAG)

The knowledge base is backed by an **optional, self-hosted LightRAG server** the user runs (Actovia is a client only — see `docs/lightrag-setup.md`). `knowledge_doc` rows are the editable source-of-truth (Settings → Knowledge Base); the `kb-sync` job (`src/main/lib/jobs/handlers.ts`) pushes them into LightRAG via `src/main/lib/knowledge-base/lightrag-client.ts` (delete + re-insert on edit), and `reconcile.ts` on the jobs cron settles each row's `indexStatus` via LightRAG's `track_status`. `resolveKnowledgeBase(settings)` (never throws) gates the `searchKnowledgeBase` tool, bound by `bindCallingTools` for the main chat and every Philharmonic employee loop. Retrieval is context-only (`only_need_context: true`) — Actovia's own model writes the answer. No scoping: one shared KB.

### Deep Research

**Architecture** (`src/main/lib/ai/deep-research/`):

Multi-level recursive research with real-time progress streaming:

1. **Query Generation** (`generate-queries.ts`):
   - AI generates search queries based on topic
   - Configurable breadth (default: 4 queries per level)

2. **Search Execution** (`deep-research.ts`):
   - Executes Brave Search API searches recursively (`braveApiKey`,
     `web-search.ts`)
   - Depth parameter controls recursion levels (default: 2)
   - Processes results and extracts learnings

3. **Result Processing** (`process-search-results.ts`):
   - Extracts key insights from search results
   - Identifies web sources with titles and URLs
   - Determines next research directions

4. **Report Generation** (`final-report.ts`):
   - Compiles all findings into structured Markdown report
   - Includes source citations
   - Stored in database for later retrieval

5. **Progress Streaming** (`src/main/lib/server/routes/deep-research.ts`):
   - SSE connection for real-time updates
   - `jobStatus`: `streaming` → `archived` on success, or `failed` (with an
     `errorMessage`) for any thrown error — search, an LLM call, a dropped
     connection, or the run being stopped — so a job never stays `streaming`
     forever (the desktop card and actovia-ios's 15-minute stall check both
     key off it)
   - Frontend polls for progress messages

### MCP (Model Context Protocol)

**Integration** (`src/main/lib/ai/mcp.ts`):

MCP is live: servers are rows of the `mcp_server` table (Settings →
Integrations → MCP, route `/api/v1/mcp`; secrets masked and encrypted like
the settings registry).

1. **Connection** (`getMcpTools()`, called by the chat route on every request,
   and `getMcpToolsByNames()` for a Philharmonic employee): each active server
   whose settings decrypt is connected over stdio (`command` / `args` /
   `env`), SSE or streamable HTTP (`url` / `headers`) with
   `@modelcontextprotocol/sdk`, and its tools are cached for five minutes. No
   server is connected at startup.
2. **Tool execution**: through the MCP toolbox (`list_mcp_tools` /
   `call_mcp_tool`, see Tool Architecture). `call_mcp_tool` goes through the
   approval gate like the file tools: every string leaf of its `arguments` is
   checked as a path and with the terminal heuristic, and a URL at Actovia's own
   API ports is refused (`kernel/approval.ts`).
3. **stdio args are visible to other programs** while the server runs (`ps`
   shows a process's arguments), so the MCP form warns when an argument holds a
   recognised secret and suggests an environment variable instead; `ps`-style
   commands in `terminal` are asked about.

### Memory & Personalization Layer

**Memory System** (`src/main/lib/ai/memory/manager.ts`):

A durable, topic-consolidated memory of the user. Key functions:
`runMemoryConsolidation()`, `loadRelevantMemories()`, `formatMemoriesForSystem()`,
`runMemoryInstruction()`.

**Memory entries** (one row per topic/person in the `memory` table):

- `section` - `profile` (durable identity / setup / hard constraints / stable
  preferences) | `topic` (an interest, project, recurring subject) | `person`
- `key` - short stable title (e.g. "Classical Music")
- `summary` - one sentence; `details` - `string[]` of bullets

**Memory Operations** (all in `src/main/lib/ai/memory/manager.ts`):

1. **Consolidation** (`runMemoryConsolidation()`) — `memory-consolidate` job
   after each turn when `memory.autoCapture`. One LLM call sees the
   conversation + the existing memory index and returns `create`/`update`/
   `delete` operations. Prefers updating an existing entry (returning its full revised
   summary + details) over inserting a duplicate. The bar for a new subject
   is high (five tests in `CONSOLIDATE_SYSTEM`), but an entry already held is
   kept true: a fact the conversation shows has changed is updated, one that
   no longer holds is deleted, and two entries that are one subject are
   merged (update one, delete the other) — the owner's aim of 2026-09-30, the
   more you talk to Actovia the better it knows you. Nobody watches this job,
   so its `delete` only switches the entry off (`softDeleteMemory`) and
   Settings → Memory can restore it.

2. **Read filter** (`loadRelevantMemories()`) — pre-turn when
   `memory.useInChat`. One LLM call picks the relevant entries; selected
   entries are recorded in `memory_usage_log` (with the run's id and the
   entry's key/section at the time, so a later delete still has a name to
   show) and get `lastUsedAt` bumped. **The block goes with its run, never
   in the system prompt** (`memory/run-memory.ts`, 2026-10-01): each run's
   user message is preceded by a `<user_memory>` block of the entries chosen
   for that run (`loadRunMemoryBlocks()`, from `memory_usage_log`), rendered
   with their _current_ values in a fixed order (section, then key). Chosen
   afresh every message, the block used to change the system prompt on every
   turn, and with it the provider's whole cached prefix; now a past run's
   block is the same bytes on every request, an edited entry changes the
   runs that used it once, and a deleted or switched-off one drops out of
   every run. The assemblers say which message opens which run
   (`AssembledContext.runHeads`; the LCM-off path the same) and the route
   applies `withRunMemory()`; the kernel gets a copy of the prompt with its
   block — the saved row and the `done` echo are the question alone

3. **User correction** (`runMemoryInstruction()`, the same engine Settings →
   Memory's instruction box uses) — one LLM call turns a free-text
   instruction into `create`/`update`/`delete` operations and returns
   `{ applied, changes: MemoryChange[] }` (`MemoryChange`/`MemorySnapshot` in
   `packages/shared/src/types/memory.ts`): `before`/`after` snapshots per
   change, `null` for a create's `before` or a delete's `after`. The
   `update_memory` tool (`calling-tools/update-memory.ts`, bound for a chat
   with a model and key, except in Deep Research or when switched off in
   Built-in Tools) calls it directly and synchronously, with no
   scope — the model corrects, adds or forgets something without asking
   first (the system prompt's autonomy policy), and not only when told: a
   lasting fact the user states about themselves, or a change to one it
   holds, goes in as it is said (never a one-off detail or the task's own
   specifics); what it did is already in the index the post-run
   consolidation reads, which leaves it alone; "no change needed" is a
   normal result, not an error, and draws no UI. `POST /api/v1/memory/undo`
   (body `{ changes }`, `memory/undo.ts`) reverses a run's changes
   newest-first, each only while the entry's current state still equals that
   change's
   `after` (a missing row counts as `after === null`) — an entry edited
   since elsewhere (Settings, another chat) is skipped and reported, never
   overwritten; running the same `changes` twice is a no-op the second time.

**Which memories a run used**: the chat route sends `{ type: 'memories_used',
runId, memories: [{ id, key, section }] }` over SSE before the first frame,
whenever the read filter selected something (Deep Research runs no read
filter — its prompt carries no memories); `GET /api/v1/memory/usage?chatId=`
(`getMemoryUsageByChat()`) replays the same shape per run for a chat reopened
from history, grouped by `runId` (a pre-migration row with a null `runId` is
skipped, not shown). Renderer: `hooks/use-memory.ts` (`useMemories`,
`useRunMemoryUsage`, `useUndoMemoryChanges`) backs
`components/chat/used-memories.tsx` (the "Used N memories · keys" line and its
popover at the run's foot — a deleted entry still shows its logged key,
greyed; the card opens with a line saying what the memories were for, and each entry's "Fix in chat" — beside its title, owner 2026-09-30, after "This is wrong" read as a verdict — prefills the composer through `chatInputFocusAtom`)
and `components/chat/memory-change-strip.tsx` (the run-foot strip for
`update_memory`: running → done, with per-change before/after and Undo;
`lib/run-memory-changes.ts` derives its state from the run's own messages,
never a separate fetch).

### Philharmonic (multi-agent Groups)

Philharmonic runs multi-agent "Groups" (teams of agents collaborating on tasks).

- Main process: `src/main/lib/ai/philharmonic/` (employee loop, execution engine, agent memory/tools, knowledge-base tools)
- Renderer: `src/renderer/components/philharmonic/`
- Route: `/api/v1/philharmonic`
- Each Group gets an isolated workspace under `~/.actovia/groups`
- Scheduled tasks (`task.cronExpression` for recurring, `task.runAt` for
  one-off) run via `src/main/lib/ai/philharmonic/scheduler.ts`
  (per-task `node-cron` jobs + a once-a-minute sweep for one-off tasks);
  managed from the Schedule tab on the Dashboard page
  (`components/philharmonic/schedule/`)
- **Quota-aware dealing** (spec `docs/superpowers/specs/2026-10-16-pm-quota-aware-dealing-design.md`):
  what each CLI reports of the owner's quota — Claude Code's `rate_limit_event` on every turn,
  Codex's `account/rateLimits/read` (free; `refreshQuotas()` in `quota-refresh.ts`, at most once a
  minute, and not again for a minute after a failed or empty read) and its rolling updates (merged:
  they keep the stored verdict unless they report a reached limit) — becomes a `quota` agent event and one `CliQuota` per CLI in
  `src/main/lib/agents/quota.ts` (`~/.actovia/agent-quota.json`; a data reset removes it; `toMs` lives
  in the pure `agents/epoch.ts`). The PM's roster names each CLI employee's model and its CLI's quota,
  and its system message carries the active plan (`Active plan:`, a line per step: status, id, title,
  assignee, note); it deals by difficulty, downgrades or calls `waitForQuota({ stepId, employeeId,
  reason })` — which refuses a step outside the active plan and schedules or moves a one-off task
  (`input.kind: 'quota-wait'`) at the reset + 2 min before it parks the step — and applies those
  rules flexibly. Plan-first rule 1 has an exception: a round that continues the active plan (a
  [Scheduled] quota-reset round, or the owner answering about it) does not call `createPlan`. Windows
  are named for people by `quotaWindowLabel()` (5-hour / week / "<model> only: week"; a Codex window
  by its `durationMins`). The PM waits only on LIMIT REACHED; at 90 % or a warning it downgrades or
  runs the step. A step that leaves `pending` (`updatePlanStep`, or delegated) cancels its
  quota-wait task. The window a CLI rejected on is marked `rejected: true`, and a full reading keeps
  a model's own window it does not mention until that window resets — Claude Code reports only the
  running model's windows, so a sonnet reading never erases opus's rejection.
  `delegateTask` refuses only an employee its CLI has rejected without overage
  (`blockedUntil(q, model, now)`: a live `rejected` window that applies to the model, else the
  record's `rejected` state; windows whose reset has passed are ignored; a rejection with no
  window detail blocks for an hour after it was reported); a high or stale reading never blocks. A
  window past its reset reads "reset at … (not re-read since)" to the PM and is never red in the
  members panel, which shows the line (`GET /api/v1/agents/quota`, `hooks/use-agent-quota.ts`,
  `quotaParts(q, now)` in `lib/agent-quota.ts`)
- **Decision trail** (spec `docs/superpowers/specs/2026-10-17-pm-decision-trail-design.md`): every PM
  round records, through `ai/philharmonic/round-recorder.ts`, its trigger, the employee reports it
  read (ids and names), thinking, text, each tool call with its arguments and result, usage and any
  error, masked (`maskLogText`), in `pm_round_event` (migration `0018_pm_round_event`, storage
  `db/pm-round-queries.ts`). The recorder never throws into a round: a capture or append failure is
  logged, and a cycle in a call's arguments is stored as `[circular]`. The PM's message — and its
  error or interrupted system row — carries `roundId` and a `{ kind: 'decision', delegations, waits }`
  part; the collapsed "Decision process" line takes its counts from that part, so nothing is fetched
  until it is opened. `GET /api/v1/philharmonic/conversations/:id/rounds/:roundId` serves a round;
  `components/philharmonic/chat/decision-process.tsx` draws it under the message (pure model
  `lib/pm-round.ts`, hook `hooks/use-pm-round.ts`, service `services/philharmonic-rounds.ts`). A
  report whose author is gone shows the current agent's name, or a translated "former employee". The
  PM's context labels each employee report with its author (`ai/philharmonic/lcm/labels.ts`). Chat
  Audit reads it as `group_messages` / `pm_round_events` and the `pmDecisions` preset

### App Lock

A local PIN lock protects the app and gates all API access.

- Main process: `src/main/lib/lock/` (`lock-manager` state machine, `pin-store` using scrypt + Electron `safeStorage`, `idle-watcher`, `lock-config`, IPC handlers)
- The `lockGate` middleware rejects every `/api/*` request with `423` while locked (`/api/v1/lock/unlock` excepted, below)
- Unlock is IPC (the lock screen: PIN, or the Mac's Touch ID) or `POST
  /api/v1/lock/unlock` (`routes/lock.ts`), the one API route mounted ahead of
  `lockGate`. It reads no PIN: a paired device's own biometric (Face ID on
  the phone) stands in for it, the way Touch ID does locally — the trust is
  in holding a device token. `authGate` still runs first, so on the LAN only
  a paired device reaches it; on loopback any local process can, which the
  threat model already trusts (it can read `~/.actovia`)
- The encrypted PIN secret lives at `~/.actovia/lock.dat`
- Renderer: `src/renderer/components/lock/`

### LCM (lossless context management)

Compacts long conversations without losing information, surfacing summaries the agent can expand or grep.

- Main process: `src/main/lib/ai/context-management/` (compaction, context assembler, token counter, status bus)
- Route: `/api/v1/lcm`
- Related built-in tools: `lcm_describe`, `lcm_expand`, `lcm_grep`; and `recall`,
  which reads back the full form of an aged tool output (see "Tool output
  ages"), and whose digests leaf compaction summarises from
- **The recall tools read a conversation: this one, or one the user names.**
  `lcm_grep(chatId)` and `lcm_expand(model, apiKey, chatId)` are bound to the
  chat (`bindCallingTools`) and read it when the model passes no `chatId` —
  the model is not handed its chat's id and does not need it (until
  2026-09-29 `chatId` was a required argument nothing supplied; the id does
  show in the workspace path). A `chatId`
  the model does pass is another conversation's, handed over by the user: the
  sidebar's menu of a chat has **Copy conversation ID**
  (`layouts/chat-layout/nav-histories.tsx`), and the system prompt says what
  to do with one — `lcm_describe` with the id first, then `lcm_grep` /
  `lcm_expand` with `chatId`. `lcm_describe` takes a summary id or a
  conversation id; for the latter `describeConversation()`
  (`context-management/conversation-overview.ts`) returns the title, the
  summaries in the chat's context and the text of what was said and not
  compacted — all of it for a conversation that never was — bounded
  (`OVERVIEW_LIMITS`), newest kept, with the ids of what did not fit. It is
  read-only (another chat's context tracking is never bootstrapped from a
  read), leaves out tool results and the runs a regenerate group keeps out of
  sight, and `calling-tools/lcm-conversation.ts` answers — never throws — for
  an id that is not a uuid or names no chat. This is how one conversation's
  memory reaches another without becoming long-term memory
- **The run is the atom.** `assembleContext(chatId, budget, freshTailRuns)`
  groups context items by `message.runId` (`groupItemsIntoRuns`): the fresh
  tail is the most recent N runs, whole; back-fill adds whole older runs,
  newest first, and stops at the first that does not fit; leaf compaction
  chunks on run boundaries. So a request starts with a user message and every
  tool result follows its tool call — a 40-seed property test on a real PGlite
  (`context-assembler.property.test.ts`) holds it. `memory.freshTailSize`
  counts runs (default 6, range 2–24; `freshTailRuns()` clamps a value saved
  when it counted messages). Philharmonic's own LCM keeps a fixed 16-message
  tail

### Sub-apps

Separate renderer entry points under `src/renderer/sub-apps/`: `searchbar`, `quick-chat`, `artifacts`.
Their windows live in `src/main/lib/window.ts`.

- **`searchbar` (the Cmd+F find bar) must stay a view of its own — do not turn
  it into a portal in the main page.** `webContents.findInPage` searches the
  page it runs on, including form-control values, so a bar rendered there finds
  its own input (and its own "1/3" counter) and Enter cycles onto itself
  (measured in a standalone Electron probe, 2026-09-23). It is a
  `WebContentsView` docked under the header, created on first Cmd+F and then
  only shown/hidden (`openSearchBar()` / `closeSearchBar()`), so re-opening is
  instant and no renderer process is left behind per open. Three things are
  load-bearing: `setBackgroundColor('#00000000')` (without it the view paints an
  opaque backdrop — a dark rectangle behind the bar in dark mode), the
  `resize` / `found-in-page` listeners registered once in `createWindow()`, and
  `closeSearchBar()` handing key focus back to the main page. The bar also
  closes itself on a route change (`did-navigate-in-page`, since routes are
  hashes): the page it was searching is gone.
- **`quick-chat`** is a real transparent `BrowserWindow` because the tray summons
  it whether or not the main window exists. It opens on the display under the
  cursor, and the window is deliberately larger than the pill (transparent
  margin) so the pill's own shadow is not clipped.
  What is typed there is handed to the main window: main's
  `transfer-quick-chat` raises it and sends `quick-chat-input`, and
  `installQuickChatBridge()` (`src/renderer/lib/quick-chat-bridge.ts`,
  installed once at boot like the menu bridge — not from a layout, so it
  works from Settings and Philharmonic too) leaves the text for the next new
  chat and navigates to `/`. `Home` gives every visit — every navigation to
  `/`, from `/` itself too — a chat id and a fresh `<Chat>` of its own
  (keyed by the location key), and `Chat` sends the text it finds on mount.
  Before 2026-09-29 `Home` made a new id on every render and never
  remounted `<Chat>`, so with the window already on the landing page the
  text waited in localStorage until a reload.
- Sub-app roots are not `#root`, so `h-full` collapses there — centre with
  `h-screen`.
- **Each sub-app entry builds its own provider tree.** `quick-chat` and
  `searchbar` wrap theirs in a `QueryClientProvider` of their own
  (`createAppQueryClient()`): `I18nProvider` follows `settings.language`
  through `useSettings()`, a React Query hook, and without a client the window
  is blank. The `artifacts` sandbox has no `I18nProvider` and no query client
  at all — nothing there is translated, and its CSP allows no network.
  `tests/unit/renderer/sub-apps/entries.test.ts` mounts the three real entry
  files.

### Frontend Structure

**Stack**:

- React 19 with TypeScript
- React Router v7 for navigation
- Jotai for global state management (atoms in `src/renderer/stores/`)
- @tanstack/react-query for server state fetching
- Tailwind CSS + Radix UI components
- @tiptap for rich text editing (Immersive Editor)
- Monaco Editor for code display
- Three.js for 3D visualizations

**Key Directories**:

- `components/` - Reusable UI components (including shadcn/ui)
- `services/` - API call wrappers (chat, RAG, settings, etc.)
- `stores/` - Jotai atoms for global state
- `hooks/` - Custom React hooks
- `layouts/` - Page layouts (workspace, chat)
- `routes/` - Route definitions
- `containers/` - Page-level components
- `sub-apps/` - Special entry points (searchbar, quick-chat)

**API Communication**:

- All API calls via `fetcher()` utility to `http://localhost:60223/api/*`
- Streaming responses are consumed from the server's `runAgent()`-driven SSE stream (`lib/stream-manager.ts`)
- @tanstack/react-query for caching and revalidation (see "Server state (React Query)" below)

### Server state (React Query)

- `services/*.ts` are pure `fetcher()` wrappers (no React/sileo/i18n); each domain has
  `hooks/use-<domain>.ts` with a query-key factory plus `useQuery`/`useMutation` — components never
  import `useQuery`/`useMutation`/`useQueryClient` directly.
- The one client is `lib/query-client.ts` (`createAppQueryClient()`): a failed query is reported
  (`reportRendererError`) never toasted; a failed mutation is reported, then toasted once, globally,
  titled from `meta.errorTitle` (falling back to a localized generic message) unless `meta.silent` is
  set, which skips the toast but not the report (`meta.inlineCodes` does the same for an `HttpError`
  whose code the caller shows in place — the MCP form's `SECRET_REENTRY_REQUIRED`) — hooks never
  catch-and-toast themselves; success
  toasts live in the hook's own `onSuccess`. The one deliberate exception is `use-settings.ts`: its
  save must land in the cache without a revalidating GET (a GET's freshly-bumped `updatedAt` would
  echo through `useForm({ values: settings })` and loop the autosave), so it `try`/`catch`es the write
  itself and toasts both outcomes directly, instead of going through a `useMutation`.
- Defaults suit a LOCAL API: `retry: 1` at 500 ms, no focus/reconnect refetch, `networkMode:
  'always'`; `refetchOnWindowFocus: true` is opted in per query whose data an outside writer
  (actovia-ios, the Actovia CLI, the phone) can change: chat history,
  devices, installed skills, the three logs reads, the Discover feed, and the Ollama probe
  (`use-chat-history.ts`, `use-devices.ts`, `use-installed-skills.ts`,
  `use-logs.ts`, `use-discover-feed.ts`, `use-ollama-status.ts`, and the secrets status —
  `use-secrets-status.ts`, its own `['secrets-status']` root, never under `['settings']`) — plus the memory list
  (`use-memory.ts`'s `useMemories()`), which the chat's own `update_memory` tool and background
  consolidation can both write with the Memory page not open. The remote skills.sh relay uses
  `lib/relay-retry.ts`'s `RELAY_RETRY` instead. `installWindowFocusListener()` (`main.tsx`, at boot)
  follows the window's own focus/blur, not just `visibilitychange`, and feeds every one of those
  opted-in queries.
- The chat list and a chat's messages are what a run changes without a mutation. The list is
  refreshed by the stream manager (`lib/stream-manager.ts`: on the `title` event and however a run
  ends) rather than by the chat page, which is gone when the user has opened another chat. A chat's
  newest page seeds `<Chat>` once, on mount, so `ChatDetail` waits for the fetch of this visit
  (`useChatPage().isFresh`) instead of seeding it with the copy an earlier visit cached —
  without the runs sent since, with a regenerate group's state as it was — and shows
  `chat/transcript-skeleton.tsx` meanwhile (after 300 ms, `hooks/use-delayed.ts`). Older pages are
  `hooks/use-older-pages.ts` (`useOlderPages`: a `useMutation` per page, put in front of the
  messages with `setMessages`; `olderSources` / `olderQuestions` are what the page says of the runs
  not loaded; `historyIds` keeps them from animating in as fresh; a `truncated` row is replaced by
  `GET …/messages/:messageId`), and `hooks/use-older-history-scroll.ts` is the transcript's side:
  a scroll within 600 px of the top — or a first page shorter than the window — loads the page
  before, and the scroll position moves down by what was added (the container is
  `overflow-anchor: none`). `buildCitationSources(segments, cache, olderSources)` starts every
  turn's sources from the unloaded runs', and `ChatToc` lists `older` questions first; picking one
  loads back `through` it, then scrolls there.
- Hook tests: some wrap `renderWithQueryClient` from `tests/unit/helpers/query-test-utils.ts` for the
  mount scaffolding (isolated client, retries off); others still roll their own — not yet a single
  convention across every hook test. `@tanstack/react-query-devtools` is dev-only in `main.tsx`.

### Path Aliases

**Main Process** (`tsconfig.node.json`): no aliases — relative imports, plus the
`@actovia/shared/*` workspace package. Main-process code imports DB row types
straight from `src/main/lib/db/schema.ts` (the shared package must not import the app).

**Renderer Process** (`tsconfig.web.json`):

- `@` → `src/renderer`
- `@actovia/shared/*` → the `packages/shared` workspace package (subpath exports, see its `package.json`)
- DB row types come from `@/types/db` (a renderer-side passthrough of `src/main/lib/db/schema.ts`)

**Shared Code** (`packages/shared/src/`, imported as `@actovia/shared/...`):

- `types/` - Shared TypeScript types
- `constants/` - Constants used across processes
- `utils/` - Utility functions
- `schemas/` - Zod schemas
- `errors/` - Custom error classes

## Important Implementation Notes

### When Working with AI Providers

- Providers resolve a `Model` (from `@earendil-works/pi-ai`) via the shared `resolveModel()` in `src/main/lib/ai/providers/resolve-model.ts` — do NOT duplicate model resolution logic
- `resolveModel()` accepts an optional `snapshot` parameter (live-fetched from `POST /api/v1/settings/models`) to override the pi-ai registry
- Per-provider fallback defaults (contextWindow, cost) and `MODEL_METADATA_FALLBACK` are centralized in `resolve-model.ts`
- Model lists are now live-fetched per provider from Settings via `src/main/lib/ai/providers/list-models/`
- Model names/API keys are retrieved from settings (never hardcode)
- One-shot completions go through `completeSimple` from `src/main/lib/ai/utils/complete.ts` (see Shared Utilities) — pi-ai does not throw on a failed request
- `@earendil-works/pi-ai` / `pi-agent-core` 0.85: there is no global `stream`/`complete`/`getModel` — everything goes through `getKernelModels()` (`src/main/lib/ai/kernel/models.ts`); `completeSimple` still comes from `src/main/lib/ai/utils/complete.ts`; the `/compat` entrypoint is not used. `ThinkingLevel` has `max` and no `off` (the app's `off` means no reasoning option). History: `docs/pi-ai-review.md`

### When Working with Database

- Always use Drizzle ORM queries (`src/main/lib/db/queries.ts`)
- Schema changes require running `bun run db:generate` to create migrations
- Vector searches use `cosineDistance()` from pgvector
- All timestamps use `timestamp('created_at').notNull().defaultNow()`

### When Working with Tools

- Tool definitions go in `src/main/lib/ai/calling-tools/`; the `name` is a
  `TOOL_NAMES` entry (`packages/shared/src/constants/tool-names.ts`), added
  there first — snake_case, and never renamed once rows carry it
- Tools are bound conditionally based on the `AdvancedTools` selection and
  `settings.tools.disabledTools`; a call to a disabled tool is also blocked in
  the kernel's `beforeToolCall`
- Parameters are TypeBox schemas (`Type` from `@earendil-works/pi-ai`)
- Enum parameters use pi-ai's `StringEnum([...] as const)`, never
  `Type.Union([Type.Literal(...)])` — that emits `anyOf`/`const`, which
  Google's function-calling schema rejects
- Tool descriptions are critical for LLM understanding
- Return structured data that the LLM can interpret

### When Working with Chat

- The chat route drives `runAgent()` (`src/main/lib/ai/kernel/run.ts`); pi's
  `Agent` handles multi-step tool calling, parallel tools and cancellation
- Persistence is `RunRecorder.persist()` from the route's `finally` — however
  the run ended, the steps that completed are saved with the run's `runId`
- Message content is stored as JSONB in `message.content`; `message.runId`
  groups a run's rows (index `message_chat_run_idx`)

### When Working with the Chat Render Path

A reply streams at up to ~25 frames a second and every frame gives `<Chat>` a
new `messages` array, so anything that re-renders per frame is paid for
hundreds of times per answer. What keeps it cheap — all of it guarded by
`tests/unit/renderer/components/messages-rerender.test.ts`,
`tests/unit/renderer/hooks/use-chat.test.ts` and
`tests/unit/renderer/lib/markdown-blocks.test.ts`:

- **`useChat` hands out stable callbacks.** `sendMessage`, `regenerate`, `stop`
  and `setMessages` must not depend on `messages` — they read the live list
  from a ref that `setMessages` keeps in sync, and `prepareBody` / the `on*`
  callbacks from refs synced in an effect. `regenerate` is a prop of every
  assistant turn: when it changed per frame, the whole transcript re-rendered
  per frame, straight through its `memo`.
- **One run, one assistant message — in the run's own order.**
  `groupIntoSegments` groups by `runId` (segment key `run:<runId>`);
  `buildAssistantTurn` lays the answer out as `blocks` (`TurnBlock`): the
  model's text and the cards of the tools it called, each card where its
  call was made — text, a card, text — under one `ThinkingTimeline`, with
  one action bar. Text joins the text before it unless a card stands
  between them, so a run that called nothing with a card (a web search, a
  file read — `hasToolCard()` in `calling-tools/tool-cards.ts`) is one
  `Markdown`, as it always was; a tool that failed is a line of the
  timeline, not a card. Text in a message whose calls only fetch
  something (web search, web fetch, file reads, grep, the lcm tools — the
  built-ins `keepsTextInAnswer()` is false for) is the model at work
  ("I'll pull the photos."): it is a `narration` step of the timeline,
  drawn as a plain row, and not part of `blocks` or `body`; beside a tool
  with a card, `image_generation` or `update_memory` it stays in the
  answer, since that is often the answer itself (owner, 2026-09-30;
  actovia-ios: `RunGrouper.narratingTools`, `ThinkingStep.isNarration`). Blocks are only ever added at the end and the last
  text grows in place, which is what lets the text above a card sit out the
  frames of the text streaming below it. `body` — every text block joined —
  is what Copy, read-aloud and the panel's Sources section take as the answer. A
  provider error is pinned to the run it ended (`useChat().runError`) and
  shown at that message's foot.
- **The chat header** (`components/chat/header/`, spec
  `docs/superpowers/specs/2026-10-08-chat-header-redesign-design.md`): the
  browser-like tab strip is gone (2026-10-08). `history-arrows.tsx` draws `←`
  `→` beside the sidebar toggle — in the sidebar's top row while it is open,
  in the 44 px header (a fading shadow under it, no rule) once it is away —
  over the app's own page history — a pure stack in `lib/route-history.ts`
  (`historyAtom`, capped at 50, a deleted chat's entries removed), recorded
  once by `useRouteHistoryRecorder` in `layouts/chat-layout/index.tsx`, walked
  by the arrows and by `Mod+[` / `Mod+]` (`Mod+W` closes the chat on screen:
  home, nothing deleted); on a chat page the title (the history list's, live)
  with a dot while replying, `model-chip.tsx` (the provider and model from
  `providerConfig`, a pick from the cached `modelCatalog` saved with its
  snapshot) and `chat-menu.tsx` (rename, favourite, export as Markdown / PDF
  through `lib/chat-export.ts` and the `md-to-pdf` route's print sheet
  `main/lib/pdf/print-document.ts`, delete); and the toggle of
  `components/chat/panel/chat-panel.tsx` — files, tools and sources derived
  from the open chat's messages (`chatMessagesAtom`, set by `<Chat>` when a
  message is added or the stream settles) by `lib/chat-panel-items.ts`, each
  row scrolling to its run (`lib/scroll-to-run.ts`, the rail's rule) and an
  artifact row opening its card (`revealArtifactAtom`). It replaced the
  Sources panel: a message's Sources button opens the panel on that run.
- **A regenerate group is one segment** (`type: 'compare'`, key
  `group:<firstRunId>`; spec
  `docs/superpowers/specs/2026-09-26-regenerate-compare-design.md`): the
  question once and the answers on show — two while they are compared, the
  chosen one after, with the folded one behind "1 other version" (that
  link is hidden for now, `SHOWS_OTHER_VERSION` in `compare-turns.tsx` and
  `TurnFoot.showsOtherVersions` on iOS — owner, 2026-09-30; the dialog and
  the choose route still work); `hidden`
  attempts are drawn nowhere. `components/chat/compare-turns.tsx` draws it
  with an `AssistantTurnSegment` (`chat/assistant-turn-segment.tsx`) per
  answer: side by side where the group is at least 880 px wide — it takes
  the chat's width then, not the reading column's (`COMPARE_FRAME`, `cqw`
  of the scroll area) — and behind shadcn `Tabs` below that; which one is
  measured (`hooks/use-min-width.ts`), since it changes what is mounted.
  The states are the server's: `useChat().regenerate` sends the last
  question with `alternateOf` and applies the same rules locally until
  `done` answers (`attemptsAfterRegenerate`, and `attemptsAfterSettling`
  for an ordinary send mid-comparison), and `useChooseAttempt`
  (`hooks/use-attempts.ts`) applies a choice on the click, takes the stored
  states from `POST /api/v1/chat/:chatId/choose` and puts the old ones back
  on a refusal. `CompareTurns` is memoized on the segment and on what it
  reads from the sources map, so a settled group sits out the frames of a
  run streaming below it; each answer of a group cites what came before the
  group and its own sources, never the other's.
- **Unchanged segments keep their identity.** `groupIntoSegments` and
  `buildCitationSources` (`messages.tsx`) take a cache and return the same
  segment objects / source arrays for turns a frame did not touch.
  `AssistantTurnSegment` and `Markdown` are memoized on exactly those
  identities — never build a fresh array or object per render for a prop of
  either.
- **Markdown renders block by block while it streams.** `useMarkdownBlocks`
  splits a changing document into top-level blocks
  (`lib/markdown-blocks.ts`, same remark config as the renderer via
  `lib/markdown-plugins.ts`), each a memoized `MarkdownBlock`, so a frame
  re-parses the last block or two instead of the whole answer. Text that never
  changes (history) is rendered whole. A plugin added to the renderer must be
  added to `markdown-plugins.ts`, not to `markdown.tsx` — that file also holds
  the two "prose is not markup" settings: `singleDollarTextMath: false`
  (`$200 - $300` is money) and GFM's `singleTilde: false` (`19~32°C` is a
  range; only `~~` strikes through) — and `remarkHtmlBreaks`
  (`lib/remark-html-breaks.ts`): raw HTML is shown as the text it is, except
  `<br>`, which models write and which becomes the line break it asks for
  (on a line of its own it leaves nothing). The last block is
  passed through `healStreamingTail` (`remend` closes an open `**`, `*`,
  `~~`, `` ` `` or `$$` and neutralises a half-typed link; a half-streamed
  `【N-source】` marker is dropped) so nothing flashes as literal markup. The
  `【N-source】` citation chips live in `markdown-citations.tsx`. The
  markers are made nodes of the syntax tree by `remarkCitations`
  (`lib/remark-citations.ts`, in `markdown-plugins.ts`), so a marker is a
  citation wherever the model wrote it — bold, a heading, a link's text, a
  table cell — and stays text only in code; `citationComponents` draws the
  node, looking its numbers up at render from `WebSearchRankMapContext`
  (never through `components`). One chip per place cited (`splitMarkers()`
  in `lib/citation-chips.ts` — a marker naming several sources, or markers
  side by side, are one chip, "Reuters +2", whose hover card shows one
  source at a time under a pager, ← → and "2/3"), drawn as small print so
  the sources
  do not outweigh the sentence — 9px muted text, an 11px round icon, a faint
  pill 16px high raised 2px to the middle of the line (owner's call
  2026-09-29; actovia-ios draws the same chip). The punctuation that closes
  the sentence stays on the chip's line (`tail`): a chip is a box, and no
  line starts with "。". (A 2026-09-22
  spike compared streamdown, markdown-to-jsx and md4x: the splitter already
  parses in ~1 ms a frame, the same as streamdown's own; markdown-to-jsx has
  no math; md4x emits HTML, not a React tree. streamdown was tried behind a
  switch and dropped — its styling did not drop in over ours.)
- **A remote image loads on tap, not by itself.** The `img` override
  (`remote-image.tsx`'s `RemoteImage`) auto-loads only a `data:` URL, the
  app's own media route, or an `https:` image URL the run's own
  `webSearchResults` carried, exactly (`allowedImageUrls()`: thumbnails,
  favicons, image results — never a result's host, since the injecting page
  is itself a result; threaded through its own context, the same reason
  `WebSearchRankMapContext` exists, so streaming results in never invalidates
  the memoized `components` map); anything else — including `http:` —
  shows a placeholder until tapped. "Loaded" is a module-level
  `Set` keyed by `src`, not React state, so the same URL stays loaded across
  a remount. Shared by every `<Markdown>` caller (chat, Philharmonic, deep
  research, skill READMEs). See docs/security-hardening.md, "Remote images in
  chat" — the CSP stays `img-src *`, so the gate lives here, not there.
- **A render failure stays inside its piece.** Every tool card and every
  answer body is wrapped in `ErrorBoundary` (`card-error-boundary.tsx`): a
  card reading a field its result did not carry shows `RenderFailed` in its
  place (a quiet notice, `border-border/50 bg-background/70` — never the
  tool-failure box's destructive red, since it's our bug, not the tool's), a
  body that will not parse falls back to its plain text, and the error goes
  to the main-process log (`reportRendererError`, `POST /api/v1/logs`) — it
  used to take the whole chat page down to the route's "Something went
  wrong", which also reports now. React boundaries only see errors thrown
  during render, so `installGlobalErrorReporting()` (same file) catches what
  they can't — an event handler, a timer, an unawaited promise — via
  `window.onerror` / `unhandledrejection`; called once at boot in `main.tsx`
  and the searchbar/quick-chat sub-apps, never the artifact sandbox (a
  distinct origin whose CSP allows no network at all — the call would just
  be dead weight there).
- **Asking about selected text** (2026-09-29): text selected inside an
  element marked `data-askable` (an answer's section, a user bubble) gets an
  "Ask Actovia" button (`chat/selection-ask.tsx`, mounted once per chat, it
  listens to the document and holds no messages). The selection goes to
  `chatQuoteAtom` (keyed by chat), is shown over the composer, and is sent
  as plain markdown — `composeQuoted()` in
  `packages/shared/src/utils/quoted-text.ts`: `> ` lines, a blank line, the
  question — so no message shape changes and every provider reads it;
  `chat/user-bubble.tsx` draws it back as a quote via `splitQuoted()`.
  actovia-ios implements the same three functions to the same vectors.
- **Questions from the phone's Health workspace** arrive opening with a
  fenced `actovia-health` block of JSON (the day's snapshot, or a detail
  page's week), then the question. `splitHealth()`
  (`packages/shared/src/utils/health-context.ts`, actovia-ios's
  `HealthContext.split`) takes it off before `splitQuoted()`; the bubble
  draws it as chips (`chat/health/health-context-card.tsx`, rules in
  `chat/health/health-context.ts`) that open into a labelled list. Display only —
  the message sent to the model is unchanged.
- **Memoized leaves take only what they render.** The composer
  (`multimodel-input.tsx`) and `ChatToc` are `memo`'d; don't pass them
  `messages` or anything else that changes per frame unless they show it
  (`ChatToc` compares user messages only).
- **The memory foot subscribes to its own run only.** `UsedMemories` and
  `MemoryChangeStrip` (`chat/used-memories.tsx`, `chat/memory-change-strip.tsx`)
  render under `AssistantTurnSegment`, after the body. `MemoryChangeStrip` is
  memoized on the turn's `messages` array — unchanged for a settled run, per
  the identity guarantee above — and `UsedMemories` reads only its own
  `runId`'s slice of the chat's usage record (`useRunMemoryUsage`'s `select`);
  another run streaming touches neither.

### When Working with Frontend

- Use Jotai atoms for global state (avoid prop drilling)
- **Type scale** (globals.css, set by the 14px body): `text-2xs` 11 (the
  floor — badges, counters, uppercase labels) · `text-xs` 12 (captions,
  meta) · `text-ui` 13 (sidebar rows, dense UI) · `text-sm` 14 (body,
  controls) · `text-base`+ for titles. No `text-[Npx]`; the only sizes under
  11 are the citation chip and a map pin's numeral. `cn()` knows `2xs` / `ui`
  as sizes (`lib/utils.ts`) — tailwind-merge would otherwise drop `text-ui`
  beside a text colour
- React Query hooks (`hooks/use-<domain>.ts`) for server data fetching with automatic revalidation
- Always use path alias `@` for renderer imports
- Tailwind + Radix UI for consistent styling
- Keyboard shortcuts go through TanStack Hotkeys (`@tanstack/react-hotkeys`,
  pre-1.0 — pinned exact): `useHotkeys` in `hooks/use-keyboard-shortcuts.ts`
  for the app shortcuts, `useHotkey` for a component's own Escape/arrows. Three
  things the library defaults differently from a hand-written `keydown`
  listener, which every call site here sets on purpose: `stopPropagation`
  (defaults true — set false so `use-lock.ts`'s window-level idle tracker still
  sees the key), `preventDefault` (true — false for Escape/arrows), and
  `ignoreInputs` (false for Ctrl/Meta combos and Escape, true otherwise —
  `Enter` inside an input needs `ignoreInputs: false`). A key that several
  mounted components register (Escape) needs `conflictBehavior: 'allow'`, or
  every duplicate `console.warn`s — disabled registrations included. A key that
  commits an IME composition arrives with `event.isComposing`: guard it.
- **Images load through `LazyLoadImage`** (`components/markdown/lazy-load-image.tsx`,
  the owner's rule of 2026-09-30): a skeleton while it loads, a fade in, an
  icon — or the caller's `fallback` — when it fails; never a bare `<img>` for
  anything fetched from the network. Props: `imgClassName` for the image's
  own fit (`object-contain` for a whole picture, as the search lightbox;
  `object-cover`, the default, for a tile), `referrerPolicy` for hosts that
  refuse an app's Referer (Google avatars, news sites), `loadingClassName`
  for room while a picture of no set size loads (a Markdown image). Used by
  the search gallery and lightbox, the video cards, the citation cards, the
  Discover feed, the map's pins, photos and review avatars, and
  `RemoteImage` for a network Markdown image. Drawn directly, on purpose:
  tiny glyphs (`SourceFavicon`, `<Flag>`, favicon dots), images already here
  (`data:` attachments, avatars, computer-use frames, bundled logos), and
  the image-generation card, whose dither field is its own loading state and
  whose `Zoom` needs the `<img>` itself
- **The window never scrolls, a page's region does.** The main window's
  `<html class="app-shell">` and its body are `overflow: hidden`
  (`globals.css`; not the artifact sandbox, whose pages scroll), and a
  scroll region is `relative`, so an absolutely positioned element inside it
  (an `sr-only` label) is contained by it. Before 2026-09-30 a
  `SecretInput`'s `sr-only` span on a long Settings page, with no positioned
  ancestor, grew the document, and the whole window — sidebar and traffic
  lights included — scrolled up
- Toast notifications via `sileo` (mounted once as `<AppToaster />` per
  layout — chat/settings/philharmonic; its fill is the `--foreground` token
  read from the document, so it follows the colour tone); `sonner`'s
  `Toaster` is a leftover shadcn primitive (`components/ui/sonner.tsx`) that
  is never mounted, so `sonner`'s `toast()` calls render nothing — use
  `sileo` instead

### Motion (read before animating anything)

The bar is Emil Kowalski's design-engineering philosophy (the
`emil-design-eng` / `animate` / `review-animations` skills); the 2026-09-23
audit that applied it is in the commit history (`style(motion): …`).

- **Tokens.** `globals.css` `@theme` redefines the `ease-*` utilities:
  `ease-out` = `cubic-bezier(0.23,1,0.32,1)` (everything entering or
  leaving), `ease-in-out` = `cubic-bezier(0.77,0,0.175,1)` (on-screen
  movement), `ease-drawer` = `cubic-bezier(0.32,0.72,0,1)` (a drawer, the
  side sheet). Never hand-type a curve, never `ease-in` on UI, never
  `ease-linear` except constant motion. Durations: press 100–160, tooltip
  125–200, popover 150–250, modal 200 in / 150 out, nothing on UI over 300.
- **Entrances** are the class strings in `src/renderer/lib/motion.ts`:
  `ENTER` (fade), `ENTER_UP` (fade + 6px rise), `ROW_ENTER` (a row in a list
  still growing — a timeline step, a fresh message), `PAGE_ENTER` (a tab
  swap), `staggerDelay(i)` for a few items together. They are
  `@starting-style` transitions, so no mount effect and no restart. Only for
  what appears occasionally; never on a switch, a select, typing, or the
  result of a keyboard shortcut. Overlays are tw-animate `animate-in` /
  `animate-out` **with `ease-out` beside them** (tw-animate reads the
  token); popovers keep `origin-(--transform-origin)`, modals stay centered.
- **What is deliberate:** the sidebar toggle transitions `flex-grow` for
  200 ms (`layouts/shared/resizable-sidebar.tsx`, only while toggling, never
  during a drag — the one layout-property animation); a fresh run's user
  bubble and reply enter, what the chat opened with does not; tooltips wait
  500 ms for the first and are instant (`data-instant`, no animation) for
  the neighbours; the compaction card lingers 150 ms to fade out; the
  thinking timeline's icon is `thinking-orbs`' `ThinkingOrb` (`working`
  while the run streams, `solving` once it has thought), and waiting for
  the first step is the same orb in the same place (`MessageSpinner`), so
  the two are one figure that stays put; the composer
  is wrapped in `border-beam`'s `BorderBeam` (`pulse-outside` in light,
  `pulse-inner` in dark) — the owner's choice of 2026-09-27, from
  libraries.dev; the find bar has no focus ring: the pill is the field, and
  it only exists while it has focus.
- **Never `transition-all`** — name the properties. Animate `transform` and
  `opacity`; a `width`/`padding`/`grid-template-rows` transition needs a
  reason in a comment. `prefers-reduced-motion` in `globals.css` removes
  movement and keeps opacity/colour at 150 ms — do not add a second rule
  that zeroes everything.
- **A scrim dims, it never blurs.** The dialog / alert dialog / sheet /
  drawer overlays are `bg-black/30` alone: the main window is transparent over
  vibrancy, and a `backdrop-filter` there blurs the pane but leaves the
  sidebar's text sharp with a glow round it, its material undimmed
  (2026-10-15). `tests/unit/renderer/components/ui/overlay-scrim.test.ts`
  holds it against the shadcn generator.
- **Colour:** the light neutral base is `oklch(0.985)` (page) / `0.995`
  (card, popover) / `0.975` (sidebar) — never pure white; dark is `0.145`.
  No raw Tailwind palette colours (`bg-blue-400`) on chat surfaces and no
  `bg-black`/`bg-white` except an overlay scrim; use the tokens.

### Security Considerations

- `docs/security-hardening.md` is the reference: the threat model, what is in
  place and the smaller items still open — read it before touching the server
  middleware, preload, window creation, the LAN listener or the artifact sandbox
- Windows run with `sandbox: true` + `contextIsolation: true`; `hardenRenderers()`
  (`src/main/lib/security.ts`) cancels navigation away from the app, denies new
  windows, opens only `http(s)` / `mailto` links externally, and grants
  permissions only to Actovia's own pages. Never call `shell.openExternal`
  directly — use `openExternalSafely`
- **The artifact sandbox has an origin of its own** (`actovia-artifact://sandbox`,
  `src/main/lib/artifact-protocol.ts`), which is the whole of its isolation:
  model-written code there cannot reach `window.parent`, the preload bridge or
  the API (its CSP allows no network at all, and the origin gate refuses that
  origin). Never serve it from the app's origin again, and never add anything to
  it that needs the API — it gets its code by `postMessage`
- **The API has two faces** (see Middleware Pipeline and `src/main/lib/lan/`):
  plaintext on loopback, with no token — a local process can read `~/.actovia`
  anyway, and browsers are stopped by the origin gate; and HTTPS on the LAN,
  where every request needs a paired device's token and the certificate is
  pinned by the device. A paired device gets the whole API (actovia-ios edits
  provider keys), which is why that path is TLS-only
- **Loopback is not the user.** The model reaches loopback through
  `terminal`, so a route that acts on the user's say-so (answering a tool
  approval, managing devices) goes behind `presenceGate` — see Middleware
  Pipeline. A new such route is added to `PRESENCE_PATHS`
- API keys stored locally in PGlite database, encrypted with `safeStorage`
  (`enc:v1:…`; decrypted only into the in-process settings cache and the MCP
  query results); the API hands them out masked only (see
  `src/main/lib/secrets/` under Backend Server Architecture) — never add a
  route or response that serializes the settings row or an `mcp_server` row
  without `maskSettings()` / `maskMcpServer()`, and never read either table
  except through `db/queries.ts` / `db/mcp-queries.ts`

## Testing

### Framework

Vitest v4 with the following configuration (`vitest.config.ts`):

- Path aliases: `@main` → `src/main`, `@` → `src/renderer` (shared code is imported as `@actovia/shared/...` through the workspace package)
- Test files: `tests/unit/**/*.test.ts`
- Data dir: every test file gets its own scratch `ACTOVIA_HOME`
  (`tests/unit/setup/isolated-home.ts`, a `setupFiles` entry, under the config's
  scratch default) — files run in parallel and must never read each other's
  `~/.actovia` state (logs, `secrets-reentry.json`)
- Coverage: V8 provider targeting `packages/shared/src/` and `src/main/lib/`

### Writing Tests

- Tests live under `tests/unit/`, mirroring the source tree: `src/main/lib/paths.ts` → `tests/unit/main/lib/paths.test.ts`. Test files are never co-located with the module they test — this keeps `src/` free of test files. A dedicated `tsconfig.test.json` (referenced from the root `tsconfig.json`) covers `tests/unit/**/*` for editor support; it is intentionally not part of the `bun run typecheck` gate.
- The default environment is `node`. A test that needs a DOM (rendering a
  component or a hook) starts with `// @vitest-environment happy-dom` and drives
  React with `createRoot` + `act` — still a `.test.ts` file, using
  `createElement` rather than JSX (see
  `tests/unit/renderer/hooks/use-chat.test.ts`). Use it for render-count and
  identity guarantees; pure logic stays in `node`.
- Import the module under test via the matching alias (`@main/...`, `@/...`, or `@actovia/shared/...`), not a relative path — relative paths would need to reach back out of `tests/unit/` into `src/`.
- Tests for main-process code that transitively imports Electron/PGlite must mock those modules:

```typescript
vi.mock('@main/lib/db/db', () => ({ pglite: {} }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
```

- Use `await import('@main/lib/paths')` (alias, not a relative path) after mocks for dynamic import when needed
- **Anything that talks to a model is tested on pi's faux provider**, never
  a key: `registerFauxProvider()` (`src/main/lib/ai/kernel/faux.ts`) puts it
  on the kernel collection, `setResponses([...])` scripts the replies
  (`fauxAssistantMessage`, `fauxText`, `fauxToolCall` from
  `@earendil-works/pi-ai`; a response factory answers from the context). Each
  registration replaces the one before it, so register last and pass
  `handle.getModel()` in. Modules that one-shot through `completeSimple` are
  mocked at `@main/lib/ai/kernel/models` (`getKernelModels: () => ({
  completeSimple })`). See `tests/unit/main/lib/ai/kernel/run.test.ts` and
  `tests/unit/main/lib/server/routes/chat.faux.test.ts`
- **A migration or a query is tested on a real in-memory PGlite** with the
  shipped migrations applied: `createMigratedPglite('0008')` in
  `tests/unit/helpers/migrated-pglite.ts` (plus `migrationFile()` /
  `migrationSql()` to apply the one under test), mocked in as `@main/lib/db/db`
  with `drizzle(pglite)` where the module under test imports `db`

### Shared Utilities

Reusable AI utilities that should be used (and tested) instead of inline implementations:

- `src/main/lib/ai/utils/complete.ts` — `completeSimple()`: the kernel collection's, except a failed request rejects (`LlmRequestError`). pi-ai itself **resolves** on a 429 / bad key / dropped connection, to an empty message with `stopReason: 'error'`, which reads as "the model said nothing". Always import `completeSimple` from here, and make sure the caller's `catch` does something sensible
- `src/main/lib/ai/utils/llm-response-util.ts` — `extractTextFromCompletion()` and `parseJsonFromLlmResponse()` for parsing LLM outputs
- `src/main/lib/ai/utils/conversation-util.ts` — `extractConversationText()` for converting messages to text
- `src/main/lib/ai/providers/resolve-model.ts` — Shared `resolveModel()` with per-provider fallback defaults
- `src/main/lib/ai/utils/image-data.ts` — `bareImageData()` / `withBareImages()`: a chat saves an image attachment as the data URL the renderer shows (`data:image/png;base64,…`), and pi hands an image part's `data` to the provider as it is — Anthropic answered 400 "invalid base64 data", OpenAI got the prefix twice. The kernel's `convertToLlm` strips it from every message it sends (so old chats need no migration), and Philharmonic builds its image parts through `bareImageData()`
- `src/main/lib/ai/utils/usage.ts` — `storedUsage()`: the `usage` of an assistant message rebuilt from a stored row. pi reads `usage` off **every** assistant message of a request (each provider clamps its max tokens through `estimateContextTokens`), so a message without one fails the request before it is sent — every request after a chat's first did, 2026-09-23 to 09-29 (`Cannot read properties of undefined (reading 'totalTokens')`). Anything that hands pi an assistant message it did not produce goes through it (chat LCM, Philharmonic LCM); the kernel's `convertToLlm` applies it once more (`withUsage` in `kernel/invariant.ts`) for any history it is handed

## Testing Locally

1. Install dependencies: `bun install`
2. Start dev server: `bun run dev`
3. The app will launch with hot reload enabled
4. Database automatically initialized on first run
5. Configure at least one AI provider in settings before chatting
6. The dev window opens DevTools automatically. A console error whose stack is
   only `VMnnn` / `<anonymous>` frames — e.g. `Cannot read properties of
   undefined (reading 'startTime') at …reportAllChanges` — is not app code (app
   frames show `localhost:5173/src/...`, and nothing here depends on
   `web-vitals`): it is the script DevTools injects for the Performance panel's
   Live metrics, and is noise.

## Common Development Patterns

### Adding a New Tool

1. Create tool file in `src/main/lib/ai/calling-tools/my-tool.ts`
2. Define Zod schema for inputs
3. Implement the execute function
4. Register it in `src/main/lib/ai/calling-tools/index.ts`
5. Wire it into the chat tool-binding logic
6. Add UI toggle if needed in settings

### Adding a New Route

1. Create route file in `src/main/lib/server/routes/my-route.ts`
2. Define Hono route handlers
3. Import and register in main server setup
4. Create corresponding service in `src/renderer/services/my-service.ts`
5. Add a `hooks/use-my-domain.ts` wrapping it in `useQuery`/`useMutation` (see "Server state (React Query)") and use that hook for data fetching in components

### Adding a New Provider

1. Add the `AiProviders` enum member in `packages/shared/src/types/ai.ts`
2. Add a `SPECS` row in `src/main/lib/ai/providers/index.ts` (base-URL
   getter + fallback, default model ids, pi-ai `provider` / `api`). A provider
   that can't go through `resolveModel()` (like Ollama) gets its own module +
   a hand-written `ProviderFn` instead
3. Add a list-models handler in `src/main/lib/ai/providers/list-models/` (e.g., `my-provider.ts`) that normalizes the provider's API response
4. Register the handler in `src/main/lib/ai/providers/list-models/index.ts`
5. Add any per-provider fallback defaults to `MODEL_METADATA_FALLBACK` in `resolve-model.ts` (only what the provider's list API omits)
6. Add its key/base-URL fields to `ProvidersSchema` in `packages/shared/src/schemas/settings-schema.ts` and a tab in `settings-form/providers-tabs.tsx`

### Adding a User-Facing String

1. Add the key to the right namespace in `packages/shared/src/i18n/locales/en/<ns>.json`
   (dot-nested, component-scoped: `chat.composer.placeholder`).
2. Renderer, inside a component or hook:
   `const { t } = useTranslation('<ns>')` → `t('composer.placeholder')`;
   rich text (embedded link/bold) → `<Trans ns="<ns>" i18nKey="…">`. In the
   catalog key, a `<strong>`/`<i>`/`<p>`/`<br>` child MUST be written
   as that literal tag (`<strong>text</strong>`), never a numbered
   placeholder (`<1>text</1>`) — react-i18next's default
   `transKeepBasicHtmlNodesFor` renders exactly those 4 tags literally
   (notably, `<b>` is NOT in the default allowlist — write it as a numbered
   placeholder like any other non-allowlisted element), and a numbered
   placeholder for one of the 4 silently drops the child's content at
   render time. Numbered placeholders (`<1>`, `<2>`, …) are only
   correct for elements outside that allowlist (a custom component, `<a>`,
   `<span>`, etc.). `bun run i18n:check`/typecheck/lint do not catch a wrong
   choice here — a real render test does (see
   `tests/unit/i18n/chat-namespace.test.ts`'s
   `composerTools.mcpDialog.description` test for the pattern). If the
   file already has `useTranslation('<otherNs>')`, switch to the array form
   `useTranslation(['<otherNs>', '<ns>'])` — keep the existing namespace
   first so already-written bare `t('key')` calls keep resolving unchanged —
   and prefix every new lookup with `<ns>:`.

   A numbered placeholder's `<N>` is the child's raw 0-indexed position in
   the FULL `<Trans>` children array — text nodes and an explicit `{' '}`
   each occupy their own index too, not just element children. A block
   with two `<code>` children separated by plain text (`[text, <code>,
   text, <code>, text]`) numbers them `<1>` and `<3>`; adding a `{' '}`
   anywhere before the second one shifts it to `<4>`. This makes such a
   block fragile against `bun run fmt`/oxfmt reflowing the JSX (a
   line-wrap can insert or remove an explicit `{' '}` with no visible
   change to non-`<Trans>` rendering, but it renumbers everything after
   it) — a real incident shipped with a fully green test suite because
   the test hand-copied the children into a `createElement()` call
   instead of rendering the real component, so the reflow-induced
   renumbering had nothing to fail against. For any `<Trans>` block with
   two or more non-allowlisted (numbered) children, extract it into its
   own exported component and have the test `await
   import('@/path/to/the/file')` and render that component directly —
   never hand-copy its children into the test (see `s3.tsx`'s
   `PublicReadAccessNotice` and its render test in
   `tests/unit/i18n/settings-namespace.test.ts` for the pattern). Don't
   trust a manual count of the children either — dump the actual
   compiled array (`React.Children.forEach` over the component's own
   `props.children`, or an `esbuild --jsx=transform` compile) before
   writing the catalog's placeholder numbers.

3. Renderer, outside a component/hook (a plain exported function, a
   module-level helper, a `src/renderer/services/*.ts` function) —
   `useTranslation()` isn't callable there. Import the shared instance
   directly: `import { i18n } from '@/lib/i18n'` → `i18n.t('<ns>:key')`
   (always the explicit `ns:key` form — the raw instance has no namespace
   bound beyond the global `defaultNS: 'common'`).
4. Main process: `mainI18n.t('<ns>:key')` (or the `mainT()` helper in
   `src/main/lib/i18n.ts`, which additionally tolerates `mainI18n` being
   unassigned during a failed boot).
5. Dates/numbers: `useFormat()` (renderer). Never build a sentence by
   splicing a hand-formatted date/number into raw English word order — pass
   it as an interpolation param to a translated key instead.
6. Non-English catalogs are filled by the machine-translation pass — do not
   hand-edit them.
7. `src/renderer/components/ui/**` (shadcn primitives) is permanently out of
   scope for extraction — the generator (`bun run shadcn:generate`) overwrites
   these files and drops any `t()` calls added by hand.
8. Before extracting a string into an existing function scope, check whether
   that scope already binds a local `t` (a loop variable, a destructured
   field, anything) — a shadowed `t` compiles fine today but breaks the next
   namespace pass that adds a real `t()` call in the same scope.
9. **This is enforced, not just convention.** `tests/unit/i18n/no-hardcoded-strings.test.ts`
   (part of `bun run test`, so gated on every commit) scans every
   `src/renderer/**/*.{ts,tsx}` (excluding `components/ui/**` and
   `sub-apps/artifacts/sandbox.tsx`) for JSX text nodes (`.tsx` only),
   `sileo.*({ title | description })` values (including template literals
   and ternaries, in both `.ts` hooks/services and `.tsx` components), and
   `label:` properties in `src/main/lib/menu.ts`/`tray.ts` that aren't
   routed through `t()`/`<Trans>`/`mainT()`. A new hardcoded string fails
   the suite immediately — add a catalog key instead. The only escape
   hatch is `tests/unit/i18n/allowlist.ts`, reserved for genuine proper
   nouns/brand names/technical identifiers (a GitHub org slug, a license
   name, a URI scheme prefix) — never for deferred i18n debt; every entry
   needs a real reason.

### Test-ID Checkpoints (traceability)

When adding or generating an interactive element that warrants test coverage:

1. Add a semantic id to `packages/shared/src/constants/test-ids.ts` (the value mirrors the
   object path, camelCase → kebab-case), e.g. `TEST_IDS.lock.unlockButton` →
   `'lock.unlock-button'`.
2. Apply it on the element: `data-testid={TEST_IDS.lock.unlockButton}`. For the
   `PinInput` (and similar wrapped components), pass the `testId` prop instead.
3. Reference the same constant from a Playwright test in `tests/` via
   `getByTestId(TEST_IDS.lock.unlockButton)`. (Playwright does not resolve the
   workspace package specifier — import `TEST_IDS` via a relative path,
   `../../packages/shared/src/constants/test-ids`, in specs.)

Rules enforced by the Vitest linkage test `test-ids.linkage.test.ts` (runs in
`bun run test` and the pre-commit hook):

- every registry id must be applied in `src/renderer` (no orphan ids),
- every registry id must be referenced by at least one test (no uncovered ids),
- never use a raw string `data-testid="..."` — always go through the registry.

Ids are a durable contract: never rename or regenerate an existing id; only add
new ones. Dangling references to non-existent ids are caught by TypeScript (the
registry is typed). `data-testid` attributes are stripped from packaged release
builds by a small Vite `transform` plugin in `vite.renderer.config.mts` gated on
`STRIP_TEST_IDS=1` (set by `bun run make` / `bun run publish`); dev, `bun run package`
and E2E builds keep the markers.

## Code Structure

Main process:

- `src/main/main.ts` — app bootstrap, lifecycle, IPC + server startup
- `src/main/lib/server/app.ts` — Hono server + route registration
- `src/main/lib/server/routes/` — API route handlers
- `src/main/lib/server/middlewares/` — LAN compression, origin gate, auth gate, lock gate, presence gate, trace, error handler
- `src/main/lib/ai/providers/` — LLM provider resolution (`resolve-model.ts`)
- `src/main/lib/ai/providers/list-models/` — Live model catalog handlers per provider (`anthropic.ts`, `openai.ts`, `google.ts`, `xai.ts`, `ollama.ts`); each normalizes that provider's list-models API response into `{ id, displayName, snapshot: ModelSnapshot }`, dispatched by `index.ts` and called from `POST /api/v1/settings/models`
- `src/main/lib/ai/kernel/` — the chat kernel: `models.ts` (the `Models` collection, `streamFn`), `run.ts` (`runAgent()`), `record.ts` (`RunRecorder`), `invariant.ts` (`dropBrokenRuns()`), `approval.ts` + `pending-approvals.ts` (the approval gate for secrets outside Actovia), `events.ts`, `log-throws.ts` (`loggingThrows()`: pi keeps only the message of what is thrown into it, so `streamFn`, `convertToLlm`, `beforeToolCall` and the listener log the Error — scope `kernel`, once, with the chat and the run — and throw it on), `faux.ts` + `faux-boot.ts` (pi's scripted provider; `ACTOVIA_FAUX_PROVIDER=1`)
- `src/main/lib/chat/history.ts` — the conversation as the server reads it (`loadChatHistory()`, `rowToChatMessage()`); the chat route's history, never a client's. `findToolCall()`: an earlier call's arguments and stored result, for `recall`
- `src/main/lib/chat/page.ts` — history a page at a time (`loadChatPage()`, `compactRow()`, `limitRow()`, `loadChatRow()`); wire types in `packages/shared/src/types/chat-page.ts`
- `src/main/lib/chat/sources.ts` — the `chat_source` table: `sourcesOfRows()` (a run's sources from its rows), `saveChatSources()`, `ensureChatSources()` (fill in an older or imported chat), `highestSourceRank()`, `getChatSource()`, `listChatSources()`
- `src/main/lib/ai/context-management/aging.ts` — tool output aging (`TOOL_POLICIES`, `ageToolOutput()`, `digestAll()`, `DIGEST_VERSION`); see "Tool output ages"
- `src/main/lib/chat/attempts.ts` — regenerate-group transitions (`recordRegenerate`, `chooseAttempt`, `settleOpenComparison`, `pickAutoChoice`); the only writer of `message.alternateOf` / `message.attempt`
- `src/main/lib/presence.ts` — the per-launch user-presence token (see Middleware Pipeline, presence gate)
- `src/main/lib/remote-debugging-guard.ts` — `main.ts`'s first import: a packaged build exits when started with a Chromium remote-debugging switch (`remote-debugging.ts`), which would expose the main frame and its presence token
- `src/main/lib/ai/calling-tools/` — built-in agent tools (snake_case names from `packages/shared/src/constants/tool-names.ts`) and the MCP toolbox (`mcp-toolbox.ts`)
- `src/main/lib/ai/skills/` — skills.sh client, install store, and the prompt seam (see Skills)
- `src/main/lib/analytics/` — DuckDB chat-audit snapshot + read-only query wrapper (see Chat Audit)
- `src/main/lib/media/` — generated images on disk (`store.ts`: `mediaDirFor` — the one way to name a chat's / Group's media dir, refusing a bad id — `saveMedia`, the `resolveMediaFile` path guard the media route uses, per-chat / per-Group / all removal); see the `image_generation` note
- `src/main/lib/net/` — `safe-fetch.ts`: `fetchPublicHttps()` / `isPublicAddress()`, the SSRF guard for a URL someone else chose (see `docs/security-hardening.md`); `local-api-guard.ts`: web_fetch cannot reach 60223 / 63129; `pinned-fetch.ts`: `fetchPinned()`, web_fetch's built-in loader's GET, pinned to the addresses it judged and never following a redirect itself
- `src/main/lib/ai/philharmonic/` — multi-agent Groups
- `src/main/lib/ai/context-management/` — LCM
- `src/main/lib/ai/memory/` — personalization memory (consolidation + recall)
- `src/main/lib/lock/` — app lock (PIN, gate, idle)
- `src/main/lib/db/` — Drizzle schema + queries (PGlite)
- `src/main/lib/search/` — chat search, PGlite only (`searchChats()` in
  `db/queries.ts`; there is no other backend — migration 0016 drops the
  retired one's `settings.fullTextSearch` column and launch drops its
  `index-message` queue). `GET
  /api/v1/chat/search?query=` answers one row per chat
  (`@actovia/shared/types/chat-search`, actovia-ios decodes the same): title
  or message holding every word, newest match first, 30 chats, ≤ 3 plain-text
  snippets each (`snippet.ts`; `chat-search-results.ts` folds the hits).
  The desktop's Search chats dialog is cmdk over it
- `src/main/lib/knowledge-base/` — optional LightRAG knowledge base: HTTP
  client, `resolveKnowledgeBase()` (never-throws), and the `kb-sync`
  index-status `reconcile.ts`
- `src/main/lib/discover/` — Home Discover feed: Brave News client, memory-driven
  query generation, `runDiscoverRefresh` (see docs/superpowers/specs/2026-09-05-home-discover-feed-design.md)
- `src/main/lib/jobs/` — durable job queue (pgmq-backed): `queries.ts`
  (enqueue/read/delete/archive/purge), `handlers.ts` (per-queue job logic),
  `worker.ts` (`enqueueAndProcess()` + periodic sweep). A finished job is
  deleted; only a job given up on is archived, and archives are truncated at
  launch — payloads carry whole conversations. No payload carries an API key:
  the handler reads it from settings when it runs (`job-api-key.ts`), and
  launch strips one an earlier build queued. Decouples chat.ts's post-turn
  side effects (LCM compaction, memory consolidation,
  `kb-sync`, `discover-refresh`) from the request/response cycle.
  `queries.ts`'s `enqueueJob` stamps the ambient `traceId` onto the payload
  (`__originTraceId`); `worker.ts` runs each handler in a `withTrace` linked
  to it
- `src/main/lib/logger/` — OpenTelemetry-shaped structured logging (no
  `@opentelemetry/*` dep): `record.ts` (LogRecord shape + severity/exception/
  legacy mapping), `resource.ts` (service/process identity), `trace-context.ts`
  (`AsyncLocalStorage` per-unit-of-work trace ids — `withTrace` /
  `currentTrace` / `bindTraceAttributes`), `index.ts` (the `logger` API,
  call signature unchanged), `secret-mask.ts` (every secret value decrypted
  so far — fed by the settings cache fill and each MCP row read — masked in
  each line before it is written). `withTrace` wraps the `/api/*` middleware, the
  job worker, and the scheduler. JSONL at `~/.actovia/logs/`; read via
  `/api/v1/logs` (filters incl. `traceId`; `q` — the search box's words,
  `-word`, `scope:` and `trace:`, parsed by `parseLogQuery()` in
  `packages/shared/src/utils/log-query.ts`; `levels=error,warn`; a
  `from`/`to` window; the response carries a per-level `histogram` drawn
  without the levels and the window, which the chart sets) +
  `/api/v1/logs/scopes` and the Settings → Logger tab; `POST /api/v1/logs` is the renderer reporting an
  error it caught (`lib/report-error.ts`), written under a
  `renderer/<scope>` surface — or, with `source: 'ios'` in the body, a
  paired actovia-ios device reporting its own local errors over the LAN
  listener, written under `ios/<scope>` instead; either accepts a single
  report or `{ reports: [...] }` (capped at 50). See
  `docs/superpowers/specs/2026-09-06-standardized-logging-design.md`.
  **Errors and stacks:** whatever is caught is logged under `error` as it
  was caught — `{ error: err }`, never `String(err)` or `err.message`, which
  is where a stack is lost. `toAttributes` (`record.ts`) turns an Error into
  `exception.type` / `exception.message` / `exception.stacktrace`: the stack
  with every frame that points into a built file rewritten to its source
  position (`at e (src/main/lib/ai/utils/cost.ts:7:27)`, not
  `chat-Cw3ZonVn.js:1:91`; the function name stays the built one — the maps
  carry no names), and `exception.stacktrace_raw`, the stack as thrown, only
  when mapping changed it. `source-map.ts` does the rewriting from the hidden
  source maps the build writes (see the Vite configs under Tests & config):
  it reads a `.map` only when an error is being logged, only for a file under
  the running build's own `.vite/` (a client names the paths in what it
  reports), holds the parsed map until five minutes pass without an error,
  and never throws — a frame it cannot map stays as it was. A site that logs
  an error's name alone because its message can quote a conversation or a
  key (a failed drizzle write: the chat route's persist, the job queue's
  enqueue) adds `'exception.stacktrace': stackFramesOf(error)`: the frames,
  no message. `POST /api/v1/logs` maps a renderer report's `stack` /
  `componentStack` the same way, before clipping them (what was sent stays
  under `stack_raw` / `componentStack_raw`); an `ios/` report is written as
  sent. Stacks pass through `secret-mask.ts` like every other line. What is
  thrown inside pi's own code (a provider's request builder) never reaches
  the logger as an Error — pi catches it and keeps its message; what the
  kernel's own functions throw is logged first (`kernel/log-throws.ts`)
- `src/main/lib/computer/` — window-scoped screenshot-loop Computer Use V0: the
  `actovia-input` Swift helper (list-windows / list-apps / screenshot / activate /
  CGEvent input), `capture`/`target`/`hands`/`guard`, `runComputerSession` (the
  perceive→act loop), `liveness` (the ⌥⇧⎋ kill switch); `target.resolveOrLaunch`
  opens an allowlisted app that isn't running; `self.ts` — Actovia itself (its
  bundle id, its own windows) is never a target, whatever the allowlist says,
  and never offered in the picker. The inner-loop agent is
  `src/main/lib/ai/computer-use/`. Bound as the `computerUse` calling-tool,
  gated on `settings.computerUse.enabled`. `GET /api/v1/computer-use/apps` feeds the
  Settings allowlist picker. See
  `docs/superpowers/specs/2026-09-06-computer-use-v0-design.md`
- `src/main/lib/i18n.ts` — the main-process i18next instance (`mainI18n`),
  `resolveEffectiveLocale`, and the `get-app-locale` / `set-app-locale` IPC
- `src/main/lib/ipc.ts` — main-process IPC handlers
- `src/main/lib/attachment-actions.ts` — Save / Copy for a chat attachment
  (`ATTACHMENT_CHANNELS`, `packages/shared/src/types/attachment-actions.ts`):
  the renderer names the attachment (its `data:` / media-route / `https:` URL
  and file name), main shows the native save dialog and writes only where the
  user chose, pops the native right-click menu (Save Image As… / Copy Image,
  or Save As…) and puts a copied image on the clipboard as a PNG. A media URL
  is read off disk through `resolveMediaFile`; any other loopback URL is
  refused; 64 MB cap; a window's top frame only. Renderer side:
  `src/renderer/lib/attachment-actions.ts` and
  `src/renderer/components/chat/attachment-frame.tsx` (the hover/focus download
  button, the zoomed view's toolbar button)
- `src/main/lib/lan/` — access from the LAN (actovia-ios on a device). The app is
  served twice (`server/app.ts`): plaintext on loopback, and over HTTPS on
  `LAN_SERVER_PORT` behind `authGate` — but only while a device is paired, a
  pairing window is open, or a revoked device has yet to be told (see
  `revoked.ts`); otherwise nothing listens on the LAN at all.
  `pairing.ts` (the pairing window: a one-time code, two minutes, single use,
  five wrong guesses close it; pure, clock injected; also the
  `actovia://pair?h=&p=&c=&f=&n=` link and LAN host discovery), `devices.ts`
  (256-bit tokens stored as SHA-256 in `paired_device`; constant-time match
  through a cache every write drops, so a revocation bites on the next
  request), `certificate.ts` (self-signed P-256, ten years, key under
  `safeStorage` in `~/.actovia/tls/`; its fingerprint is what devices pin — never
  rotated except by "Reset all"), `listener.ts` (`sync()` makes the HTTPS
  listener match "wanted"; resolves once listening), `index.ts` (the process's
  `pairing`, `syncLan()`, `openPairingWindow()`), `revoked.ts` (a device
  revoked here learns it only from a 401 on its next request, and the
  listener used to stop with the last device, so the phone found nothing and
  stayed "paired": each revocation keeps a token-hash record in
  `~/.actovia/lan-revoked.json` that keeps the listener wanted until
  `authGate` answers that token once, or 30 days pass; a reset replaces the
  certificate, so it keeps none and drops the rest). Routes: `POST
  /api/v1/pair` (code → token), `DELETE /api/v1/pair` (a paired device
  unpairing itself — authenticated by its own token, it leaves the Devices
  list too), `/api/v1/devices` (list, open/close a window, revoke, reset —
  loopback only). Spec:
  `docs/superpowers/specs/2026-09-20-lan-pairing-sandbox-isolation-design.md`
- `src/main/lib/artifact-protocol.ts` — the `actovia-artifact://sandbox` scheme
  the artifact sandbox is served from, so model-written code has an origin of
  its own and cannot reach `window.parent` (path-guarded static files when
  packaged; a proxy to the Vite dev server in dev)
- `src/main/lib/single-instance.ts` — the single-instance lock, taken by
  `db/db.ts` before it opens PGlite (see Data directory, ports and isolation)
- `src/main/lib/secrets/` — the secret registry (`registry.ts`, incl.
  `SECRET_DESTINATIONS`), the mask (`mask.ts`), `maskSettings` /
  `restoreSettingsSecrets` / `maskMcpServer` / `restoreMcpSecrets`
  (`index.ts`), the stored-plaintext accessors (`current.ts`), and encryption
  at rest: `crypto.ts` (`enc:v1:` over `safeStorage`; only a well-formed
  envelope counts as encrypted), `at-rest.ts` (decrypt a row on read,
  `prepareSettingsWrite` / `prepareMcpUpdate` on write; MCP `url` and `args`
  are encrypted whole), `migrate.ts` (`secretsAtRestStartup()`, the idempotent
  pass `main.ts` runs after the schema migrations: encrypt, strip job keys,
  then — once, or whenever it changed something — `purge.ts`: `VACUUM FULL`
  and three `pg_switch_wal()` / `CHECKPOINT` rounds so no plaintext survives in
  the heap, the WAL or a `dumpDataDir()` backup, and the raw log files are
  rewritten with secrets masked; each step fails on its own; marker
  `~/.actovia/secrets-purge.json` — once that marker's `purgedAt` is on record
  and encryption reads `'on'`, `removeOldBackupsOnce()` also deletes every
  `~/.actovia/backups` auto-backup older than it (the pre-encryption ones,
  which held every key in the clear — owner's call 2026-09-26), once,
  recording `oldBackupsRemovedAt` in the same marker so it never repeats and
  never touches a backup made since), `status.ts` (what
  `GET /api/v1/settings/secrets-status` reports), `moved.ts` (the secrets a
  destination move cleared, by name, in `~/.actovia/secrets-reentry.json`,
  listed until re-entered), `url.ts` (re-exports the shared
  `normalizeBaseUrl`), `known.ts` + `scrub.ts`
  (every current secret value, and masking them out of copied text). The pure
  detectors — `isSecretName`, `maskSecret`, `maskMcpUrl` / `maskMcpArgs`,
  `argsHoldSecret` (the MCP form's "secrets in arguments are visible to
  `ps`" notice) — live in `packages/shared/src/utils/secret-detect.ts`, so the
  renderer judges a value by the same rules; `registry.ts`, `mask.ts` and
  `locators.ts` re-export them. A
  startup self-check turns encryption off if `safeStorage` output is not a
  recognizable envelope. An MCP row that did not fully decrypt carries
  `mcpDecryptFailures()` and is never connected (`ai/mcp.ts`); a save keeps
  what did not decrypt, and writes what it leaves unchanged as stored, never
  as the plaintext it opened to (`keepStoredMcpForms`, fail closed while
  encryption is unavailable)
- `src/main/lib/security.ts` — renderer hardening (`hardenRenderers()`:
  navigation guard, window-open handler, permission handler) and
  `openExternalSafely` / `isSafeExternalUrl`
- `src/main/lib/paths.ts` — `~/.actovia` path helpers

Preload:

- `src/preload/preload.ts` — context-isolated bridge (`preload.d.ts` types `window.electron` / `window.api`)

Renderer:

- `src/renderer/components/` — UI components
- `src/renderer/components/ui/` — shadcn primitives (reuse these)
- `src/renderer/components/lock/` — lock screen
- `src/renderer/components/chat/run-approvals.tsx` — the approval card at a run's foot (see Chat Flow)
- `src/renderer/components/chat/assistant-turn-segment.tsx` — `AssistantTurnSegment`: one run's answer (timeline, blocks in run order, action bar, foot); `chat/compare-turns.tsx` + `chat/other-version-dialog.tsx` — a regenerate group's answers (see the render-path notes)
- `src/renderer/components/calling-tools/tool-cards.ts` — which tools draw a card (`hasToolCard()`), shared by the card dispatch and the turn builder
- `src/renderer/components/philharmonic/` — Philharmonic UI
- `src/renderer/components/philharmonic/schedule/` — Schedule tab (agenda: upcoming one-off + recurring tasks)
- `src/renderer/components/settings/` — settings. Every page is put together
  from `settings-row.tsx` (`SettingsSection` — a titled card of hairline rows —
  and `SettingsRow`) plus `settings-kit.tsx`: `SettingsIntro` at the top (what the
  page is for, as muted prose — explanation gets no box; `SettingsNotice`, an
  `Alert`, is only for a caveat that must be heeded for the thing in front of
  the user to work, e.g. "same network" in the pairing steps), `SettingsItem` (icon tile + name + one line of meta +
  actions) for anything in a list and for a page's primary action,
  `SettingsEmpty` for an empty list, `SwapLabel` for a button whose label
  changes with state (stable width, blurred crossfade), and the motion tokens
  `ENTER` / `ENTER_UP` / `PAGE_ENTER` / `staggerDelay()` (re-exported from
  `src/renderer/lib/motion.ts` — see Motion above). A page reads top to
  bottom: intro, primary action, content
  sections, and anything destructive last in a section of its own, behind an
  `AlertDialog`. `settings-form.tsx` keys the page wrapper by tab so each page
  arrives with `PAGE_ENTER`
- `src/renderer/components/settings/settings-form/devices.tsx` — Settings →
  Integrations → Devices: pair a device by QR code, revoke, reset (the UI of
  `src/main/lib/lan/`). The pairing card is `devices-pairing.tsx`: an invitation,
  or — while a window is open — numbered steps beside the QR code and a
  countdown drawn from the shared `PAIRING_TTL_MS`
  (`packages/shared/src/constants/systems.ts`, enforced by the main process)
- `src/renderer/components/settings/settings-form/logger.tsx` — Settings →
  Logger: day + scope pickers, Live (polls today's file every 2 s, paused
  while a line is open), a search box (`/` focuses it; the query syntax of
  `log-query.ts`), the level chart (`log-chart.tsx`: stacked bars by level —
  a bar is a time window, the legend is the level filter), the list, and a
  line opened in a side sheet (`log-detail.tsx`: ↑/↓ or k/j walk the list
  across pages — handled on the sheet in the capture phase, since the dialog
  swallows arrow keys before a global hotkey sees them; Lines around, Copy
  for AI (`log-copy.ts`), Same trace). `log-levels.ts` holds the four level
  colours. `log-attributes.tsx` draws the sheet's body: the stack
  (`exception.stacktrace`, or a client report's `stack`) and the
  `componentStack` as blocks of their own — text with real line breaks,
  mono, scrolling both ways — then the other attributes as a key/value
  table (the `…_raw` stacks stay in there; a `*_ms` value notes its seconds)
- `src/renderer/components/settings/settings-form/tools.tsx` — Settings →
  Built-in Tools: one hairline row per `TOOL_REGISTRY` entry (name, what it
  does, its switch). A tool with something to set up carries its panel under
  the row, open by default, with a Configure disclosure that folds it (a
  `Reveal`); `tool-config.tsx` is that map — **keyed by the tool's wire name
  (`TOOL_NAMES.*`), the same key as the registry** — with, per tool, the one
  field it cannot work without and the red hint shown while the tool is on
  and that field is empty. (The snake_case rename once left this map on the
  old camelCase keys and the three panels vanished silently;
  `tool-config.test.ts` pins the keys to the registry now.)
- `src/renderer/components/app/status-strip.tsx` — `StatusStrip` (an icon + text
  row on the frosted surface, with an optional `Reveal`-able `details`
  section): shared by `lcm-status-card.tsx` (compaction) and
  `chat/memory-change-strip.tsx` (`update_memory`)
- `src/renderer/components/settings/secret-fields.tsx` — `SecretInput` (a stored
  key's input: its mask, replaced whole by typing), `DestinationInput` (a field a
  saved secret is sent to, warning that a change clears it — the MCP url and
  command use it) and `AddressInput` (the Settings base-URL fields' wrapper); `settings-form/secrets-notices.tsx` — the
  keychain / re-entry notices on Settings → General; `src/renderer/lib/secrets.ts`
  (the mask shape and the destination rule, mirrored) and `src/renderer/stores/secrets.ts`
  (`clearedSecretsAtom`). See "The desktop Settings form and masks"
- `src/renderer/components/motion/morph.tsx` — `Morph` (two states in one cell, the
  height following the active one under a blurred crossfade) and `Reveal` (a
  section growing from 0fr): the in-place opening a card or a row is allowed
  (see Motion); used by the weather card and the Built-in Tools panels
- `src/renderer/components/app/flag.tsx` — `<Flag code>`: a country flag as a
  separate SVG file by ISO code (never emoji — Windows has none; never inlined —
  the web-search list is 239 of them)
- `src/renderer/components/skills-market/` — Settings → Skills Market (Discover grid, detail page with audit + CLI command, Installed list)
- `src/renderer/containers/` — page-level components
- `src/renderer/stores/` — Jotai atoms, incl. `input.ts`'s `chatInputAtom`
  (the composer's draft text) and `chatInputFocusAtom` (a counter
  `multimodel-input.tsx`'s `InputBox` watches to refocus and re-caret the
  composer — bumped by `used-memories.tsx`'s "Fix in chat")
- `src/renderer/hooks/` — React hooks
- `src/renderer/services/` — API call wrappers
- `src/renderer/lib/` — renderer utilities (ipc, stream-manager, `query-client.ts` — the one
  `QueryClient` (`createAppQueryClient()`) and `installWindowFocusListener()` (see "Server state
  (React Query)" above), `relay-retry.ts` — `RELAY_RETRY` for the remote skills.sh relay, `tone.ts`
  — `data-tone` apply/boot cache, `quick-chat-bridge.ts` — `installQuickChatBridge()`, the main
  window's end of the quick-chat hand-off (see Sub-apps), `mask-url.ts` — `maskUrlSecrets()` for showing a URL without its
  query-string credentials, `heatmap-months.ts` — month labels for the Profile heatmap,
  `report-error.ts` — `reportRendererError()` + `installGlobalErrorReporting()` (see
  Motion/render-path notes above; a report carries the error's `stack` and, from an error
  boundary, React's `componentStack`, as the browser gave them — the main process maps them to
  source positions), `menu-bridge.ts` — `installMenuBridge()`, the renderer half of
  the native menu's New Chat / Settings… items: `menu.ts`'s `goToMainWindow()` raises the main
  window and sends `menu:new-chat` / `menu:open-settings`; `router.navigate()` needs no component to
  answer it)
- `src/renderer/components/app/tone-bridge.tsx` — follows `settings.colorTone` and re-applies it
- `src/renderer/sub-apps/` — searchbar, quick-chat, artifacts entry points

Shared:

- `packages/shared/src/types/` — cross-process types
- `packages/shared/src/constants/` — constants (`test-ids.ts`, `systems.ts`, `tool-names.ts`)
- `packages/shared/src/schemas/` — Zod schemas
- `packages/shared/src/utils/` — shared utilities, incl. `attempts.ts`: regenerate groups as pure functions — which runs the model sees (`excludedRuns`, `runsForContext`) and what a client shows before the server has answered (`attemptsAfterRegenerate` / `attemptsAfterChoice` / `attemptsAfterSettling`, the rules of `src/main/lib/chat/attempts.ts`)
- `packages/shared/src/i18n/` — application i18n: `locales.ts` (the 10 locale IDs +
  `resolveLocale`), `namespaces.ts`, `index.ts` (`createI18n` — one i18next
  config for both processes, JSON catalogs lazy-loaded per locale),
  `catalog-audit.ts`, `types.d.ts` (typed `t()` keys), `locales/<id>/<ns>.json`.
  See `docs/superpowers/specs/2026-09-11-i18n-design.md`.

Brand:

- `brand/art.mjs` — the icon art (see Icons, tray and boot splash), `brand/lib.mjs` — shared drawing helpers; `scripts/render-icons.mjs` renders them (`bun run icons`)
- `brand/svg/`, `brand/icon-composer/`, `brand/ios/`, `brand/web/` — generated outputs; `brand/liquid-glass/` — the Icon Composer exports (light, dark); `brand/fonts/` — Fredoka (OFL) for the wordmark

Tests & config:

- `tests/unit/` — Vitest unit tests, mirroring `src/` (`src/main/lib/paths.ts` → `tests/unit/main/lib/paths.test.ts`)
- `tests/api/` — API integration (Playwright)
- `tests/e2e/` — Electron E2E
- `tests/providers/` — provider compatibility
- `tests/fixtures/` — Playwright fixtures (electron, api-client)
- `tests/helpers/` — test helpers
- `tsconfig.test.json` — editor/type support for `tests/unit/**/*` (not part of the `bun run typecheck` gate)
- `forge.config.ts` — electron-forge config (packager, makers, publisher, Vite plugin, fuses)
- `vite.main.config.mts` / `vite.preload.config.mts` / `vite.renderer.config.mts` — Vite configs per target (the renderer one has the `data-testid` strip and the sub-app HTML entries). All three write **hidden source maps** (`build.sourcemap: 'hidden'`: a `.map` beside every built file, no `sourceMappingURL` comment, so neither Node nor Chromium loads one by itself), positions only (`sourcemapExcludeSources` — the sources' text is two thirds of a map and the repo is public); the renderer drops the maps of Monaco's workers (26 MB for code that reports nothing). `forge.config.ts` packages everything under `.vite/`, so they ship inside `app.asar`: about 18.7 MB there, 3.8 MB compressed. The logger reads them (`src/main/lib/logger/`); the `data-testid` strip leaves the line breaks of what it removes, so a release build's maps still name the right line
- `vitest.config.ts` — unit test config
- `playwright.config.ts` — E2E config

Docs:

- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans
- `docs/manual-qa-checklist.md` — the owner's hand-run acceptance checklist
  (every feature but Philharmonic, P0/P1/P2); add a line when a feature ships
- `docs/chat-api.md` — the chat API's technical specification (see Chat Flow)
- `docs/security-hardening.md` — threat model, protections in place, and the
  open security items with their intended fixes
- `docs/pi-ai-review.md` — review of the pi-ai usage against the upstream
  README: what was fixed, and the migration to `@earendil-works/*` 0.85
  (done with the chat kernel, spec `2026-09-22-chat-kernel-design.md`)
- `docs/lightrag-setup.md` — end-user guide for running the self-hosted
  LightRAG server that backs the optional knowledge base (Actovia is a
  client only, see `src/main/lib/knowledge-base/`)
