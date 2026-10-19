# Exodus → Actovia — the rename, across every repo

Date: 2026-10-19 · Status: design agreed in chat (owner, 2026-10-19); spec for the owner's review
Repos: `actovia` (was `exodus`, desktop), `ios`, `cli`, `homepage`, `skills.md-bff`, `.github` — GitHub org
`actovia-ai` (was `exodus-ai-org`); site `https://actovia.yancey.app` (was `exodus.yancey.app`).
Reference: the inventory of 2026-10-19 (every "exodus" by repo and kind) and the Electron 44.5.1 naming
probe of the same day (throwaway Keychain items, deleted).

## 1. Why and what

"Exodus" is taken on the App Store. The product becomes **Actovia** — a coined word: _act / active_ +
_via_, "the way of acting".

### Decided by the owner (2026-10-19)

| Decision               | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depth                  | **Everything a person sees** becomes Actovia. **Internal identifiers that hold data or pair devices stay**: bundle ids `app.yancey.exodus` / `app.yancey.exodus.ios`, `~/.exodus`, `EXODUS_*` env vars, the macOS Keychain item, localStorage keys, the `exodus://` and `exodus-artifact://` schemes, the `exodus-*` fence names and `x-exodus-presence` header (the desktop–iOS–model protocol), the iOS app group / keychain service / widget kinds, the DB enum value `'exodus'`, test ids |
| Code names             | **Kept**: `@exodus/shared`, `getExodusHome`, `ExodusIos`, `ExodusApp`, … — no one sees them                                                                                                                                                                                                                                                                                                                                                                                                   |
| History                | **Kept as written**: CHANGELOG, dated specs/plans, commit messages                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CLI package / command  | **Scoped npm package `@actovia-ai/cli`** (npm has no rename; owner, 2026-10-20: npm org `actovia-ai`, scoped package), command **`actovia`** — no `exodus` alias: nobody uses the CLI yet. The owner unpublishes `exodus-cli` after the first `@actovia-ai/cli` publish, and the copy installed on the owner's Mac is removed now                                                                                                                                                             |
| Remotes, push, folders | Remotes → `actovia-ai`; one push of every master at the end; local folders take the GitHub names                                                                                                                                                                                                                                                                                                                                                                                              |

### Non-goals

- Renaming code identifiers, protocol markers or stored data.
- Rewriting history (CHANGELOG, specs, commits).
- Moving `~/.exodus` or re-keying secrets.
- Renaming the Cloudflare worker `exodus-homepage` (a new worker and URL; the owner can do it in
  Cloudflare) or the `~/Exodus Projects` folder agents work in (it holds existing projects).

## 2. Desktop — the name without losing a byte

Electron derives three persistent things from its **runtime app name** (`app.getName()`), which it reads
from package.json `productName` before any app code runs (Electron 44.5.1 source + probe):

- the macOS Keychain item `"<name> Safe Storage"` that encrypts every secret, the app-lock PIN and the
  LAN certificate's key (Linux: the libsecret entry of the same name);
- userData `~/Library/Application Support/<name>` (Windows: `%APPDATA%\<name>`, whose `Local State`
  holds the DPAPI-wrapped key);
- the single-instance lock.

So: **package.json `productName` stays `"Exodus"`** (and `name: "exodus"`), and the bundle is named by
the packager:

- `forge.config.ts` `packagerConfig.name: 'Actovia'` → `Actovia.app`, `CFBundleName`, menu-bar title,
  Dock, Finder, Activity Monitor (`Actovia Helper (Renderer)`), notification sender, Login Items, the
  standard About panel, and the release assets (`Actovia-<ver>-arm64.dmg`, `Actovia-darwin-…zip`,
  `Actovia-<ver> Setup.exe`, deb/rpm).
- `executableName: 'Actovia'` on macOS and Linux; **Windows keeps `Exodus.exe`** (a Squirrel update
  would otherwise leave an `Exodus.lnk` pointing at a missing exe) — its window titles and installer
  title still read Actovia.
- Linux deb/rpm `bin: 'Actovia'`.
- A comment beside `productName` says why it must not change, and a unit test pins it.

What still says "Exodus" through `app.name` gets an explicit name (`APP_DISPLAY_NAME = 'Actovia'` in
`@exodus/shared/constants`):

- the app menu's About / Hide / Quit roles → explicit labels from `menu:` catalog keys;
- `app.setAboutPanelOptions({ applicationName: 'Actovia' })`;
- `app.userAgentFallback` with `Actovia/<version>` in place of `Exodus/<version>`.

Visible copy:

- every catalog value in the 10 locales (`Exodus` → `Actovia`; key names such as `menu:tray.quitExodus`
  stay);
- hard-coded strings: the migration notification title, `'Exodus is running.'`, the approval-gate
  summaries ("Actovia's own API"), `system-info.tsx`, `secrets/crypto.ts`'s keychain hint, the HTML
  `<title>`s (main, quick-chat, searchbar, `Actovia Artifact`);
- model-facing text that names the product (system prompt, PM prompt, tool descriptions) — the model
  is told it is Actovia.

URLs and metadata:

