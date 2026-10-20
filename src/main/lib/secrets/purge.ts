import { pglite } from '../db/db'

/**
 * Removes the plaintext that encrypting in place leaves behind (review S2 C2).
 * An `UPDATE` keeps the old tuple in its heap page until a vacuum, PGlite runs
 * no autovacuum, and the value was WAL-logged when it was first written — so
 * after the startup migration the old keys were still in
 * `~/.actovia/database` and in every `dumpDataDir()` backup taken since. The
 * same goes for job payloads that carried an `apiKey` (deleted, archived, or
 * stripped by `stripApiKeysFromQueuedJobs`).
 *
 * `VACUUM FULL` rewrites `settings`, `mcp_server` and every pgmq queue /
 * archive table (TOAST included) into new files and drops the old ones — a
 * plain `VACUUM` prunes dead tuples but does not zero the freed page space,
 * and a stripped job payload was still readable there. Then three WAL
 * switches, each with a checkpoint, leave no segment written before them.
 * Measured on a file-backed PGlite (`tests/unit/main/lib/secrets/purge.test.ts`
 * byte-scans the data dir and a `dumpDataDir()` dump): zero or one round left
 * plaintext in the dump; three leave none. `pg_switch_wal()` works in PGlite.
 */
export async function purgeResidualPlaintext(): Promise<void> {
  const queues = await pglite.query<{ name: string }>(
    `SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name
       FROM pg_tables
      WHERE schemaname = 'pgmq'
        AND (tablename LIKE 'q\\_%' OR tablename LIKE 'a\\_%')`
  )
  const tables = ['settings', 'mcp_server', ...queues.rows.map((r) => r.name)]
  // VACUUM cannot run inside a transaction block: one statement per exec.
  // FULL takes an exclusive lock: fine, this runs before the server starts.
  for (const table of tables) await pglite.exec(`VACUUM FULL ${table}`)
  for (let i = 0; i < 3; i++) {
    await pglite.exec('SELECT pg_switch_wal()')
    await pglite.exec('CHECKPOINT')
  }
}
