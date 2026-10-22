import type { PGlite } from '@electric-sql/pglite'

/**
 * Runs the session in UTC. Every timestamp column is `timestamp` without a
 * time zone, which drizzle writes and reads as UTC wall clock, but the
 * session's zone is the one PGlite's initdb wrote into the data directory's
 * postgresql.conf — the OS zone as a fixed offset (`Etc/GMT-8` in
 * Shanghai) — so a column's `DEFAULT now()` stamped local wall clock that
 * read back shifted by the offset. Migration 0020 moved those values onto
 * UTC.
 *
 * Call it right after `new PGlite(...)`, before anything else queries:
 * PGlite runs its queries one at a time in the order they were called, so
 * the SET is the first, and nothing in the app RESETs or DISCARDs it. The
 * zone initdb wrote stays readable as TimeZone's `reset_val`, which is how
 * 0020 knows what to convert from. (`ALTER DATABASE … SET timezone` has no
 * effect in PGlite, and its `postgresqlconf` option replaces the whole file.)
 */
export function pinSessionUtc(pglite: PGlite): Promise<unknown> {
  return pglite.exec(`SET TIME ZONE 'UTC'`)
}
