import { describe, expect, it } from 'vitest'

import { createMigratedPglite } from '../../../../helpers/migrated-pglite'

describe('migration 0015 — coding agents', () => {
  it('adds runtime to agents with actovia as the default', async () => {
    const pg = await createMigratedPglite('0015')
    await pg.exec(`INSERT INTO agent (name) VALUES ('Ada')`)
    const { rows } = await pg.query<{
      runtime: string
      permissionMode: string | null
    }>(`SELECT runtime, "permissionMode" FROM agent`)
    expect(rows).toEqual([{ runtime: 'actovia', permissionMode: null }])
    await pg.close()
  })

  it('links a conversation to a project and a session to both', async () => {
    const pg = await createMigratedPglite('0015')
    const p = await pg.query<{ id: string }>(
      `INSERT INTO project (name, dir, "workDir") VALUES ('notes', '/p/notes', '/p/notes') RETURNING id`
    )
    const c = await pg.query<{ id: string }>(
      `INSERT INTO conversation (title, "projectId") VALUES ('g', $1) RETURNING id`,
      [p.rows[0].id]
    )
    await pg.query(
      `INSERT INTO agent_session ("projectId", "conversationId", runtime, cwd) VALUES ($1, $2, 'claude-code', '/p/notes')`,
      [p.rows[0].id, c.rows[0].id]
    )
    const s = await pg.query<{ state: string }>(
      `SELECT state FROM agent_session`
    )
    expect(s.rows[0].state).toBe('working')
    await pg.exec(`DELETE FROM project`)
    const after = await pg.query(`SELECT 1 FROM agent_session`)
    expect(after.rows).toHaveLength(0) // cascade
    const conv = await pg.query<{ projectId: string | null }>(
      `SELECT "projectId" FROM conversation`
    )
    expect(conv.rows[0].projectId).toBeNull() // set null
    await pg.close()
  })

  it('refuses two projects with the same dir', async () => {
    const pg = await createMigratedPglite('0015')
    await pg.exec(
      `INSERT INTO project (name, dir, "workDir") VALUES ('a', '/p/a', '/p/a')`
    )
    await expect(
      pg.exec(
        `INSERT INTO project (name, dir, "workDir") VALUES ('b', '/p/a', '/x')`
      )
    ).rejects.toThrow()
    await pg.close()
  })
})

describe('a fresh database', () => {
  it('has agent_runtime = {actovia, claude-code, codex}, defaulting to actovia', async () => {
    const pg = await createMigratedPglite('9999')
    const labels = await pg.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'agent_runtime' ORDER BY e.enumlabel`
    )
    expect(labels.rows.map((r) => r.enumlabel)).toEqual([
      'actovia',
      'claude-code',
      'codex'
    ])
    await pg.exec(`INSERT INTO agent (name) VALUES ('Ada')`)
    const { rows } = await pg.query<{ runtime: string }>(
      `SELECT runtime FROM agent`
    )
    expect(rows[0].runtime).toBe('actovia')
    await pg.close()
  })
})
