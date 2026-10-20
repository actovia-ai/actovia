# Legacy-Name Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No repository mentions the legacy product name outside `CHANGELOG.md` (content and paths), the owner's manual rename is verified and committed, iOS gets a CHANGELOG pipeline, and the owner's data moves to the new names once.

**Architecture:** Per-repo commits on master/main on top of the owner's uncommitted manual rename; a context-aware sweep of what remains; a semantic-release pipeline for iOS; an untracked one-off migration script for the owner's Mac.

**Tech Stack:** Bun, TypeScript, Electron Forge, Drizzle/PGlite, Swift/Tuist, semantic-release, Next.js.

**Spec:** `docs/superpowers/specs/2026-10-20-legacy-name-purge-design.md`

## Global Constraints

- `<legacy>` below means the previous product name; the controller gives the literal in each dispatch. This plan and every file in the repos must never spell it (except `CHANGELOG.md`).
- Repos: `/Users/yanceyleo/Code/actovia/{actovia (master), ios (main), cli (main), homepage (main), skills.md-bff (main), .github (main)}`. Commit on those branches; never push (the controller asks the owner).
- The owner's uncommitted changes are the base: verify, fix breakages, commit — never revert or redo them. Stage only files you touched or verified.
- Replacement is context-aware: product name → Actovia, org → `actovia-ai`, CLI package → `@actovia-ai/cli`, data dir → `~/.actovia`, env vars → `ACTOVIA_*`, identifiers → their `actovia`/`Actovia` form; sentences only meaningful about the rename are rewritten or dropped; never "formerly …".
- Desktop gate before a commit: `bun run fmt && bun run lint && env PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck && bun run i18n:check && bun run test` (a lone PGlite `Aborted()`/`ErrnoError`, or a timing flake that passes alone, may be re-run once). The hook runs `vitest related` on staged files.
- iOS gate: `tuist generate`, build for an iOS Simulator, run the test plans the README documents; shut simulators down afterwards (`xcrun simctl shutdown all`).
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate (final): in every repo `git grep -niI <legacy> -- . ':!CHANGELOG.md'` and `git ls-files | grep -i <legacy>` return nothing.

## Review Focus

1. **A rename that compiles but breaks at runtime** (a bundle looked up by name, a resource path, a helper binary path, an env var read elsewhere). Pinned by the full test suites and builds in Tasks 1–3.
2. **A rename applied to an applied migration that changes schema meaning** (only the enum value text may change). Pinned in Task 4 by a fresh-database migration test.
3. **Generated files edited by hand** (icons, Xcode projects, lockfiles) instead of regenerated. Pinned by regenerating in Tasks 3–4.

---

### Task 1: Desktop — verify and commit the owner's rename

- [ ] Read `git status` / `git diff --stat`; run the full desktop gate.
- [ ] Fix only what the rename broke (tests asserting old strings, a missed import, a renamed path the code still reads); keep the owner's choices.
- [ ] Rebuild the helper if its source moved (`bun run build:helper`) and check `resources/bin/` holds the renamed binary the code expects.
- [ ] `bun run package` once and read the bundle: `CFBundleName`/`CFBundleIdentifier` (`app.yancey.actovia`), `app.asar` package.json `productName` `Actovia`.
- [ ] Commit (the owner's rename + fixes) as `refactor!: …` with a body summarising the renamed identifiers.

### Task 2: CLI — verify, finish, commit

- [ ] Run `bun test` (TUI tests are known-flaky: re-run once), typecheck, `build:npm`.
- [ ] Finish every remaining `<legacy>` hit in source, tests and docs (data dir `~/.actovia`, env vars, launcher names: macOS `open -a Actovia`, Windows `Programs\Actovia\Actovia.exe`, Linux `actovia`/`Actovia` — no legacy fallbacks), file names.
- [ ] Commit.

### Task 3: iOS — verify, finish, commit

- [ ] Run the iOS gate on the owner's changes; fix what broke.
- [ ] Rename remaining paths: the vendored locales folder (`Vendor/<legacy>-locales` → `Vendor/actovia-locales`) and every script/test/README that names it; any `<legacy>`-named type, file or target (e.g. widget bundle/intent types), keeping the build green; regenerate with Tuist.
- [ ] Commit.

### Task 4: Desktop — the remainder

- [ ] Delete `docs/superpowers/specs/2026-10-19-actovia-rebrand-design.md` and `docs/superpowers/plans/2026-10-19-actovia-rebrand.md`.
- [ ] `resources/drizzle/0015_coding_agents.sql` and every `meta/*_snapshot.json`: the enum value becomes `'actovia'`. Add a test that a fresh `createMigratedPglite('9999')` has `agent_runtime` = `{actovia, claude-code, codex}` and the default `'actovia'`.
- [ ] File and folder names (`git ls-files | grep -i <legacy>`): rename with `git mv` (e.g. `brand/<Legacy>.icon` → `brand/Actovia.icon`, and every script that names it; regenerate with `bun run icons` if the script reads it).
- [ ] CLAUDE.md: rewrite its naming section without a legacy keep-list (internal names are now all Actovia); fix every other mention.
- [ ] Every doc under `docs/` (current and dated): context-aware replacement.
- [ ] Desktop gate; commit (docs may be a separate commit from code/migrations).

### Task 5: homepage, skills relay, .github

- [ ] Commit the homepage's pending change after `pnpm build`; grep content and paths in all three; fix and commit.

### Task 6: iOS CHANGELOG pipeline

- [ ] Add `.releaserc.json` (branches `main`; plugins: commit-analyzer, release-notes-generator, `@semantic-release/changelog` → `CHANGELOG.md`, `@semantic-release/exec` with a `prepareCmd` that writes `${nextRelease.version}` into `MARKETING_VERSION` in `Project.swift`, `@semantic-release/git` with assets `CHANGELOG.md` + `Project.swift` and message `chore(release): ${nextRelease.version} [skip ci]`, `@semantic-release/github` without assets).
- [ ] Add `.github/workflows/release.yml` (push to main, ubuntu-latest, Node LTS, `npx semantic-release` with the needed plugins installed, `GITHUB_TOKEN`, `permissions: contents: write`).
- [ ] Tag the current `MARKETING_VERSION` as the baseline (`v<version>`) locally so the first release continues from it (the controller pushes the tag with the branch).
- [ ] Dry-run locally: `npx semantic-release --dry-run --no-ci` (no token → it stops before publishing; confirm the computed next version and notes). Commit.

### Task 7: Grep gate

- [ ] Run the final gate in all six repos; fix stragglers in the owning repo; report counts (must be 0).
