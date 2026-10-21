import { describe, expect, it } from 'vitest'

import {
  createMigratedPglite,
  migrationFile,
  migrationSql
} from '../../../../helpers/migrated-pglite'

describe('migration 0019 — chat.provider / chat.model', () => {
  it('leaves an existing chat with no model of its own, and stores one set later', async () => {
    const pg = await createMigratedPglite('0018')
    await pg.exec(
      `INSERT INTO chat (id, title) VALUES ('00000000-0000-0000-0000-000000000001', 'Old')`
    )
    await pg.exec(migrationSql(migrationFile('0019')))

    expect((await pg.query(`SELECT provider, model FROM chat`)).rows).toEqual([
      { provider: null, model: null }
    ])
    await pg.exec(`UPDATE chat SET provider = 'OpenAI GPT', model = 'gpt-5.6'`)
    expect((await pg.query(`SELECT provider, model FROM chat`)).rows).toEqual([
      { provider: 'OpenAI GPT', model: 'gpt-5.6' }
    ])
    await pg.close()
  })
})
