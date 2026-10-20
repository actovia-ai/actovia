import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import { eq } from 'drizzle-orm'

import { removeBackupsOlderThan } from '../backup'
import { db } from '../db/db'
import { invalidateSettingsCache } from '../db/queries'
import { mcpServer, settings } from '../db/schema'
import { stripApiKeysFromQueuedJobs } from '../jobs/queries'
import { logger } from '../logger'
import { getLogsDir, getSecretsPurgeMarkerPath } from '../paths'
import { encryptMcpSecrets, encryptSettingsSecretsInPlace } from './at-rest'
import {
  encryptionState,
  SecretEncryptionError,
  warnUnavailableOnce
} from './crypto'
import { secretSafeWriteError } from './index'
import { knownSecretValues } from './known'
import { purgeResidualPlaintext } from './purge'
import { SETTINGS_SECRET_PATHS } from './registry'
import { scrubLogFiles } from './scrub'

/** The `settings` columns that hold a registry secret. */
const SECRET_COLUMNS = [
  ...new Set(SETTINGS_SECRET_PATHS.map((p) => p.split('.')[0]))
] as Array<keyof typeof settings.$inferInsert>

/**
 * The startup migration (spec 2026-09-25 §2.3): every plaintext registry value
 * in `settings` and every plaintext MCP secret is encrypted in place. Runs
 * after the schema migrations and before the server starts. Idempotent — a
 * value already `enc:v1:` is left alone, so a second run changes nothing.
 * With no safeStorage backend it changes nothing either (and warns once).
 * Logs how many values it encrypted, never a value.
 */
export async function encryptSecretsAtRest(): Promise<{
  settings: number
  mcp: number
}> {
  if (encryptionState() !== 'on') {
    warnUnavailableOnce()
    return { settings: 0, mcp: 0 }
  }

  const counts = await db.transaction(async (tx) => {
    await tx.insert(settings).values({ id: 'global' }).onConflictDoNothing()
    const [row] = await tx.select().from(settings)
    const sealed = structuredClone(row!)
    const inSettings = encryptSettingsSecretsInPlace(sealed)
    if (inSettings) {
      await tx
        .update(settings)
        .set(Object.fromEntries(SECRET_COLUMNS.map((c) => [c, sealed[c]])))
        .where(eq(settings.id, row!.id))
    }

    let inMcp = 0
    for (const server of await tx.select().from(mcpServer)) {
      const { sealed: cols, changed } = encryptMcpSecrets({
        env: server.env,
        headers: server.headers,
        extraConfig: server.extraConfig,
        url: server.url,
        args: server.args
      })
      if (!changed) continue
      inMcp += changed
      await tx.update(mcpServer).set(cols).where(eq(mcpServer.id, server.id))
    }
    return { settings: inSettings, mcp: inMcp }
  })

  invalidateSettingsCache()
  if (counts.settings || counts.mcp) {
    logger.info('secrets', 'Encrypted stored secrets', counts)
  }
  return counts
}

export interface SecretsStartupResult {
  settings: number
  mcp: number
  /** Queued job payloads an `apiKey` was stripped from. */
  jobs: number
  /** Whether the on-disk residue was purged this launch. */
  purged: boolean
  /** Raw log files the purge rewrote with secrets masked. */
  logsScrubbed: number
  encryptFailed: boolean
  stripFailed: boolean
  scrubFailed: boolean
}

/** A step's failure, logged without a value (drizzle quotes parameters). */
function logStep(what: string, error: unknown): void {
  logger.error(
    'secrets',
    error instanceof SecretEncryptionError
      ? `${what}: ${error.message}`
      : secretSafeWriteError(what, error).message
  )
}

/**
 * The marker's format. Version 2 (fix round 3) also scrubs the raw log files,
 * so a directory completed by an earlier build runs the pass once more.
 */
const MARKER_VERSION = 2
/** While a step keeps failing, the full purge is retried at most this often. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

interface PurgeMarker {
  version?: number
  /** Set once a pass completed every step. */
  purgedAt?: string
  /** The last pass that ran (complete or not). */
  lastAttemptAt?: string
  /**
   * Set once the auto-backups written before `purgedAt` have been deleted
   * (owner's decision 2026-09-26, `removeOldBackupsOnce` below) — never
   * cleared, so the deletion runs at most once per data directory.
   */
  oldBackupsRemovedAt?: string
}

function readMarker(path: string): PurgeMarker {
  try {
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as PurgeMarker)
      : {}
  } catch {
    return {}
  }
}

function writeMarker(path: string, marker: PurgeMarker): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(marker, null, 2))
}

/**
 * Everything `main.ts` runs for secrets at rest, after the schema migrations
 * and before any route or job:
 *
 * 1. encrypt what is still plaintext (`encryptSecretsAtRest`);
 * 2. strip keys from queued job payloads (ruling R3);
 * 3. purge the plaintext the old values left on disk (`purge.ts`, review S2
 *    C2) and rewrite the raw log files with every current secret masked.
 *
 * Each step fails on its own (re-review N2): a denied Keychain prompt does
 * not keep the job keys from being stripped and vacuumed. Step 3 runs when
 * steps 1–2 changed something, or when no pass has completed yet — but while
 * a step keeps failing it is retried at most once a day (`RETRY_AFTER_MS`),
 * not on every launch. The marker (`~/.actovia/secrets-purge.json`) records
 * the last attempt, and `purgedAt` once a pass completed every step
 * (encrypt, strip, purge, scrub); its `purgedAt` is the moment backups older
 * than it may still hold plaintext (`removeBackupsOlderThan` in `backup.ts`).
 */
