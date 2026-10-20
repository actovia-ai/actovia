// The secrets startup pass, step by step (re-review S2 N2 and the deferred
// minors): each step fails on its own (a denied Keychain prompt does not skip
// stripping job keys), the strip reports how many payloads it changed, the
// raw `~/.actovia/logs/*.jsonl` are scrubbed of every current secret during
// the one-time purge, and an envelope self-check that fails (a future
// Electron with another OSCrypt tag) turns encryption off rather than
// re-wrapping and purging on every launch. In-memory PGlite with pgmq; the
// marker and the logs live in a temp dir; safeStorage is faked.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fakeSafeStorageState,
  resetFakeSafeStorage
} from '../../../helpers/fake-safe-storage'

const root = mkdtempSync(join(tmpdir(), 'actovia-startup-'))
const logsDir = join(root, 'logs')
const marker = join(root, 'secrets-purge.json')
const backupsDir = join(root, 'backups')

vi.mock('electron', async () => {
  const { fakeSafeStorage } = await import('../../../helpers/fake-safe-storage')
  return { app: { getPath: () => '/tmp' }, safeStorage: fakeSafeStorage }
})
const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger: logged }))
vi.mock('@main/lib/paths', () => ({
  getSecretsPurgeMarkerPath: () => join(root, 'secrets-purge.json'),
  getLogsDir: () => join(root, 'logs'),
  getAutoBackupsDir: () => join(root, 'backups')
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999', { pgmq: true })
  for (const q of ['lcm-post-turn', 'memory-consolidate']) {
    await pglite.exec(`SELECT pgmq.create('${q}');`)
  }
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const { invalidateSettingsCache } = await import('@main/lib/db/queries')
const { secretsAtRestStartup } = await import('@main/lib/secrets/migrate')
const { ENC_PREFIX, encryptionState, resetEncryptionWarning } =
  await import('@main/lib/secrets/crypto')
const { stripApiKeysFromQueuedJobs } = await import('@main/lib/jobs/queries')

afterAll(async () => {
  await pglite.close()
  rmSync(root, { recursive: true, force: true })
})

const OPENAI = 'sk-proj-startup-openai-1a2b3c4d5e6f'
const JOB_KEY = 'sk-startup-queued-key-9z8y7x6w'
const CAP = 'Cap9f8e7d6c5b4a3210ABCDEFghij'
const ARG_KEY = 'startup-arg-key-5d4c3b2a'

async function seed() {
  await pglite.exec(`
    DELETE FROM settings; DELETE FROM mcp_server;
    DELETE FROM pgmq."q_lcm-post-turn"; DELETE FROM pgmq."q_memory-consolidate";`)
  await pglite.query(
    `INSERT INTO settings (id, providers) VALUES ('global', $1)`,
    [JSON.stringify({ openaiApiKey: OPENAI })]
  )
  await pglite.query(
    `INSERT INTO mcp_server (name, "transportType", url, command, args)
     VALUES ('m', 'streamable-http', $1, 'npx', $2)`,
    [
      `https://mcp.example.com/${CAP}/sse`,
      JSON.stringify(['-y', 'pkg', `--api-key=${ARG_KEY}`])
    ]
  )
  invalidateSettingsCache()
}

function markerState(): {
  version?: number
  purgedAt?: string
  lastAttemptAt?: string
  oldBackupsRemovedAt?: string
} {
  return existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : {}
}

/** Writes a fake `.tar.gz` backup with the given mtime (ISO). */
function backupFile(name: string, iso: string) {
  mkdirSync(backupsDir, { recursive: true })
  const path = join(backupsDir, name)
  writeFileSync(path, 'x')
  const t = new Date(iso)
  utimesSync(path, t, t)
}

async function queue(payload: object, q = 'lcm-post-turn') {
  await pglite.query(`SELECT pgmq.send($1, $2::jsonb)`, [
    q,
    JSON.stringify(payload)
  ])
}

async function queued(): Promise<string> {
  const r = await pglite.query(
    `SELECT message FROM pgmq."q_lcm-post-turn"
     UNION ALL SELECT message FROM pgmq."q_memory-consolidate"`
  )
  return JSON.stringify(r.rows)
}

beforeEach(async () => {
  resetFakeSafeStorage()
  resetEncryptionWarning()
  for (const f of Object.values(logged)) f.mockClear()
  rmSync(marker, { force: true })
  rmSync(logsDir, { recursive: true, force: true })
  mkdirSync(logsDir, { recursive: true })
  try {
    chmodSync(backupsDir, 0o755)
  } catch {
    // Doesn't exist yet — nothing to restore.
  }
  rmSync(backupsDir, { recursive: true, force: true })
  await seed()
})

describe('stripApiKeysFromQueuedJobs', () => {
  it('counts the payloads it changed, across queues', async () => {
    await queue({ chatId: 'a', apiKey: JOB_KEY })
    await queue({ chatId: 'b', apiKey: JOB_KEY }, 'memory-consolidate')
    await queue({ chatId: 'c' })
    expect(await stripApiKeysFromQueuedJobs()).toBe(2)
    expect(await queued()).not.toContain(JOB_KEY)
    expect(await stripApiKeysFromQueuedJobs()).toBe(0)
  })
})

describe('each startup step stands on its own (N2)', () => {
  it('a denied Keychain prompt still strips job keys and vacuums them — no marker', async () => {
    await queue({ chatId: 'a', apiKey: JOB_KEY })
    fakeSafeStorageState.denyEncrypt = true

    const result = await secretsAtRestStartup()
    expect(result.encryptFailed).toBe(true)
    expect(result.jobs).toBe(1)
    expect(result.purged).toBe(true)
    expect(await queued()).not.toContain(JOB_KEY)
    // The plaintext rows could not be encrypted; the first launch that can
    // encrypt them purges again (it changes them), so the marker only
    // records the attempt.
    expect(markerState().purgedAt).toBeUndefined()
    expect(markerState().lastAttemptAt).toBeDefined()
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain(OPENAI)

    fakeSafeStorageState.denyEncrypt = false
    const next = await secretsAtRestStartup()
    expect(next.encryptFailed).toBe(false)
    expect(next.settings).toBe(1)
    expect(next.purged).toBe(true)
    expect(existsSync(marker)).toBe(true)
  })

  it('a failing strip does not stop encryption or the purge', async () => {
    await pglite.exec(
      `ALTER TABLE pgmq."q_lcm-post-turn" RENAME TO "q_lcm-post-turn_x"`
    )
    await pglite.exec(
      `CREATE VIEW pgmq."q_lcm-post-turn" AS SELECT 1 AS message`
    )
    try {
      const result = await secretsAtRestStartup()
      expect(result.stripFailed).toBe(true)
      expect(result.settings).toBe(1)
      expect(result.purged).toBe(true)
    } finally {
      await pglite.exec(`DROP VIEW pgmq."q_lcm-post-turn"`)
      await pglite.exec(
        `ALTER TABLE pgmq."q_lcm-post-turn_x" RENAME TO "q_lcm-post-turn"`
      )
    }
  })
})

describe('the raw log files are scrubbed during the purge', () => {
  it('replaces every current secret, MCP url / args ones included, and leaves the rest', async () => {
    const leaky = join(logsDir, '2026-09-20.jsonl')
    const clean = join(logsDir, '2026-09-21.jsonl')
    const lines = [
      { body: `Failed query params: ${OPENAI}` },
      {
        body: 'connect',
        attributes: { url: `https://mcp.example.com/${CAP}/sse` }
      },
      { body: `spawn npx -y pkg --api-key=${ARG_KEY}` },
      { body: 'nothing to see' }
    ]
    writeFileSync(leaky, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    writeFileSync(clean, JSON.stringify({ body: 'ok' }) + '\n')

    const result = await secretsAtRestStartup()
    expect(result.logsScrubbed).toBe(1)
    const text = readFileSync(leaky, 'utf8')
    for (const s of [OPENAI, CAP, ARG_KEY]) expect(text).not.toContain(s)
    expect(text).toContain('nothing to see')
    expect(text.split('\n').filter(Boolean)).toHaveLength(4)
    for (const line of text.split('\n').filter(Boolean)) JSON.parse(line)
    expect(readFileSync(clean, 'utf8')).toBe(
      JSON.stringify({ body: 'ok' }) + '\n'
    )
  })

  it('does not rescrub on a launch that purges nothing', async () => {
    await secretsAtRestStartup()
    const later = join(logsDir, '2026-09-22.jsonl')
    writeFileSync(later, JSON.stringify({ body: OPENAI }) + '\n')
    const result = await secretsAtRestStartup()
    expect(result.purged).toBe(false)
    expect(result.logsScrubbed).toBe(0)
  })
})

describe('the envelope self-check', () => {
  it('a backend whose blobs are not recognizable envelopes counts as unavailable', async () => {
    fakeSafeStorageState.tag = 'v99'
    expect(encryptionState()).toBe('unavailable')

    const first = await secretsAtRestStartup()
    expect(first.settings).toBe(0)
    const [row] = (await pglite.query(`SELECT providers FROM settings`))
      .rows as Array<{
      providers: { openaiApiKey: string }
    }>
    expect(row!.providers.openaiApiKey).toBe(OPENAI)
    expect(row!.providers.openaiApiKey.startsWith(ENC_PREFIX)).toBe(false)
    await vi.waitFor(() =>
      expect(JSON.stringify(logged.error.mock.calls)).toMatch(/self-check/iu)
    )
    // No re-wrapping, so nothing to purge on the next launch.
    expect((await secretsAtRestStartup()).purged).toBe(false)
  })
})

describe('the marker (fix round 3)', () => {
  it('a directory marked by an earlier build (no version) is purged and scrubbed once', async () => {
    writeFileSync(marker, JSON.stringify({ purgedAt: '2026-09-25T00:00:00Z' }))
    const leaky = join(logsDir, '2026-09-20.jsonl')
    writeFileSync(leaky, JSON.stringify({ body: OPENAI }) + '\n')
    const first = await secretsAtRestStartup()
    expect(first.purged).toBe(true)
    expect(readFileSync(leaky, 'utf8')).not.toContain(OPENAI)
    expect(markerState().version).toBe(2)
    expect((await secretsAtRestStartup()).purged).toBe(false)
  })

  it('is not completed when the log scrub failed', async () => {
    const leaky = join(logsDir, '2026-09-20.jsonl')
    writeFileSync(leaky, JSON.stringify({ body: OPENAI }) + '\n')
    chmodSync(leaky, 0o000)
    try {
      const result = await secretsAtRestStartup()
      expect(result.purged).toBe(true)
      expect(result.scrubFailed).toBe(true)
      expect(markerState().purgedAt).toBeUndefined()
    } finally {
      chmodSync(leaky, 0o600)
    }
  })

  it('is never completed while encryption is unavailable — nothing was encrypted (S2 minor)', async () => {
    fakeSafeStorageState.available = false
    const result = await secretsAtRestStartup()
    expect(result.purged).toBe(true)
    expect(markerState().purgedAt).toBeUndefined()
    expect(markerState().lastAttemptAt).toBeDefined()
  })

  it('a log file skipped for its size does not keep the pass from completing (S2 minor)', async () => {
    const big = join(logsDir, '2026-09-19.jsonl')
    writeFileSync(big, '')
    // Sparse: over the 64 MB cap without writing it.
    truncateSync(big, 65 * 1024 * 1024)
    const result = await secretsAtRestStartup()
    expect(result.purged).toBe(true)
    expect(result.scrubFailed).toBe(false)
    expect(markerState().purgedAt).toBeDefined()
    expect(JSON.stringify(logged.warn.mock.calls)).toMatch(/size cap/iu)
  })

  it('while a step keeps failing, the full purge is retried at most once a day', async () => {
    await queue({ chatId: 'a', apiKey: JOB_KEY })
    fakeSafeStorageState.denyEncrypt = true
    expect((await secretsAtRestStartup()).purged).toBe(true)
    // Still denied, nothing new to strip: no VACUUM + WAL rounds again today.
    expect((await secretsAtRestStartup()).purged).toBe(false)
    // A day later it tries again.
    const state = markerState()
    writeFileSync(
      marker,
      JSON.stringify({
        ...state,
        lastAttemptAt: new Date(Date.now() - 25 * 3600_000).toISOString()
      })
    )
    expect((await secretsAtRestStartup()).purged).toBe(true)
    // Something changed (a new key to strip): no waiting.
    await queue({ chatId: 'b', apiKey: JOB_KEY })
    expect((await secretsAtRestStartup()).purged).toBe(true)
  })
})

describe('pre-encryption backups are deleted once, per the purge marker', () => {
  it('removes backups older than purgedAt and keeps newer ones, in the same launch that first completes', async () => {
    // Backups from before secrets were ever encrypted, sitting on disk when
    // the first successful pass runs.
    backupFile('old.tar.gz', '2020-01-01T00:00:00Z')
    backupFile('newer.tar.gz', '2030-01-01T00:00:00Z')

    await secretsAtRestStartup()

    expect(markerState().purgedAt).toBeDefined()
    expect(readdirSync(backupsDir).toSorted()).toEqual(['newer.tar.gz'])
    expect(markerState().oldBackupsRemovedAt).toBeDefined()
  })

  it('runs once — a backup added later, dated before purgedAt, is left alone', async () => {
    await secretsAtRestStartup()
    const purgedAt = markerState().purgedAt!
    const removedAt = markerState().oldBackupsRemovedAt
    expect(purgedAt).toBeDefined()
    expect(removedAt).toBeDefined()

    backupFile(
      'late.tar.gz',
      new Date(Date.parse(purgedAt) - 60_000).toISOString()
    )
    await secretsAtRestStartup()

    expect(readdirSync(backupsDir)).toContain('late.tar.gz')
    expect(markerState().oldBackupsRemovedAt).toBe(removedAt)
  })

  it('is skipped while encryption is unavailable, even with a purgedAt on record', async () => {
    // A marker left by an earlier, already-completed pass — before this
    // launch, and before this field existed.
    const purgedAt = '2026-09-20T00:00:00Z'
    writeFileSync(
      marker,
      JSON.stringify({ version: 2, purgedAt, lastAttemptAt: purgedAt })
    )
    backupFile('old.tar.gz', '2020-01-01T00:00:00Z')

    fakeSafeStorageState.available = false
    expect(encryptionState()).not.toBe('on')
    await secretsAtRestStartup()

    expect(readdirSync(backupsDir)).toContain('old.tar.gz')
    expect(markerState().oldBackupsRemovedAt).toBeUndefined()
  })

  it('is skipped while no pass has ever completed (no purgedAt)', async () => {
    fakeSafeStorageState.denyEncrypt = true
    backupFile('old.tar.gz', '2020-01-01T00:00:00Z')

    await secretsAtRestStartup()

    expect(markerState().purgedAt).toBeUndefined()
    expect(readdirSync(backupsDir)).toContain('old.tar.gz')
    expect(markerState().oldBackupsRemovedAt).toBeUndefined()
  })

  it('a failure removing old backups is logged, leaves the field unset, and does not block startup', async () => {
    backupFile('old.tar.gz', '2020-01-01T00:00:00Z')
    // Deleting a file needs write permission on its parent directory —
    // chmod after creating the file, so the write above still succeeds.
    chmodSync(backupsDir, 0o500)
    try {
      const result = await secretsAtRestStartup()
      // The purge pass itself (encrypt/strip/purge/scrub) is unaffected.
      expect(result.purged).toBe(true)
      expect(markerState().purgedAt).toBeDefined()
      expect(markerState().oldBackupsRemovedAt).toBeUndefined()
      expect(JSON.stringify(logged.error.mock.calls)).toMatch(
        /removing pre-encryption backups failed/iu
      )
      expect(readdirSync(backupsDir)).toContain('old.tar.gz')
    } finally {
      chmodSync(backupsDir, 0o755)
    }
  })
})
