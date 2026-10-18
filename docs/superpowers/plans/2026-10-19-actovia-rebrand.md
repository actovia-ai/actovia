# Actovia Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every name a person sees across the six repos becomes Actovia, while every internal identifier that holds data or pairs devices stays, and nothing an existing user has (secrets, PIN, pairing, settings) is lost.

**Architecture:** Per-repo commits on master/main. The desktop bundle is renamed by the packager (`packagerConfig.name`) while package.json `productName` stays `Exodus`, so Electron's runtime name — and with it the Keychain item, userData and the single-instance lock — is unchanged. Copy, catalogs, metadata, URLs and docs change; code identifiers, protocol markers and history do not.

**Tech Stack:** Electron Forge 8 / Electron 44.5, TypeScript, i18next (10 locales), Swift/Tuist (xcstrings), Bun CLI, Next.js 16 on Cloudflare, Markdown.

**Spec:** `docs/superpowers/specs/2026-10-19-actovia-rebrand-design.md` (in the desktop repo)

## Global Constraints

- Repos (all under `/Users/yanceyleo/Code/exodus/`): desktop `exodus/` (master), iOS `exodus-ios/` (main), `cli/` (main), `homepage/` (main), `skills.sh-bff/` (main), `.github/` (main, empty). Commit on those branches; **never push** (the controller pushes after asking the owner).
- **Rename** everything a person sees: app/window/menu names, UI copy, catalog values, notifications, model-facing prompt text naming the product, README/CLAUDE.md/current docs, metadata, URLs, GitHub links, package names, iOS display names, wordmarks.
- **Keep** (never rename): bundle ids `app.yancey.exodus`, `app.yancey.exodus.ios` (and every `app.yancey.exodus.*` id: activity type, URL name, widget kinds, keychain service `app.yancey.exodus.pairing`, app group `group.app.yancey.exodus`); `~/.exodus` and `.exodus/` meta dirs; `EXODUS_*` env vars; package.json `name: "exodus"` and **`productName: "Exodus"`** (desktop); localStorage key `exodus-color-tone`; UserDefaults `exodus.serverURL`; schemes `exodus://`, `exodus-artifact://`; fence names `exodus-ask|confirm|steps|stock|health|answer|itinerary|cite`; header `x-exodus-presence`; prefixes `exodus-string:` / `exodus-number:`; DB enum value `'exodus'`; catalog **key names** (e.g. `menu:tray.quitExodus`, `ios:onboarding.getExodus`) — only values change; test ids; the `exodus-input` helper name; the Cloudflare worker name `exodus-homepage`; the `~/Exodus Projects` folder default; `brand/Exodus.icon` file name.
- **Keep code identifiers**: `@exodus/shared`, `getExodusHome`, `ExodusIos`, `ExodusApp`, `AskExodusIntent` (type name), `EXODUS_WEBSITE`-style constant names, etc.
- **Keep history**: `CHANGELOG.md`, dated files under `docs/superpowers/{specs,plans}/` (except this plan's own spec), commit messages.
- New URLs: site `https://actovia.yancey.app`; GitHub org `https://github.com/actovia-ai`; repos `actovia-ai/actovia` (desktop), `actovia-ai/ios`, `actovia-ai/cli`, `actovia-ai/homepage`, `actovia-ai/skills.md-bff`. The npm package is `actovia-cli`. `SKILLS_SH_BFF_URL` (`https://skills-md.yancey.app`) is unchanged.
- Desktop gate before each commit (the pre-commit hook does NOT run tests): `bun run fmt && bun run lint && env PWD=/Users/yanceyleo/Code/exodus/exodus bun run typecheck && bun run i18n:check && bun run test` (a lone PGlite `Aborted()` / `ErrnoError` with every test passing is a known flake: re-run once). New desktop strings: all 10 locales (`de en es fr it ja ko pt-BR zh-Hant-HK zh-Hant-TW`), authored.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The desktop's runtime name changes by accident** (someone sets productName, or calls `app.setName`) → every secret undecryptable. Pinned by a unit test in Task 1.
2. **A catalog key renamed instead of its value** → a missing-key render ("menu:tray.quitExodus" shown raw). Pinned by `i18n:check` and Task 2's grep (keys unchanged).
3. **A protocol marker renamed** (`exodus-ask` fence, `exodus://`) → the phone and desktop stop understanding each other. Pinned by Task 8's grep gate (kept list must still be present).
4. **The homepage download button finds no installer** between the rename and the first Actovia release. Pinned in Task 6 (matcher accepts both).
5. **The CLI can't launch an updated install still at `/Applications/Exodus.app`**. Pinned in Task 5 (falls back).

---

### Task 1: Desktop — the bundle is Actovia, the runtime name stays Exodus

**Files:** `forge.config.ts`; `packages/shared/src/constants/` (new `brand.ts` + package.json subpath export); `src/main/main.ts`; `src/main/lib/menu.ts`; `src/main/lib/tray.ts` (labels only if they use `app.name`); the `menu.json` catalogs (10 locales); test `tests/unit/main/brand-identity.test.ts`.

**Interfaces:** Produces `APP_DISPLAY_NAME = 'Actovia'` exported from `@exodus/shared/constants/brand`.

- [ ] **Step 1: Failing test** — `tests/unit/main/brand-identity.test.ts`:

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { APP_DISPLAY_NAME } from '@exodus/shared/constants/brand'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const forge = readFileSync(resolve(root, 'forge.config.ts'), 'utf8')

describe('brand identity', () => {
  it('keeps the runtime app name Exodus — the Keychain item, userData and the lock derive from it', () => {
    expect(pkg.productName).toBe('Exodus')
    expect(pkg.name).toBe('exodus')
    expect(forge).toContain("appBundleId: 'app.yancey.exodus'")
  })

  it('names the bundle Actovia', () => {
    expect(APP_DISPLAY_NAME).toBe('Actovia')
    expect(forge).toMatch(/\bname: APP_DISPLAY_NAME\b/)
  })

  it('never renames the app at runtime', () => {
    const main = readFileSync(resolve(root, 'src/main/main.ts'), 'utf8')
    expect(main).not.toMatch(/app\.setName\(/)
  })
})
```

Run `bunx vitest run tests/unit/main/brand-identity.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**
  - `packages/shared/src/constants/brand.ts`: `/** What a person sees. The runtime name (package.json productName) stays "Exodus": the Keychain item, userData and the single-instance lock derive from it (spec 2026-10-19 §2). */ export const APP_DISPLAY_NAME = 'Actovia'`; add the subpath export like the other constants.
  - `forge.config.ts` `packagerConfig`: `name: APP_DISPLAY_NAME` (import it by relative path `./packages/shared/src/constants/brand` — forge config is not built with the alias); `executableName: process.platform === 'win32' ? 'Exodus' : APP_DISPLAY_NAME` with a comment (Windows keeps `Exodus.exe`: a Squirrel update would leave an `Exodus.lnk` to a missing exe); MakerDeb / MakerRpm `bin: APP_DISPLAY_NAME` (update the comment above them: the executable follows `executableName` now). Keep `appBundleId`. Update the publisher to `owner: 'actovia-ai', name: 'actovia'`.
  - package.json: beside `"productName": "Exodus"` there is no comment syntax — add to `CLAUDE.md` (Task 3) and keep the test as the guard.
  - `src/main/main.ts`, after `app` is imported and before `ready` work: `app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME, applicationVersion: app.getVersion() })` and `app.userAgentFallback = app.userAgentFallback.replace(/\bExodus\//, \`${APP_DISPLAY_NAME}/\`)`.
  - `src/main/lib/menu.ts`: the app menu's `label: app.name` → `APP_DISPLAY_NAME`; give the `about`, `hide` and `quit` role items explicit labels: `mainT('menu:app.about', 'About {{name}}', { name: APP_DISPLAY_NAME })`, `menu:app.hide` ("Hide {{name}}"), `menu:app.quit` ("Quit {{name}}") — read menu.ts first and use its existing `mainT` pattern; add those three keys to `menu.json` in all 10 locales (authored translations). Any other `app.name` / `app.getName()` used as **display text** in `src/main` → `APP_DISPLAY_NAME` (grep `app.name\b|app.getName()`; leave uses that feed paths or ids).
  - Run the test → PASS; desktop gate; commit `feat(brand): the app is Actovia — the bundle, menus, About and user agent; the runtime name stays Exodus so the Keychain key, userData and the lock survive`.

### Task 2: Desktop — visible copy and the model's view of the product

**Files:** the 10 locales under `packages/shared/src/i18n/locales/`; `index.html`, `src/renderer/sub-apps/{quick-chat,searchbar,artifacts}/index.html`; hard-coded strings in `src/main` and `src/renderer`; model-facing prompts.

- [ ] **Step 1: Catalog values** — in every `packages/shared/src/i18n/locales/<id>/*.json`, replace the product name `Exodus` → `Actovia` **in values only** (a JSON-aware script: load, walk string values, `.replace(/Exodus/g, 'Actovia')`, write back with the file's indentation; never touch keys). Then special cases by hand: `exodus-cli` inside values → `actovia-cli`; `exodus update`/`exodus skills …` command examples → `actovia …`; `Scan with Exodus on your iPhone` → `Actovia`. Review the diff of `en` fully and spot-check two other locales (language-specific possessives/inflection, e.g. German "Exodus'" → "Actovias"/"von Actovia" — fix grammar where the name was inflected).
- [ ] **Step 2: Hard-coded copy** — grep `git grep -n "Exodus" -- src packages/shared/src ':!packages/shared/src/i18n'` and rename each **visible or model-facing** literal: the migration notification title (`src/main/lib/db/migrate.ts`), `'Exodus is running.'` (`server/app.ts`), approval summaries naming "Exodus's own API" (`ai/kernel/approval.ts` + their test expectations), `system-info.tsx` heading (use `APP_DISPLAY_NAME`) and its two link texts (repo `actovia-ai/actovia`, site `actovia.yancey.app`), `secrets/crypto.ts`'s keychain hint, `knowledge-base.tsx` / `s3.tsx` prose (these should be catalog strings — if they are hard-coded JSX the i18n test would fail, so they are inside `<Trans>` catalogs: covered by Step 1), the system prompt / PM prompt / tool descriptions that call the assistant "Exodus" (`ai/prompts.ts`, `philharmonic/*`, `calling-tools/*`). Leave comments, identifiers and the Keep list alone.
- [ ] **Step 3: HTML titles** — `index.html` `<title>Actovia</title>`; quick-chat / searchbar `<title>Actovia</title>`; artifacts `<title>Actovia Artifact</title>`.
- [ ] **Step 4: Tests** — update test expectations that assert the old visible strings (grep tests for the changed literals); do NOT change tests about kept identifiers.
- [ ] **Step 5:** desktop gate; commit `feat(brand): the copy says Actovia — every catalog, the window titles, notifications, the approval gate and what the model is told it is`.

### Task 3: Desktop — URLs, metadata, docs and brand assets

**Files:** `packages/shared/src/constants/external-urls.ts`; `package.json` (`homepage`, `repository`); `README.md`; `.github/PULL_REQUEST_TEMPLATE.md` (and any other `.github/*` with old links); `CLAUDE.md`; current (non-dated) docs: `docs/security-hardening.md`, `docs/manual-qa-checklist.md`, `docs/chat-api.md`, `docs/lightrag-setup.md`, `docs/migration-plan.md` (product name and URLs only); `scripts/render-icons.mjs`; regenerated `brand/web/*`.

- [ ] **Step 1: URLs** — `external-urls.ts`: website → `https://actovia.yancey.app`, repo → `https://github.com/actovia-ai/actovia`, CLI repo → `https://github.com/actovia-ai/cli`, npm → `https://www.npmjs.com/package/actovia-cli`; package.json `homepage` → `https://actovia.yancey.app`, `repository.url` → `git+https://github.com/actovia-ai/actovia.git`. `git grep -n "exodus-ai-org\|HyperChatBot\|exodus.yancey.app"` outside CHANGELOG and dated docs → update every hit (README badges: point at `actovia-ai/actovia`; drop links that pointed at the dead `HyperChatBot` org; CodeRabbit/FOSSA badges follow the repo).
- [ ] **Step 2: README** — title `# Actovia`, the introduction says Actovia (mention once: "formerly Exodus"), install/CLI lines `actovia-cli` / `actovia`, sibling repo links → `actovia-ai/*`.
- [ ] **Step 3: CLAUDE.md** — "Project Overview": Actovia (formerly Exodus); add a short "### Naming" section: the product is Actovia; internal identifiers that keep the old name and why (the Keep list in one paragraph, incl. `productName: "Exodus"` → Keychain/userData/lock, `APP_DISPLAY_NAME`, the Windows exe); update URLs and the CLI name (`actovia-cli` / `actovia`); leave internal names it documents. Keep `claude-md-freshness` / `claude-md-staleness` tests green.
- [ ] **Step 4: Current docs** — product name and URLs in the non-dated docs listed above; never in dated specs/plans.
- [ ] **Step 5: Brand** — `scripts/render-icons.mjs`: the og-image wordmark `Exodus` → `Actovia`, the web manifest `name` / `short_name` → `Actovia`; the header comment of `brand/art.mjs` ("the Exodus mascot" → "the Actovia mascot"). Run `bun run icons` (Playwright Chromium or Chrome); confirm `brand/web/og-image.png` shows "Actovia" (open it), commit the regenerated files. If `bun run icons` cannot run in this environment, say so in the report and still commit the script change.
- [ ] **Step 6:** desktop gate; commit `docs(brand): Actovia in the README, CLAUDE.md, current docs and links; the og-image wordmark and web manifest regenerated; the update feed and publisher move to actovia-ai/actovia`.

### Task 4: iOS

**Files (repo `exodus-ios/`):** `Project.swift`; `Widgets/Info.plist`; `Resources/App/Localizable.xcstrings`, `Resources/App/InfoPlist.xcstrings`; Swift `defaultValue` literals (`Sources/App/UnlockGate.swift`, `Sources/ChatFeature/ArtifactCard.swift`, `ComputerUseCardModel.swift`, `Sources/WidgetKitShared/AskExodusIntent.swift` title, `Sources/ChatFeature/ChatSidebarView.swift` `appName`); `Vendor/exodus-locales` (re-sync via the repo's script); `README.md`; tests asserting the old visible strings.

- [ ] **Step 1:** `Project.swift`: app target `productName: "Actovia"`; usage-description strings (camera, Face ID, Health share/update, local network, location, microphone, photos) say Actovia; keep `name: "ExodusIos"`, `bundleIdRoot`, activity type, URL name/scheme, app group. `Widgets/Info.plist` `CFBundleDisplayName` → `Actovia`.
- [ ] **Step 2:** xcstrings: a JSON-aware script replaces `Exodus` → `Actovia` in every localization **value** (`stringUnit.value`) of both catalogs — never keys; review the en diff and spot-check two locales for inflection.
- [ ] **Step 3:** Swift `defaultValue`s and the sidebar wordmark → Actovia; `AskExodusIntent`'s displayed title "Ask Actovia" (type name unchanged).
- [ ] **Step 4:** re-sync `Vendor/exodus-locales` from the desktop catalogs (Task 2 must be committed first) with the repo's documented script (README / `scripts/`), keeping the vendored folder's name.
- [ ] **Step 5:** README: title `# Actovia iOS`, links → `actovia-ai`, desktop repo path wording; keep build instructions.
- [ ] **Step 6:** `tuist generate` then build and test per README (e.g. `tuist test` or `xcodebuild … test` on a simulator); update tests that assert old visible strings (`Tests/L10nScriptTests` fixture sentence may stay — it is a fixture). Commit `feat(brand): the app and its widget are Actovia — the home-screen name, permission prompts and every string; bundle ids, app group, keychain, widget kinds and schemes stay`.

### Task 5: CLI → actovia-cli

**Files (repo `cli/`):** `package.json`; `src/cli.ts`; `src/commands/{open,update}.ts`; `src/lib/{open-app,updater,update-notifier,skills-sh-client}.ts`; `scripts/build-binaries.sh`; `README.md`; CI workflow(s) under `.github/workflows/` that publish/release; tests.

- [ ] **Step 1:** package.json `name: "actovia-cli"`, `bin: { "actovia": "dist/index.js" }` (no `exodus` alias); `homepage`/`repository`/`bugs` → `actovia-ai/cli` if present.
- [ ] **Step 2:** `.name('actovia')`, description `actovia-cli — launch Actovia, manage skills, and self-update`; open command copy (`Opened Actovia.`, `Actovia isn't installed. Download it: https://actovia.yancey.app`, `Launch the Actovia desktop app`); update copy (`npm install -g actovia-cli@latest`, `actovia update`); notifier hint `Run: actovia update`.
- [ ] **Step 3:** `updater.ts`: GitHub API repo `actovia-ai/cli`, registry lookup `actovia-cli`, asset names `actovia-${platform}-${arch}${suffix}`; `build-binaries.sh` outputs `actovia-*`; release workflow asset globs follow.
- [ ] **Step 4:** `open-app.ts`: macOS try `open -a Actovia`, then `open -a Exodus` (an updated install keeps `Exodus.app`); Windows keeps `Programs\Exodus\Exodus.exe` (desktop keeps `Exodus.exe`); Linux `command -v exodus` unchanged (desktop launcher from package.json `name`). Test: Actovia missing and Exodus present → launches Exodus; both missing → the not-installed message.
- [ ] **Step 5:** README install/usage (`npm i -g actovia-cli`, `actovia …`), links → `actovia-ai`. Keep `~/.exodus` and `EXODUS_SKILLS_BFF_URL`.
- [ ] **Step 6:** run the CLI's tests (`bun test` or per package.json) and its build; commit `feat!: the CLI is actovia-cli with the command actovia; it launches Actovia (or an install still named Exodus) and updates from actovia-ai/cli`.

### Task 6: Homepage

**Files (repo `homepage/`):** `app/layout.tsx`; `app/_components/{hero,download,footer,local-nav,iphone,privacy,run-story,highlights,shot,ody-icon}.tsx`; `app/_lib/{release,shots}.ts`; `README.md`; `LICENSE`; `app/opengraph-image.png`.

- [ ] **Step 1:** copy: title `Actovia — your assistant, on your own machine`, hero alt + wordmark, download "Get Actovia.", footer brand/text/"Actovia for iPhone"/copyright `Actovia`, nav aria-label + brand, iPhone, privacy, run story, highlights ("shared with the actovia command-line tool"), shots captions.
- [ ] **Step 2:** `metadataBase: new URL('https://actovia.yancey.app')`; footer GitHub → `https://github.com/actovia-ai`; `release.ts` URLs → `actovia-ai/actovia` (releases page, repo URL, API). README links.
- [ ] **Step 3:** `release.ts` asset matcher accepts `Actovia-` and `Exodus-` prefixes (until the first Actovia release); add or extend its unit test if one exists, else a small vitest/tsx test is out of scope — verify by reading and by `pnpm build`.
- [ ] **Step 4:** LICENSE `Copyright (c) 2025 Actovia`; copy `brand/web/og-image.png` from the desktop repo (Task 3) over `app/opengraph-image.png`.
- [ ] **Step 5:** `pnpm build` passes; commit `feat(brand): the site is Actovia at actovia.yancey.app — copy, links, release lookups (old Exodus installers still matched), og image`.

### Task 7: skills.md-bff and the org's .github

**Files:** `skills.sh-bff/README.md`, `skills.sh-bff/package.json`; `.github/profile/README.md`, `.github/{CONTRIBUTING.md,SECURITY.md,CODE_OF_CONDUCT.md}`.

- [ ] **Step 1:** BFF README line → "the Actovia desktop app"; package.json `name` `my-app` → `skills-md-bff`; its build/test still passes (per its package.json). Commit.
- [ ] **Step 2:** `.github/profile/README.md` — shown on github.com/actovia-ai:
  - `# Actovia` + one line: an AI assistant that runs on your own machine — chat, deep research, a knowledge base, multi-agent groups, coding-agent employees, computer use; with an iPhone companion.
  - The mascot: `<img src="https://raw.githubusercontent.com/actovia-ai/actovia/master/build/icon.png" width="96" alt="Actovia's mascot, Ody">` (check the path exists in the desktop repo).
  - A table of repositories: `actovia` (desktop app — Electron), `ios` (iPhone companion — SwiftUI), `cli` (`actovia-cli`: launch, skills, self-update), `homepage` (actovia.yancey.app), `skills.md-bff` (skills.sh relay).
  - Links: website, latest release (`https://github.com/actovia-ai/actovia/releases/latest`), license MIT.
  - One line on the name: "Actovia — act + via: the way of acting. Formerly Exodus."
- [ ] **Step 3:** copy the desktop repo's `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` into `.github/` with the product name and links updated (they become the org-wide defaults). Commit on `main` (first commit of the repo).

### Task 8: The grep gate

- [ ] For each repo, list remaining case-insensitive `exodus` hits outside history (`CHANGELOG.md`, dated `docs/superpowers/**`), lockfiles, `Vendor/`, generated `Derived/`, `.xcodeproj`, binaries: `git -C <repo> grep -niI exodus -- . ':!CHANGELOG.md' ':!docs/superpowers' ':!*lock*' ':!Vendor' ':!Derived'`.
- [ ] Classify every hit as Keep-list / code identifier / comment-about-internals (fine) or visible/URL (fix in the owning task's repo with a follow-up commit). Report the counts per repo and the list of anything fixed.
- [ ] Confirm the kept protocol markers are all still present (`exodus-ask`, `exodus-artifact://`, `exodus://pair`, `x-exodus-presence`, `app.yancey.exodus`, `"productName": "Exodus"`).
