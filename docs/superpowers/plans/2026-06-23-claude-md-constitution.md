# CLAUDE.md Constitution (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CLAUDE.md accurate and self-enforcing — correct every stale claim, document the missing features, add global constraints + a code-structure map, and back it with two cheap Vitest guards (path-freshness + stale-token denylist).

**Architecture:** TDD for docs — write two guard tests that encode the target state (they fail against today's stale CLAUDE.md), then rewrite CLAUDE.md until both guards + the full suite are green. The guards run in `pnpm test`/pre-commit so drift fails CI thereafter.

**Tech Stack:** Vitest, Node `fs` (no Electron/PGlite), Markdown.

**Spec:** `docs/superpowers/specs/2026-06-23-claude-md-constitution-design.md`

---

## File Structure

- `src/shared/meta/claude-md-freshness.test.ts` (new) — asserts every repo path in the "## Code Structure" section exists.
- `src/shared/meta/claude-md-staleness.test.ts` (new) — asserts no retired tokens; asserts the real AI dep is referenced (cross-checked vs `package.json`).
- `CLAUDE.md` (modify) — accuracy pass + Code Structure section + Project Constraints section.

> Both tests are placed under `src/**` so the Vitest config (`src/**/*.test.ts`) collects them. They read repo files via an absolute path from `__dirname`.

---

## Task 1: Write the two guard tests (red, do NOT commit yet)

**Files:**

- Create: `src/shared/meta/claude-md-freshness.test.ts`
- Create: `src/shared/meta/claude-md-staleness.test.ts`

> These tests will FAIL against the current (stale) CLAUDE.md. That is expected. **Do not commit in this task** — the pre-commit hook runs `pnpm test`, and committing genuinely-failing tests would either be blocked or require a bad `--no-verify`. They get committed together with the fixed CLAUDE.md in Task 2 (green).

- [ ] **Step 1: Create `src/shared/meta/claude-md-freshness.test.ts`**

```ts
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')

/** Extract the "## Code Structure" section (up to the next level-2 heading). */
function codeStructureSection(md: string): string {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => /^##\s+Code Structure\b/.test(l))
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

describe('CLAUDE.md code-structure freshness', () => {
  const section = codeStructureSection(claudeMd)

  it('has a Code Structure section', () => {
    expect(section.length).toBeGreaterThan(0)
  })

  it('every referenced repo path exists on disk', () => {
    const paths = [...section.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1].trim())
      // only concrete, single repo paths — skip prose, globs, brace-expansions
      .filter((p) => !/[{}*,()<>\s]/.test(p))
      .filter(
        (p) =>
          /^(src|tests|resources|docs)\//.test(p) ||
          p === 'electron.vite.config.ts' ||
          p === 'vitest.config.ts' ||
          p === 'playwright.config.ts'
      )
      .map((p) => p.replace(/\/$/, ''))
    const missing = paths.filter((p) => !existsSync(join(ROOT, p)))
    expect(
      missing,
      `Code Structure references paths that don't exist: ${missing.join(', ')}`
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Create `src/shared/meta/claude-md-staleness.test.ts`**

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** Retired claims that must never reappear in CLAUDE.md. */
const FORBIDDEN: RegExp[] = [
  /Vercel AI SDK/,
  /streamText/,
  /localhost:3000/,
  /~\/\.app\/Database/,
  /\/api\/setting\b/, // word boundary: does NOT match /api/settings
  /\/api\/workflow/,
  /\/api\/custom-uploader/,
  /calculator\.ts/
]

describe('CLAUDE.md staleness', () => {
  it('contains no retired tokens', () => {
    const hits = FORBIDDEN.filter((re) => re.test(claudeMd)).map(
      (re) => re.source
    )
    expect(
      hits,
      `retired tokens present in CLAUDE.md: ${hits.join(', ')}`
    ).toEqual([])
  })

  it('references the real AI dependency from package.json', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(deps['@mariozechner/pi-ai']).toBeTruthy()
    expect(claudeMd).toContain('@mariozechner/pi-ai')
  })
})
```

- [ ] **Step 3: Run them — confirm RED**

Run: `pnpm test src/shared/meta/claude-md-freshness.test.ts src/shared/meta/claude-md-staleness.test.ts`
Expected: FAIL — freshness "has a Code Structure section" fails (no section yet); staleness "contains no retired tokens" fails (current CLAUDE.md has `Vercel AI SDK`, `localhost:3000`, etc.).

Do not commit. Proceed to Task 2.

---

## Task 2: CLAUDE.md accuracy pass + Code Structure section (turn guards green, commit)

**Files:**

- Modify: `CLAUDE.md`
- (commits the two test files from Task 1 together)

This task rewrites the stale parts of CLAUDE.md and adds the Code Structure section. Re-verify each correction against the cited files before writing.

- [ ] **Step 1: Apply the factual corrections**

Edit CLAUDE.md so the following are correct (search the file for the old text; replace with the new):

- Hono server port: `localhost:3000` → `localhost:60223` (constant `SERVER_PORT` in `src/shared/constants/systems.ts`). Fix every occurrence (Electron process model, renderer comms, frontend "API Communication").
- DB location: `~/.app/Database` → `~/.actovia/database` (`src/main/lib/paths.ts` `getDatabaseDir`).
- AI stack: replace "Multi-Provider Support (via Vercel AI SDK v6)" and any `streamText()` references with: providers built on `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`; the chat route streams via `agentLoop` (`src/main/lib/server/routes/chat.ts`). Remove the `{ provider, chatModel, reasoningModel, embeddingModel }` Vercel snippet; describe the real provider shape (each provider file returns a `Model` via shared `resolveModel()` — see `src/main/lib/ai/providers/resolve-model.ts`).
- Server routes: replace the bullet list with the 17 real routes registered in `src/main/lib/server/app.ts`: `/api/chat, /api/lcm, /api/history, /api/project, /api/settings, /api/audio, /api/db-io, /api/deep-research, /api/tools, /api/philharmonic, /api/s3, /api/skills, /api/mcp, /api/memory, /api/usage, /api/logs, /api/backup, /api/artifacts`. Delete `/api/setting`, `/api/workflow`, `/api/custom-uploader`.
- Middleware pipeline: CORS → **lock gate (423 when locked)** → settings injection → error handler. Note MCP tools middleware is **archived**.
- MCP: change "Connects to MCP servers on startup" to note MCP server connection is **archived** (commented out in `app.ts`); an `/api/mcp` route + settings remain.
- Built-in tools: replace the invented list with the real files in `src/main/lib/ai/calling-tools/`: `create-artifact, deep-research, edit-file, find-files, grep, image-generation, lcm-describe, lcm-expand, lcm-grep, list-directory, map-itinerary, read-file, terminal, weather, web-fetch, web-search, write-file`. Remove `calculator.ts`, `date.ts`, `google-maps-places.ts`, `google-maps-routing.ts`, `rag.ts` if not present (verify with `ls src/main/lib/ai/calling-tools/`).
- Providers: fix mislabeled list — real files in `src/main/lib/ai/providers/`: `openai-gpt.ts, azure-openai.ts, anthropic-claude.ts, google-gemini.ts, xai-grok.ts, ollama.ts`. Note model lists live in `src/shared/constants/models.ts`.

- [ ] **Step 2: Add sections for undocumented features**

Add concise subsections (verify paths exist):

- **Philharmonic** (multi-agent "Groups"): `src/main/lib/ai/philharmonic/`, renderer `src/renderer/components/philharmonic/`, route `/api/philharmonic`, group workspaces under `~/.actovia/groups`.
- **App Lock**: `src/main/lib/lock/` (`pin-manager`/`lock-manager`, `pin-store` scrypt+safeStorage, `idle-watcher`), the `423` lock-gate middleware, IPC-only unlock, secret at `~/.actovia/lock.dat`.
- **LCM (lossless context management)**: `src/main/lib/ai/context-management/`, route `/api/lcm`.
- **Test-ID checkpoints**: `src/shared/constants/test-ids.ts` registry, the linkage test, release-only strip in `electron.vite.config.ts` (`STRIP_TEST_IDS=1`). (May already exist from the earlier convention task — keep/merge.)
- **Sub-apps**: `src/renderer/sub-apps/searchbar`, `src/renderer/sub-apps/quick-chat`, `src/renderer/sub-apps/artifacts`.

- [ ] **Step 3: Add the "## Code Structure" section**

Append this section (paths are concrete and checked by the freshness guard — verify each exists; adjust if the tree differs):

```markdown
## Code Structure

