# Skills Market on skills.sh — Design

Date: 2026-09-19
Status: Approved (autonomous session), implemented in the same branch

## Summary

Actovia's Skills Market moves off ClawHub (dropped for quality reasons; the
settings tab has been a placeholder since the Forge migration) onto
**skills.sh**, the open Agent Skills registry. The integration was already
proven in `@actovia-ai/cli` (`../cli`): a small BFF relay
(`https://skills-md.yancey.app`, `/api/v1/skills…`) fronts skills.sh, skills
install as plain files into `~/.actovia/skills/<slug>/` and are recorded in
`~/.actovia/skills/.lock.json`. This design ports that client + store into the
main process behind the existing `skills-manager.ts` seam, adds a
`/api/v1/skills` route, and rebuilds the Settings → Skills Market page as a
GUI with the same flows as the CLI's TUI: browse (Trending / Hot / All time),
search, open a detail page with the security audit and README, install,
toggle, uninstall. Every detail page also shows the equivalent `@actovia-ai/cli`
command, and the page ends with a callout recommending the CLI.

## Goals

- Browse the registry by view (`all-time` | `trending` | `hot`) with paging,
  and search it (fuzzy/semantic, server-side).
- Open a skill: name, source repo, install count, the per-provider security
  audit (Gen Agent Trust Hub, Socket, Snyk, Runlayer, ZeroLeaks), the rendered
  `SKILL.md`, the list of bundled files.
- Install / uninstall / toggle-active; installed skills are injected into the
  chat and Philharmonic system prompts again (the seam's three functions come
  back to life).
- Byte-for-byte compatibility with `@actovia-ai/cli`: same directory, same
  lockfile shape (`source?: "skills.sh"` is the only field the CLI added), so
  a skill installed either way shows up in both.
- Recommend `@actovia-ai/cli` in the UI: the exact `actovia skills install <id>`
  command on every detail page (copyable) and a footer notice with the
  install one-liner.

## Non-goals

- Local zip/folder installs (the old ClawHub UI had them; the CLI does not,
  and the `select-skill-path` IPC handler was never ported — the dangling
  renderer wrapper is removed).
- A settings field for the BFF URL. `ACTOVIA_SKILLS_BFF_URL` (main process
  env) overrides the constant, exactly as in the CLI.
- Skill authoring/publishing, ratings, or a second registry.

## Architecture

```
renderer (Settings → Skills Market)
  components/skills-market/*  ── services/skills.ts ──▶  /api/v1/skills/*
                                                              │
main process                                                  ▼
  server/routes/skills.ts ──▶ ai/skills/skills-sh-client.ts ──▶ skills.sh BFF
                          ──▶ ai/skills/skills-store.ts     ──▶ ~/.actovia/skills
  ai/skills/skills-manager.ts (seam: chat + Philharmonic prompts) ──▶ store
```

- **`skills-sh-client.ts`** — `listSkills({view,page,perPage})`,
  `searchSkills(q,{limit})`, `getSkillDetail(id)`, `getSkillAudit(id)`
  (404 → `null`). Non-2xx → `SkillsApiError(status, message)`.
- **`skills-store.ts`** — lockfile read/write, `installSkill(detail)` (writes
  `files[]` under the slug dir, refuses paths that escape it, writes the
  lockfile last), `uninstallSkill`, `toggleSkillActive`,
  `listInstalledSkills`. `skillsDir` is injectable for tests.
- **`skills-manager.ts`** — the seam consumers already call:
  `listInstalledSkills()`, `getSkillsContentBySlugs()`,
  `getActiveSkillsContent()`. Restored from the universal-client
  implementation: strip `SKILL.md` frontmatter, bake `$SKILL_DIR` into the
  absolute install path, wrap in `<active_skills><skill name=…>`.
- **`routes/skills.ts`** (`/api/v1/skills`):
  `GET /registry?view&page&per_page`, `GET /search?q&limit`,
  `GET /detail?id`, `GET /audit?id` (`null` when unaudited),
  `GET /installed`, `POST /install {id}`, `DELETE /:slug`,
  `PATCH /:slug/toggle {isActive}`. Registry failures map to
  `SERVICE_SKILLS_REGISTRY_FAILED` (503), 404 → `SKILL_NOT_FOUND`,
  429 → `RATE_LIMIT_SKILLS`. Ids are query params because a skill id is
  `owner/repo/slug` (three path segments).

## UI

One settings page, `max-w-3xl`, two tabs.

- **Discover** (styled after skills.sh's own leaderboard, per the user's
  reference screenshot): an underline-only search field with a `/` shortcut;
  text tabs "All time (total) / Trending (24h) / Hot"; a ranked hairline-row
  table — rank, bold name with the mono `owner/repo` beside it, today's
  delta on Hot/Trending, right-aligned mono install count with a check mark
  when installed. Consecutive rows from one repo collapse behind a "+N more
  from owner/repo (total)" toggle so a hot repo can't fill the page. "Load
  more" appends the next page; typing switches the table to search results
  with a result count.
- **Detail** (replaces the table, with a back button): name, source, installs,
  links to skills.sh and the source repo; the primary Install button (or
  Installed + active switch + Uninstall once installed); the **security
  audit** — a summary line ("4 of 5 checks passed") and one row per provider
  with a pass/warn/fail mark, risk level, summary and check date — this is
  the page's one bold element, since audit quality is why skills.sh replaced
  ClawHub; the copyable `$ actovia skills install <id>` command box (skills.sh's "Try
  it now" treatment); the rendered README; a collapsible file list. Section
  headings are small tracked mono labels, as on skills.sh.
- **Installed**: rows with the display name, slug, version (hash), source
  badge (skills.sh / Legacy), install date, an active switch and an uninstall
  button with a confirm dialog.
- Footer notice on both tabs recommending `@actovia-ai/cli`.

Empty and error states give a next step ("Couldn't reach skills.sh. Check
your connection, then retry.").

## Testing

- Unit: client (mocked `fetch`), store (temp dir), manager (prompt block
  shape), route (bare Hono app with mocked client/store), i18n render tests
  for the two `<Trans>` components.
- E2E (`tests/e2e/settings-skills-market.spec.ts`): opens the tab, waits for
  cards (skips if the registry is unreachable), opens a detail page, checks
  the audit panel and CLI command, installs, verifies the Installed tab,
  uninstalls. Every new `TEST_IDS.skillsMarket.*` id is referenced there.