async function runSecretsAtRestPass(): Promise<SecretsStartupResult> {
  let counts = { settings: 0, mcp: 0 }
  let encryptFailed = false
  try {
    counts = await encryptSecretsAtRest()
  } catch (error) {
    encryptFailed = true
    logStep('Encrypting stored secrets failed', error)
  }
  let jobs = 0
  let stripFailed = false
  try {
    jobs = await stripApiKeysFromQueuedJobs()
  } catch (error) {
    stripFailed = true
    logStep('Stripping keys from queued jobs failed', error)
  }

  const result = { ...counts, jobs, encryptFailed, stripFailed }
  const skipped = {
    ...result,
    purged: false,
    logsScrubbed: 0,
    scrubFailed: false
  }
  const path = getSecretsPurgeMarkerPath()
  const marker = readMarker(path)
  const complete =
    (marker.version ?? 1) >= MARKER_VERSION && Boolean(marker.purgedAt)
  const changed = counts.settings + counts.mcp + jobs > 0
  if (!changed) {
    if (complete) return skipped
    const last = Date.parse(marker.lastAttemptAt ?? '')
    if (
      (marker.version ?? 1) >= MARKER_VERSION &&
      Number.isFinite(last) &&
      Date.now() - last < RETRY_AFTER_MS
    ) {
      return skipped
    }
  }

  // The purge runs even when encryption failed: the stripped job payloads and
  // their dead tuples are worth vacuuming, and it costs the plaintext rows
  // nothing. Completion waits for a pass where every step succeeded — the
  // launch that finally encrypts the rows changes them and purges again.
  const now = new Date().toISOString()
  try {
    await purgeResidualPlaintext()
  } catch (error) {
    logStep('Purging plaintext residue failed', error)
    writeMarker(path, {
      version: MARKER_VERSION,
      lastAttemptAt: now,
      ...(marker.oldBackupsRemovedAt
        ? { oldBackupsRemovedAt: marker.oldBackupsRemovedAt }
        : {})
    })
    return skipped
  }
  let logsScrubbed = 0
  let scrubFailed = false
  try {
    const scrub = scrubLogFiles(getLogsDir(), await knownSecretValues())
    logsScrubbed = scrub.changed
    scrubFailed = scrub.failed > 0
    if (scrub.skipped > 0) {
      logger.warn('secrets', 'Log files over the size cap were not scrubbed', {
        count: scrub.skipped
      })
    }
    if (scrubFailed) {
      logger.error('secrets', 'Some log files could not be scrubbed', {
        count: scrub.failed
      })
    }
  } catch (error) {
    scrubFailed = true
    logStep('Scrubbing the log files failed', error)
  }
  // Without a working backend nothing was encrypted, so the database and
  // every backup still hold plaintext: never recorded as clean (S2 minor) —
  // `purgedAt` is what the backup-deletion decision would rely on.
  const ok =
    !encryptFailed && !stripFailed && !scrubFailed && encryptionState() === 'on'
  writeMarker(path, {
    version: MARKER_VERSION,
    ...(ok ? { purgedAt: now } : {}),
    lastAttemptAt: now,
    ...(marker.oldBackupsRemovedAt
      ? { oldBackupsRemovedAt: marker.oldBackupsRemovedAt }
      : {})
  })
  logger.info('secrets', 'Purged plaintext residue from the database files', {
    logsScrubbed,
    complete: ok
  })
  return { ...result, purged: true, logsScrubbed, scrubFailed }
}

/**
 * Deletes the auto-backups written before secrets were last known to be
 * fully purged of plaintext (owner's decision 2026-09-26): pre-encryption
 * backups hold every API key in the clear (review S2 C2). Runs at most once
 * per data directory — once the marker's `purgedAt` names a completed pass
 * and encryption is confirmed `'on'` (with no working backend a fresh
 * backup is plaintext too, so deleting old ones would buy nothing), and
 * only while `oldBackupsRemovedAt` is not yet set. Success is recorded
 * there so a later pass — even one that moves `purgedAt` forward, e.g. a
 * newly-saved key getting encrypted — never repeats it and never deletes a
 * backup made since. A failure here (or an unwritable marker) is logged —
 * the count only, never a backup's name or path — and leaves the field
 * unset, so the next launch tries again; it never blocks startup.
 */
function removeOldBackupsOnce(): void {
  const path = getSecretsPurgeMarkerPath()
  const marker = readMarker(path)
  if (!marker.purgedAt || marker.oldBackupsRemovedAt) return
  if (encryptionState() !== 'on') return
  try {
    const removed = removeBackupsOlderThan(new Date(marker.purgedAt))
    writeMarker(path, {
      ...marker,
      oldBackupsRemovedAt: new Date().toISOString()
    })
    if (removed.length > 0) {
      logger.info('secrets', 'Removed pre-encryption backups', {
        count: removed.length
      })
    }
  } catch (error) {
    logStep('Removing pre-encryption backups failed', error)
  }
}

/**
 * The public entry point `main.ts` calls: the purge pass above, then the
 * one-time pre-encryption-backup cleanup. Kept separate from
 * `runSecretsAtRestPass` so every one of that pass's several return points
 * still reaches the cleanup step, without threading it through each one.
 */
export async function secretsAtRestStartup(): Promise<SecretsStartupResult> {
  const result = await runSecretsAtRestPass()
  removeOldBackupsOnce()
  return result
}
