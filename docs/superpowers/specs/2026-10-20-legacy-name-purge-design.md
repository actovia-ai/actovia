# Legacy-name purge and the owner's local data move

Date: 2026-10-20 · Status: design agreed in chat (owner, 2026-10-20); spec for the owner's review
Repos: `actovia` (desktop), `ios`, `cli`, `homepage`, `skills.md-bff`, `.github` (org `actovia-ai`)

This spec never spells the product's previous name. It calls it **the legacy name**; the exact strings
live only in the untracked migration script (§4) and in git history.

## 1. Goal

After this change no repository mentions the legacy name anywhere except `CHANGELOG.md` files —
not in code, identifiers, tests, docs, file or folder names, migrations or AI context — so no person or
AI is misled into treating it as current. The owner's own data (the only install) moves to the new
names intact.

### Decided by the owner (2026-10-20)

| Decision         | Choice                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope            | Everything except `CHANGELOG.md`: code, identifiers, data paths, bundle ids, Keychain item, protocol markers, DB values, docs (dated specs/plans too), file/folder names, Claude's project memory |
| Existing data    | **One-off migration for the owner's Mac only** — no migration code in any app (nobody else uses it)                                                                                               |
| Stored chat text | Functional references are rewritten (code-fence markers, data-dir paths, the DB enum value); ordinary words in conversations stay as written                                                      |
| Backup           | The old data directory and Application Support folder are copied before the move and kept until the owner confirms                                                                                |
| Wording          | No "formerly …" anywhere                                                                                                                                                                          |

## 2. The owner's manual rename

The owner has renamed most identifiers by hand (uncommitted, ~750 files in the desktop repo, ~150 in
iOS, ~16 in the CLI, 1 in the homepage): the shared package is `@actovia/shared`, the data dir
`~/.actovia`, env vars `ACTOVIA_*`, the bundle id `app.yancey.actovia`, `productName: "Actovia"`, the
fences `actovia-*`, the helper `actovia-input`, and so on. Work starts by verifying it (every repo's
checks green), fixing what it broke, and committing it — never redoing or reverting it.

## 3. What is left in the repositories

- Desktop: `docs/` (current docs and the dated `docs/superpowers/{specs,plans}`), CLAUDE.md, the old
  Drizzle migration that created the agent-runtime enum and its snapshots (`resources/drizzle/0015*`,
  `meta/*_snapshot.json`), tests and fixtures, file and folder names.
- CLI: remaining source, tests and docs.
- iOS / homepage / skills relay / `.github`: whatever a full grep (content **and** paths) still finds.

Rules:

- Context-aware replacement (product name, org, CLI package `@actovia-ai/cli`, paths, identifiers);
  sentences that only make sense about the rename are rewritten or dropped.
- The previous rename's own spec and plan (2026-10-19) are deleted — they are about the legacy name
  and nothing else; git history keeps them.
- Applied Drizzle migrations are edited in place so a fresh database creates `'actovia'` directly.
  The migrator chooses what to run by timestamp and does not verify file contents, so existing
  databases are unaffected; the owner's database is renamed by the script (§4). No new migration.
- The gate: `git grep -niI <legacy>` and `git ls-files | grep -i <legacy>` return nothing outside
  `CHANGELOG.md` in every repo.

## 4. The owner's data — one-off script

An untracked script in Claude's scratchpad, run once with every Actovia/legacy process quit:

1. Back up the legacy data dir and `~/Library/Application Support/<legacy>` (copies, dated).
2. Move the data dir to `~/.actovia`; copy Application Support to `~/Library/Application Support/Actovia`.
3. Secrets: read the legacy Keychain item `"<legacy> Safe Storage"` once (the owner allows the macOS
   prompt), decrypt every `enc:v1:` value with Chromium's v10 scheme (PBKDF2-SHA1, salt `saltysalt`,
   1003 iterations, AES-128-CBC, IV of 16 spaces) — settings and MCP rows in the database, the PIN file,
   the LAN TLS private key — and re-encrypt them under a new `"Actovia Safe Storage"` item created the
   way Electron creates it (account `"Actovia Key"`, random password).
4. Database (PGlite, the repo's own driver): rename the agent-runtime enum value; rewrite the legacy
   fence markers and data-dir paths in stored content (messages, conversation messages, summaries,
   round events, sources) — functional references only.
5. Agent projects: each registered project folder's legacy meta dir becomes `.actovia/`; the projects
   folder follows the new default if the code changed it, with DB paths updated.
6. Verify by launching a dev build: secrets-status shows encryption on with nothing to re-enter, chats /
   memories / skills present, the PIN unlocks. Only then is the legacy Keychain item deleted; the
   backups stay until the owner removes them.
7. iPhone: the bundle id changed, so the owner installs the new app, pairs again and deletes the old one.

## 5. iOS CHANGELOG

The iOS repo gets the release pipeline the desktop and CLI have: semantic-release on pushes to
`main` (GitHub Actions) with the commit analyzer, release notes, `@semantic-release/changelog`,
an exec step that writes the version into `MARKETING_VERSION` (Project.swift), `@semantic-release/git`
(CHANGELOG + Project.swift) and `@semantic-release/github` (tag + release, no assets). The first
release continues from the current `MARKETING_VERSION`.

## 6. Claude's project memory

The memory under `~/.claude/projects/-Users-yanceyleo-Code-actovia-actovia/memory/` is AI context: its
files and index are rewritten in the new name (facts kept, legacy names gone), and the session folder
left at the old path is deleted after this session.

## 7. Order

1. Verify and commit the owner's manual rename (per repo, checks green).
2. Purge the remainder (desktop docs/migrations/tests/paths, CLI, any path names) — commits per repo.
3. iOS CHANGELOG pipeline.
4. Grep gate across all repos (content + paths).
5. The owner's data script — run together with the owner (Keychain prompt), then verify.
6. Memory rewrite. 7. Push, after asking the owner.