Main process:

- `src/main/index.ts` — app bootstrap, lifecycle, IPC + server startup
- `src/main/lib/server/app.ts` — Hono server + route registration
- `src/main/lib/server/routes/` — API route handlers
- `src/main/lib/server/middlewares/` — CORS, lock gate, error handler
- `src/main/lib/ai/providers/` — LLM provider resolution (`resolve-model.ts`)
- `src/main/lib/ai/calling-tools/` — built-in agent tools
- `src/main/lib/ai/philharmonic/` — multi-agent Groups
- `src/main/lib/ai/context-management/` — LCM
- `src/main/lib/ai/memory/` — memory + session summary
- `src/main/lib/lock/` — app lock (PIN, gate, idle)
- `src/main/lib/db/` — Drizzle schema + queries (PGlite)
- `src/main/lib/ipc.ts` — main-process IPC handlers
- `src/main/lib/paths.ts` — `~/.actovia` path helpers

Preload:

- `src/preload/index.ts` — context-isolated bridge

Renderer:

- `src/renderer/components/` — UI components
- `src/renderer/components/ui/` — shadcn primitives (reuse these)
- `src/renderer/components/lock/` — lock screen
- `src/renderer/components/philharmonic/` — Philharmonic UI
- `src/renderer/components/settings/` — settings
- `src/renderer/containers/` — page-level components
- `src/renderer/stores/` — Jotai atoms
- `src/renderer/hooks/` — React hooks
- `src/renderer/services/` — API call wrappers
- `src/renderer/lib/` — renderer utilities (ipc, stream-manager)
- `src/renderer/sub-apps/` — searchbar, quick-chat, artifacts entry points

