import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0018 — pm_round_event', () => {
  it('stores a round’s events and drops them with their group', async () => {
    const pg = await createMigratedPglite('0018')
    await pg.exec(
      `INSERT INTO conversation (id, title) VALUES ('00000000-0000-0000-0000-000000000001', 'G')`
    )
    await pg.exec(`INSERT INTO pm_round_event ("conversationId","roundId",seq,kind,payload)
      VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa',0,'input','{"text":"hi"}')`)
    await pg.exec(`INSERT INTO conversation_message ("conversationId",role,content,"roundId")
      VALUES ('00000000-0000-0000-0000-000000000001','pm','ok','00000000-0000-0000-0000-0000000000aa')`)
    expect(
      (await pg.query(`SELECT count(*)::int AS n FROM pm_round_event`)).rows
    ).toEqual([{ n: 1 }])
    await pg.exec(`DELETE FROM conversation`)
    expect(
      (await pg.query(`SELECT count(*)::int AS n FROM pm_round_event`)).rows
    ).toEqual([{ n: 0 }])
    await pg.close()
  })
})