- `external-urls.ts`: website `https://actovia.yancey.app`, repo `https://github.com/actovia-ai/actovia`,
  CLI repo `https://github.com/actovia-ai/cli` (npm link per the CLI decision);
- package.json `homepage` / `repository`; forge publisher `owner: 'actovia-ai', name: 'actovia'`;
- README (title, badges — drop the dead HyperChatBot links —, copy), `.github/PULL_REQUEST_TEMPLATE.md`;
- CLAUDE.md: the product name and current URLs (internal names it documents stay).

Brand assets: `scripts/render-icons.mjs` draws the og-image wordmark and the web manifest names →
`Actovia`; `bun run icons` regenerates `brand/web/*` (the mascot art has no text). `brand/Exodus.icon` is
a file name and stays.

Updates for existing installs: the update feed follows the forge publisher, now `actovia-ai/actovia`.
Installed builds still ask for `exodus-ai-org/exodus`; GitHub redirects a renamed org's repositories
while the old name is not reused, so they find the new releases. The owner decides whether to claim `exodus-ai-org` as an empty placeholder (it stops a squatter from publishing "updates" to installed builds, at the cost of those builds no longer finding new releases).
In-place updates (signed builds) keep the folder name `Exodus.app` with Actovia inside; manual-mode
users who drag in `Actovia.app` should delete `Exodus.app` (release notes say so).

## 3. iOS

- `Project.swift`: the app target's `productName` → `Actovia` (the home-screen name); the widget
  extension's `CFBundleDisplayName` → `Actovia`; the usage strings (camera, Face ID, Health, local
  network, location, microphone, photos) say Actovia.
- `Localizable.xcstrings` / `InfoPlist.xcstrings` values in every locale; Swift `defaultValue`s
  (`UnlockGate`, `ArtifactCard`, `ComputerUseCardModel`, `AskExodusIntent`'s title "Ask Actovia",
  `ChatSidebarView`'s wordmark); `Vendor/exodus-locales` re-synced from the desktop catalogs by the
  existing script.
- Kept: `ExodusIos` (the generated bundle names `ExodusIos_ChatFeature.bundle` are looked up by name),
  bundle ids, app group, keychain service, `exodus.serverURL`, widget kinds, schemes, fences.
- README.

## 4. CLI

- Visible copy: `Opened Actovia.`, `Actovia isn't installed. Download it: https://actovia.yancey.app`,
  the command descriptions, update hints.
- Launching the desktop app tries `Actovia` then `Exodus` (an updated install keeps `Exodus.app` on
  disk): macOS `open -a`, Windows `Programs\Exodus\Exodus.exe` (unchanged, §2), Linux launcher `exodus`
  (from package.json `name`, unchanged).
- Release lookups → `actovia-ai/cli`.
- package.json `name: "@actovia-ai/cli"` (+ `publishConfig.access: public`), `bin: { actovia }` (→ `dist/index.js`); the program name in help is `actovia`; release assets `actovia-<platform>-<arch>[.exe]` (`scripts/build-binaries.sh`, `updater.ts`); the updater asks the registry for `@actovia-ai/cli` and GitHub for `actovia-ai/cli`; README install lines `npm i -g @actovia-ai/cli`.

## 5. Homepage

- Copy (title, hero wordmark, nav, footer, download, iPhone, privacy, highlights, run story, shots'
  captions), `metadataBase` `https://actovia.yancey.app`, GitHub links → `actovia-ai`, release API →
  `actovia-ai/actovia`, LICENSE holder.
- The release-asset matcher accepts `Actovia-…` and still `Exodus-…` (the latest release until the first
  Actovia one).
- `app/opengraph-image.png` ← the regenerated `brand/web/og-image.png`.
- Kept: `wrangler.jsonc` worker name.

## 6. skills.md-bff

- README line; package.json `name` `my-app` → `skills-md-bff`.

## 7. `.github` — the org's front door

The repository is empty. It gets `profile/README.md` (shown on github.com/actovia-ai): Actovia in a
sentence, the mascot, what is in each repo (desktop, iOS, CLI, homepage, skills relay), links to the
site and releases. Default community files (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`)
move here from the desktop repo so every repo shares them; the desktop keeps its own copies until the
next cleanup.

## 8. Order, checks and the push

1. Per repo, one or a few commits on master/main; each repo's own checks pass (desktop: fmt, lint,
   typecheck, i18n:check, **`bun run test` run by hand** — the pre-commit hook does not run tests;
   iOS: `tuist generate` + build + tests; cli: its tests; homepage: `pnpm build`).
2. A grep gate per repo: no "exodus" left outside history, the kept-identifier list and code names.
3. **Before pushing, ask the owner**: pushing the desktop master runs the release workflow — with
   `osxSign: {}` committed and no Developer ID in CI yet, the macOS build may fail; pushing the CLI's
   main publishes `@actovia-ai/cli` to npm.
4. Rename the local folders (`~/Code/exodus` → `~/Code/actovia`; `exodus` → `actovia`, `exodus-ios` →
   `ios`, `skills.sh-bff` → `skills.md-bff`); fix scripts and docs that point at `../exodus` /
   `../exodus-ios`; move Claude's project memory to the new path's key.
