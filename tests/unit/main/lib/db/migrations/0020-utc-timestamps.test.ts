import type { PGlite } from '@electric-sql/pglite'
import { chat, conversation, memory, message } from '@main/lib/db/schema'
import { pinSessionUtc } from '@main/lib/db/session'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'

import {
  createMigratedPglite,
  migrationFile,
  migrationSql
} from '../../../../helpers/migrated-pglite'

/** A database from before the pin: initialised in `zone`, never SET to UTC. */
async function legacyDatabase(zone: string): Promise<PGlite> {
  return createMigratedPglite('0019', { utc: false, zone })
}

/** What the app writes before 0020: DB-defaulted rows, JS-stamped values. */
async function seed(pg: PGlite) {
  const db = drizzle(pg)
  const before = Date.now()
  // Raw SQL: the schema now names columns 0019 does not have yet (0021).
  const c = { id: crypto.randomUUID() }
  await pg.query(`INSERT INTO "chat" ("id","title") VALUES ($1,'Chat')`, [c.id])
  const sent = new Date()
  await db.insert(message).values({
    chatId: c.id,
    runId: crypto.randomUUID(),
    role: 'user',
    content: [],
    createdAt: sent
  })
  const [fresh] = await db
    .insert(memory)
    .values({
      userId: crypto.randomUUID(),
      key: 'Fresh',
      summary: 'Untouched since it was made',
      source: 'implicit'
    })
    .returning()
  const [edited] = await db
    .insert(memory)
    .values({
      userId: crypto.randomUUID(),
      key: 'Edited',
      summary: 'Updated from JS',
      source: 'implicit'
    })
    .returning()
  const editedAt = new Date()
  await db
    .update(memory)
    .set({ summary: 'Changed', updatedAt: editedAt })
    .where(eq(memory.id, edited.id))
  const [group] = await db
    .insert(conversation)
    .values({ title: 'Group' })
    .returning()
  const messagedAt = new Date()
  await db
    .update(conversation)
    .set({ lastMessageAt: messagedAt, updatedAt: messagedAt })
    .where(eq(conversation.id, group.id))
  return {
    before,
    chatId: c.id,
    sent,
    fresh,
    edited,
    editedAt,
    group,
    messagedAt
  }
}

async function migrate(pg: PGlite) {
  await pinSessionUtc(pg)
  await pg.exec(migrationSql(migrationFile('0020')))
}

describe('migration 0020 — DEFAULT now() values onto UTC', () => {
  it('moves what the defaults wrote in Shanghai and leaves what JS wrote', async () => {
    const pg = await legacyDatabase('Asia/Shanghai')
    const s = await seed(pg)
    const db = drizzle(pg)

    // The bug: a defaulted value reads back eight hours ahead.
    const [stale] = await db
      .select({ createdAt: chat.createdAt })
      .from(chat)
      .where(eq(chat.id, s.chatId))
    expect(stale.createdAt.getTime() - s.before).toBeGreaterThan(7 * 3600_000)

    await migrate(pg)

    const near = (d: Date | null) =>
      Math.abs((d?.getTime() ?? 0) - s.before) < 1000
    const [c] = await db
      .select({ createdAt: chat.createdAt })
      .from(chat)
      .where(eq(chat.id, s.chatId))
    expect(near(c.createdAt)).toBe(true)

    const [m] = await db.select().from(message)
    expect(m.createdAt.getTime()).toBe(s.sent.getTime())

    const [fresh] = await db
      .select()
      .from(memory)
      .where(eq(memory.id, s.fresh.id))
    expect(near(fresh.createdAt)).toBe(true)
    expect(near(fresh.updatedAt)).toBe(true)

    const [edited] = await db
      .select()
      .from(memory)
      .where(eq(memory.id, s.edited.id))
    expect(near(edited.createdAt)).toBe(true)
    expect(edited.updatedAt?.getTime()).toBe(s.editedAt.getTime())

    const [group] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, s.group.id))
    expect(near(group.createdAt)).toBe(true)
    expect(group.lastMessageAt.getTime()).toBe(s.messagedAt.getTime())
    expect(group.updatedAt.getTime()).toBe(s.messagedAt.getTime())
    await pg.close()
  })

  it('changes nothing in a database initialised in UTC', async () => {
    const pg = await legacyDatabase('UTC')
    const s = await seed(pg)
    const rows = async () =>
      (
        await pg.query(
          `SELECT "createdAt", "updatedAt" FROM memory ORDER BY key`
        )
      ).rows
    const before = await rows()
    const chatBefore = (await pg.query(`SELECT "createdAt" FROM chat`)).rows

    await migrate(pg)

    expect(await rows()).toEqual(before)
    expect((await pg.query(`SELECT "createdAt" FROM chat`)).rows).toEqual(
      chatBefore
    )
    const [c] = await drizzle(pg)
      .select({ createdAt: chat.createdAt })
      .from(chat)
      .where(eq(chat.id, s.chatId))
    expect(Math.abs(c.createdAt.getTime() - s.before)).toBeLessThan(1000)
    await pg.close()
  })
})
