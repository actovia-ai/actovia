import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0016 — codex runtime', () => {
  it('accepts codex as an employee runtime', async () => {
    const pg = await createMigratedPglite('0016')
    await pg.exec(`INSERT INTO agent (name, runtime) VALUES ('Codex', 'codex')`)
    const { rows } = await pg.query<{ runtime: string }>(
      `SELECT runtime FROM agent`
    )
    expect(rows).toEqual([{ runtime: 'codex' }])
    await pg.close()
  })
})
