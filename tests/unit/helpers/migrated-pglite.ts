import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pinSessionUtc } from '@main/lib/db/session'

const DRIZZLE = resolve(import.meta.dirname, '../../../resources/drizzle')

/** The migration file for an index (`'0007'`), whatever its random suffix. */
export function migrationFile(index: string): string {
  const name = readdirSync(DRIZZLE).find(
    (n) => n.startsWith(`${index}_`) && n.endsWith('.sql')
  )
  if (!name) throw new Error(`No migration ${index}_*.sql in ${DRIZZLE}`)
  return name
}

export function migrationSql(file: string): string {
  return readFileSync(resolve(DRIZZLE, file), 'utf8').replaceAll(
    '--> statement-breakpoint',
    ''
  )
}

/** PGlite's start parameters with the session zone a pre-0.5.13 initdb wrote. */
export function legacyZoneParams(zone: string): string[] {
  return [...PGlite.defaultStartParams, '-c', `TimeZone=${zone}`]
}

/**
 * A real, in-memory PGlite with the generated migrations applied in journal
 * order up to and including `upTo` (`'0006'`) — the pattern of
 * `jobs/queries.integration.test.ts`, so a migration test proves the SQL that
 * ships. `pg_trgm` and `vector` are what `db/migrate.ts` creates before it
 * migrates; 0000 needs the first for the message search index. The session
 * is pinned to UTC as `db/db.ts` pins the app's (`pinSessionUtc`), unless
 * `utc: false` asks for the zone of a database from before the pin — what
 * the 0020 test migrates from. `zone` stands for the zone an older PGlite's
 * initdb wrote into postgresql.conf (before 0.5.13 it wrote the process's
 * own; since then it writes UTC whatever `TZ` says, so a test can no longer
 * get one through `TZ`): it becomes TimeZone's `reset_val`, which is where
 * 0020 reads the old zone, as on a data directory made by such a version.
 */
export async function createMigratedPglite(
  upTo: string,
  options: {
    dataDir?: string
    pgmq?: boolean
    utc?: boolean
    zone?: string
  } = {}
): Promise<PGlite> {
  const extensions: Record<string, unknown> = { pg_trgm, vector }
  if (options.pgmq) {
    extensions.pgmq = (await import('@electric-sql/pglite-pgmq')).pgmq
  }
  const pglite = new PGlite({
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.zone ? { startParams: legacyZoneParams(options.zone) } : {}),
    extensions: extensions as never
  })
  const pinned = options.utc === false ? null : pinSessionUtc(pglite)
  await pglite.waitReady
  await pinned
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS vector;')
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
  if (options.pgmq) await pglite.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')
  const files = readdirSync(DRIZZLE)
    .filter((n) => n.endsWith('.sql') && n.slice(0, 4) <= upTo)
    .sort()
  for (const file of files) await pglite.exec(migrationSql(file))
  return pglite
}