Shared:

- `src/shared/types/` — cross-process types
- `src/shared/constants/` — constants (`models.ts`, `test-ids.ts`, `systems.ts`)
- `src/shared/schemas/` — Zod schemas
- `src/shared/utils/` — shared utilities

Tests & config:

- `tests/api/` — API integration (Playwright)
- `tests/e2e/` — Electron E2E
- `tests/providers/` — provider compatibility
- `tests/fixtures/` — Playwright fixtures (electron, api-client)
- `tests/helpers/` — test helpers
- `electron.vite.config.ts` — build config (incl. `data-testid` strip)
- `vitest.config.ts` — unit test config
- `playwright.config.ts` — E2E config

Docs:

- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans
```

- [ ] **Step 4: Run the guards + full suite — confirm GREEN**

Run: `pnpm test src/shared/meta/claude-md-freshness.test.ts src/shared/meta/claude-md-staleness.test.ts`
Expected: PASS (4 tests). If freshness lists a missing path, fix the path in the Code Structure section (or correct the tree). If staleness lists a token, remove the last stale reference.

Then: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit (tests + CLAUDE.md together → green state)**

```bash
git add src/shared/meta/claude-md-freshness.test.ts src/shared/meta/claude-md-staleness.test.ts CLAUDE.md
git commit -m "docs(claude-md): accuracy pass + code-structure map + guards"
```

End the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. The pre-commit hook runs the full suite; it should be green now. The known flaky PGlite teardown in `context-management/index.test.ts` is the ONLY acceptable reason to `--no-verify`.

---

## Task 3: Add the "Project Constraints (read first)" section

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert the constraints section near the top**

Add this section immediately after the "## Project Overview" section:

```markdown
## Project Constraints (read first)

These rules are mandatory. Some are automated (noted); the rest are conventions
you must uphold.

- **Tests + checkpoints with UI.** When adding a key interactive element, add a
  `TEST_IDS` entry (`src/shared/constants/test-ids.ts`) + `data-testid`, and
  reference it from a Playwright test. Test ids are a durable contract — never
  rename or regenerate an existing id. _Enforced by `test-ids.linkage.test.ts`._
- **Pre-commit gate.** Before committing, `pnpm format` → `pnpm lint` →
  `pnpm typecheck` → `pnpm test` must pass. _Enforced by the husky pre-commit
  hook._ Do not `--no-verify` except for the known flaky PGlite WASM teardown in
  `src/main/lib/ai/context-management/index.test.ts`.
- **Reuse UI primitives.** Prefer existing `@/components/ui` (shadcn) components
  over hand-rolled equivalents (e.g. shadcn `Select`, `InputOTP`).
- **Copy language.** New user-facing strings default to English.
- **Keep this file current.** Any change to architecture, routes, or directory
  structure updates CLAUDE.md in the same change. _Partly enforced by
  `claude-md-freshness.test.ts` (paths) and `claude-md-staleness.test.ts`
  (retired claims)._
- **Models & providers.** Use the shared `resolveModel()`
  (`src/main/lib/ai/providers/resolve-model.ts`); selectable model lists live in
  `src/shared/constants/models.ts`.
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm test src/shared/meta/claude-md-staleness.test.ts src/shared/meta/claude-md-freshness.test.ts`
Expected: still PASS (adding constraints introduces no retired tokens and no new paths outside Code Structure). Then `pnpm lint` (markdown formatting via oxfmt may apply).

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): add Project Constraints (read first) section"
```

(End body with the Co-Authored-By line; `--no-verify` only for the flaky PGlite teardown.)

---

## Self-Review Notes (author)

- **Spec coverage:** accuracy pass (T2 S1-2), code-structure map (T2 S3), global constraints (T3), durability guards — freshness (T1/T2) + staleness denylist incl. package.json cross-check (T1/T2). Existing pre-commit hook + linkage test referenced in the constraints, not rebuilt. SP2 explicitly out of scope (spec).
- **TDD ordering:** guard tests written first (T1, red, uncommitted), CLAUDE.md fixed to green, committed together (T2) so no commit is ever in a red state (avoids the pre-commit-blocks-failing-tests trap).
- **Guard correctness:** `/api/setting\b` won't false-match `/api/settings`; freshness filters out brace/glob/space spans so prose and `{a,b}` groups aren't checked; both tests are pure `fs` (no Electron/PGlite import) and live under `src/**` so Vitest collects them.
- **Risk:** the Code Structure paths in T2 S3 are asserted by the freshness test — if any listed dir doesn't exist, the test fails loudly and the implementer corrects it (the test is the safety net).
- **Type consistency:** both tests resolve `ROOT` as `join(__dirname,'..','..','..')` from `src/shared/meta/` → repo root; `@mariozechner/pi-ai` is the dep name used in both the staleness test and the accuracy-pass prose.
