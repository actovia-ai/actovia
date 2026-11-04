import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0023 — PM-reviewed employee experience', () => {
  it('allows reviewed experience across Groups while retaining Group-scoped memories', async () => {
    const pg = await createMigratedPglite('0023')
    try {
      const agentId = '00000000-0000-0000-0000-000000000001'
      const conversationId = '00000000-0000-0000-0000-000000000002'
      await pg.exec(
        `INSERT INTO agent (id, name) VALUES ('${agentId}', 'Avery')`
      )
      await pg.exec(
        `INSERT INTO conversation (id, title) VALUES ('${conversationId}', 'Review')`
      )
      await pg.exec(
        `INSERT INTO agent_memory ("agentId", "conversationId", key, value)
         VALUES ('${agentId}', NULL, 'reviewed-task:t1', '{}')
         ON CONFLICT DO NOTHING`
      )
      await pg.exec(
        `INSERT INTO agent_memory ("agentId", "conversationId", key, value)
         VALUES ('${agentId}', NULL, 'reviewed-task:t1', '{}')
         ON CONFLICT DO NOTHING`
      )
      await pg.exec(
        `INSERT INTO agent_memory ("agentId", "conversationId", key, value)
         VALUES ('${agentId}', '${conversationId}', 'reviewed-task:t1', '{}')`
      )

      const result = await pg.query(
        `SELECT "conversationId", count(*)::int AS count
         FROM agent_memory
         GROUP BY "conversationId"
         ORDER BY "conversationId" NULLS FIRST`
      )
      expect(result.rows).toEqual([
        { conversationId: null, count: 1 },
        { conversationId, count: 1 }
      ])
    } finally {
      await pg.close()
    }
  })
})
