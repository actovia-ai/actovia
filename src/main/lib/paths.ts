import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { app } from 'electron'

/**
 * `~/.exodus` — packaged and unpackaged (dev) builds alike, so a dev build
 * sees the same chats, settings and memories as the real app. Actovia is the
 * successor of `universal-client`, which uses this same directory.
 *
 * PGlite is single-process: never run two Actovia processes (a dev build, the
 * packaged app, universal-client) against one data directory at the same
 * time — the database can be corrupted. Backups live in `~/.exodus/backups`.
 *
 * `EXODUS_HOME` points a run at another directory instead (e.g. a scratch
 * dir); the e2e suite gets the same effect by sandboxing `$HOME`.
 */
export function getExodusHome(): string {
  return process.env.EXODUS_HOME || join(homedir(), '.exodus')
}

export function getDatabaseDir(): string {
  return join(getExodusHome(), 'database')
}

export function getLogsDir(): string {
  const dir = join(getExodusHome(), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getArtifactsDir(): string {
  return join(getExodusHome(), 'artifacts')
}

/** Installed Agent Skills — one directory per slug plus `.lock.json`. The same
 *  directory `exodus-cli` installs into, so the two stay interchangeable. */
export function getSkillsDir(): string {
  return join(getExodusHome(), 'skills')
}

/** Philharmonic Group workspace root, one directory per conversation. */
export function getGroupsDir(): string {
  return join(getExodusHome(), 'groups')
}

/** Per-chat workspaces: where the chat's file and shell tools work by default. */
export function getWorkspacesDir(): string {
  return join(getExodusHome(), 'workspace')
}

/**
 * A chat's workspace, `~/.exodus/workspace/<chatId>`. Not created here — the
 * terminal tool creates it on first use, and write_file makes parents — so a
 * chat that never touches a file leaves no directory behind.
 */
export function getChatWorkspaceDir(chatId: string): string {
  return join(getWorkspacesDir(), chatId)
}

export function getGroupDir(conversationId: string): string {
  const dir = join(getGroupsDir(), conversationId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Generated media (image_generation results), `~/.exodus/media`. Files are
 * written once and never edited — `<uuid>.<ext>` — and served read-only by
 * `GET /api/v1/media/:chatId/:file`. A chat's or a Group's own dir is named
 * only by `mediaDirFor()` in `src/main/lib/media/store.ts`, which refuses an
 * id that would leave this one.
 */
export function getMediaDir(): string {
  return join(getExodusHome(), 'media')
}

/**
 * Written once the plaintext left on disk by pre-encryption builds has been
 * purged (`secrets/migrate.ts`); holds `{ purgedAt }`.
 */
export function getSecretsPurgeMarkerPath(): string {
  return join(getExodusHome(), 'secrets-purge.json')
}

/**
 * The secrets a write cleared because their destination moved (a new base
 * URL, MCP url or command), by name only — never a value — so the re-entry
 * prompt survives a restart (`secrets/moved.ts`).
 */
export function getSecretsReentryPath(): string {
  return join(getExodusHome(), 'secrets-reentry.json')
}

/**
 * Devices revoked on the computer that have not been told yet, as token
 * hashes (`lan/revoked.ts`): the LAN listener stays up for them, so the phone
 * gets its 401 and unpairs instead of finding nothing there.
 */
export function getRevokedDevicesPath(): string {
  return join(getExodusHome(), 'lan-revoked.json')
}

/** DuckDB chat-audit snapshot (`exodus.duckdb` + `snapshot.json`) — Settings → Developer. */
export function getAnalyticsDir(): string {
  const dir = join(getExodusHome(), 'analytics')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getAnalyticsDbPath(): string {
  return join(getAnalyticsDir(), 'exodus.duckdb')
}

export function getBackupsDir(): string {
  return join(getExodusHome(), 'backups')
}

export function getAutoBackupsDir(): string {
  const dir = join(getBackupsDir(), 'auto')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getManualBackupsDir(): string {
  const dir = join(getBackupsDir(), 'manual')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** The LAN listener's certificate and (encrypted) private key. */
export function getTlsDir(): string {
  return join(getExodusHome(), 'tls')
}

export function getLockSecretPath(): string {
  return join(getExodusHome(), 'lock.dat')
}

export function getLockConfigPath(): string {
  return join(getExodusHome(), 'lock-config.json')
}

export function ensureExodusDirs(): void {
  const dirs = [
    getExodusHome(),
    getDatabaseDir(),
    getLogsDir(),
    getArtifactsDir(),
    getAutoBackupsDir(),
    getManualBackupsDir()
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * Resolves a path under the app's bundled `resources/` directory (icons,
 * etc.). electron-forge's Vite plugin has no electron-vite `?asset` import,
 * so bundled assets are read straight off disk instead.
 *
 * In dev, `__dirname` is `<repo>/.vite/build` (where main.js lives) — two
 * levels up is the repo root, then into `resources/`.
 *
 * In a packaged build, `packagerConfig.extraResource: ['./resources']`
 * (see forge.config.ts) copies the *directory* into
 * `Contents/Resources/resources/` — electron-packager preserves the source
 * folder's basename rather than flattening its contents — so
 * `process.resourcesPath` alone is one level short; verified against a real
 * `electron-forge package` output, not assumed.
 */
export function getResourcePath(relPath: string): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(__dirname, '../../resources')
  return join(base, relPath)
}
