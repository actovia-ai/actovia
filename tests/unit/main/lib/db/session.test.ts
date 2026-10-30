import { PGlite } from '@electric-sql/pglite'
import { chat } from '@main/lib/db/schema'
import { pinSessionUtc } from '@main/lib/db/session'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'

import {
  createMigratedPglite,
  legacyZoneParams
} from '../../../helpers/migrated-pglite'

// A data directory an older PGlite initialised holds the OS zone in its
// postgresql.conf; `zone` stands for it (PGlite 0.5.13 writes UTC).

describe('pinSessionUtc', () => {
  it.each(['Asia/Shanghai', 'America/New_York'])(
    'runs a database initialised in %s in UTC',
    async (zone) => {
      const pg = await createMigratedPglite('9999', { zone })

      const tz = await pg.query<{ TimeZone: string }>('SHOW timezone')
      expect(tz.rows[0].TimeZone).toBe('UTC')
      // The zone initdb wrote stays readable, which 0020 converts from.
      const reset = await pg.query<{ reset_val: string }>(
        `SELECT reset_val FROM pg_settings WHERE name = 'TimeZone'`
      )
      expect(reset.rows[0].reset_val).not.toBe('UTC')

      const db = drizzle(pg)
      const [row] = await db
        .insert(chat)
        .values({ id: crypto.randomUUID(), title: 'Fresh' })
        .returning()
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(2000)
      await pg.close()
    }
  )

  it('is queued ahead of a query sent before the database is ready', async () => {
    const pg = new PGlite({ startParams: legacyZoneParams('Asia/Shanghai') })
    const pinned = pinSessionUtc(pg)
    const shown = pg.query<{ TimeZone: string }>('SHOW timezone')
    await pg.waitReady
    await pinned
    expect((await shown).rows[0].TimeZone).toBe('UTC')
    await pg.close()
  })
})
