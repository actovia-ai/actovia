// The plaintext a pre-S2 build left on disk (review S2 C2): the startup pass
// encrypts in place, but the old tuples and the WAL still hold the values —
// and `dumpDataDir()`, what auto-backup writes, carries them. After the
// migration + purge nothing in the data directory, nor in a dump, contains a
// plaintext secret. A FILE-backed PGlite in a temp dir, scanned byte by byte.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gunzipSync } from 'zlib'

import { afterAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'exodus-purge-'))
const dataDir = join(root, 'database')

vi.mock('electron', async () => {
  const { fakeSafeStorage } = await import('../../../helpers/fake-safe-storage')
  return { app: { getPath: () => '/tmp' }, safeStorage: fakeSafeStorage }
})
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/paths', () => ({
  getSecretsPurgeMarkerPath: () => join(root, 'secrets-purge.json')
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('0015', {
    dataDir: join(root, 'database'),
    pgmq: true
  })
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const { secretsAtRestStartup } = await import('@main/lib/secrets/migrate')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const OPENAI = 'sk-proj-PLAINTEXT-openai-7f3a9c2e41d8b605'
const BRAVE = 'BSA-PLAINTEXT-brave-0b9e7d1c3a5f'
const GH_TOKEN = 'ghp_PLAINTEXT_env_token_5c8e2a9f1d3b'
const HEADER = 'Bearer PLAINTEXT-header-3e7a1f9c5d2b'
const URL_TOKEN = 'PLAINTEXTurlcap9f8e7d6c5b4a3210'
const ARG_KEY = 'PLAINTEXT-arg-key-8d2f6b1e4a9c'
const JOB_KEY = 'sk-PLAINTEXT-queued-job-key-2b4d6f8a'
const SECRETS = [OPENAI, BRAVE, GH_TOKEN, HEADER, URL_TOKEN, ARG_KEY, JOB_KEY]

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}

function hits(buf: Buffer): string[] {
  return SECRETS.filter((s) => buf.includes(Buffer.from(s, 'utf8')))
}

/** What a pre-S2 build left: plaintext rows, and processed jobs with keys. */
async function seedPreS2() {
  await pglite.query(
    `INSERT INTO settings (id, providers, "webSearch") VALUES ('global', $1, $2)`,
    [
      JSON.stringify({ openaiApiKey: OPENAI }),
      JSON.stringify({ braveApiKey: BRAVE })
    ]
  )
  await pglite.query(
    `INSERT INTO mcp_server (name, "transportType", url, command, args, env, headers)
     VALUES ('gh', 'streamable-http', $1, 'npx', $2, $3, $4)`,
    [
      `https://mcp.example.com/${URL_TOKEN}/sse`,
      JSON.stringify(['-y', 'some-mcp', `--api-key=${ARG_KEY}`]),
      JSON.stringify({ GITHUB_TOKEN: GH_TOKEN }),
      JSON.stringify({ Authorization: HEADER })
    ]
  )
  for (const q of ['lcm-post-turn', 'memory-consolidate']) {
    await pglite.exec(`SELECT pgmq.create('${q}');`)
  }
  const payload = JSON.stringify({ chatId: 'c', apiKey: JOB_KEY })
  // Processed and deleted (a dead tuple), archived, and still queued.
  const sent = await pglite.query<{ send: number }>(
    `SELECT pgmq.send('lcm-post-turn', $1::jsonb) AS send`,
    [payload]
  )
  await pglite.query(`SELECT pgmq.delete('lcm-post-turn', $1::bigint)`, [
    sent.rows[0].send
  ])
  const archived = await pglite.query<{ send: number }>(
    `SELECT pgmq.send('memory-consolidate', $1::jsonb) AS send`,
    [payload]
  )
  await pglite.query(`SELECT pgmq.archive('memory-consolidate', $1::bigint)`, [
    archived.rows[0].send
  ])
  await pglite.query(`SELECT pgmq.send('lcm-post-turn', $1::jsonb)`, [payload])
  await pglite.exec('CHECKPOINT')
}

describe('after the startup migration + purge, no plaintext is on disk', () => {
  it('in the data directory or in a dumpDataDir() backup', async () => {
    await seedPreS2()
    // The seed really is on disk before (else the scan below proves nothing).
    const before = filesUnder(dataDir).flatMap((f) => hits(readFileSync(f)))
    expect(new Set(before)).toEqual(new Set(SECRETS))

    const result = await secretsAtRestStartup()
    expect(result.purged).toBe(true)

    // A second launch finds nothing to encrypt and does not purge again.
    expect((await secretsAtRestStartup()).purged).toBe(false)

    await pglite.exec('CHECKPOINT')
    const dump = gunzipSync(
      Buffer.from(await (await pglite.dumpDataDir('gzip')).arrayBuffer())
    )
    expect(hits(dump)).toEqual([])

    await pglite.close()
    const onDisk = filesUnder(dataDir).flatMap((f) =>
      hits(readFileSync(f)).map((s) => `${f}: ${s}`)
    )
    expect(onDisk).toEqual([])
  }, 120_000)
})
