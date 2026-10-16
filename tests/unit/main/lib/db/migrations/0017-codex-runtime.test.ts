import { describe, expect, it } from 'vitest'

import {
  createMigratedPglite,
  migrationFile,
  migrationSql
} from '../../../../helpers/migrated-pglite'

describe('migration 0017 — codex runtime', () => {
  it('accepts codex as an employee runtime', async () => {
    const pg = await createMigratedPglite('0017')
    await pg.exec(`INSERT INTO agent (name, runtime) VALUES ('Codex', 'codex')`)
    const { rows } = await pg.query<{ runtime: string }>(
      `SELECT runtime FROM agent`
    )
    expect(rows).toEqual([{ runtime: 'codex' }])
    await pg.close()
  })

  // A database that ran the coding-agents branch, where this was 0016,
  // already has the value; the renumbered migration must not fail there.
  it('runs again on a database that already has codex', async () => {
    const pg = await createMigratedPglite('0017')
    await pg.exec(migrationSql(migrationFile('0017')))
    await pg.close()
  })
})
