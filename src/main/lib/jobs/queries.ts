import { sql } from 'drizzle-orm'

import { db } from '../db/db'
import { applyOriginTraceId } from './origin-trace'
import { QUEUE_NAMES, type JobMessage, type QueueName } from './types'

export async function enqueueJob(
  queueName: QueueName,
  payload: unknown
): Promise<void> {
  const withOrigin = applyOriginTraceId(payload)
  await db.execute(
    sql`SELECT * FROM pgmq.send(${queueName}, ${JSON.stringify(withOrigin)}::jsonb)`
  )
}

interface PgmqReadRow {
  msg_id: number
  read_ct: number
  message: unknown
}

export async function readBatch(
  queueName: QueueName,
  vt: number,
  qty: number
): Promise<JobMessage[]> {
  const result = await db.execute(
    sql`SELECT msg_id, read_ct, message FROM pgmq.read(${queueName}, ${vt}, ${qty})`
  )
  const rows = (result as unknown as { rows: PgmqReadRow[] }).rows ?? []
  return rows.map((row) => ({
    msgId: Number(row.msg_id),
    readCt: Number(row.read_ct),
    message: row.message
  }))
}

/**
 * The `::bigint` cast is required, not cosmetic: pgmq overloads `archive` as
 * both `archive(text, bigint)` and `archive(text, bigint[])`, and an untyped
 * bound parameter matches neither ("function pgmq.archive(unknown, unknown) is
 * not unique"). Covered by `queries.integration.test.ts`.
 */
export async function archiveMessage(
  queueName: QueueName,
  msgId: number
): Promise<void> {
  await db.execute(sql`SELECT pgmq.archive(${queueName}, ${msgId}::bigint)`)
}

/**
 * Removes a finished job for good. Success takes this path rather than
 * `archiveMessage`: nothing ever reads `pgmq.a_*`, and the payloads are heavy
 * (`memory-consolidate` carries the whole conversation) and sensitive (`apiKey`), so archiving every one grew the
 * database by a copy of each chat per turn. Same `::bigint` cast, same reason
 * — `delete` is overloaded on `bigint` / `bigint[]` too.
 */
export async function deleteMessage(
  queueName: QueueName,
  msgId: number
): Promise<void> {
  await db.execute(sql`SELECT pgmq.delete(${queueName}, ${msgId}::bigint)`)
}

/**
 * Empties a queue's archive table. `TRUNCATE` (not `DELETE`) so the disk space
 * actually comes back. The table name can't be a bound parameter; `queueName`
 * is a closed union, never user input.
 */
export async function purgeArchive(queueName: QueueName): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE pgmq."a_${queueName}"`))
}

/**
 * Removes the `apiKey` a build before ledger ruling R3 put in `lcm-post-turn` /
 * `memory-consolidate` payloads, from the live queues and their archives —
 * run once at launch, before the worker starts. Idempotent; a queue this
 * instance never created is skipped. Returns how many payloads it changed.
 */
export async function stripApiKeysFromQueuedJobs(): Promise<number> {
  let stripped = 0
  for (const queueName of QUEUE_NAMES) {
    for (const prefix of ['q', 'a']) {
      const table = `pgmq."${prefix}_${queueName}"`
      const exists = await db.execute(sql`SELECT to_regclass(${table}) AS t`)
      const rows = (exists as unknown as { rows: Array<{ t: unknown }> }).rows
      if (!rows?.[0]?.t) continue
      const result = await db.execute(
        sql.raw(
          `UPDATE ${table} SET message = message - 'apiKey' WHERE message ? 'apiKey'`
        )
      )
      stripped +=
        (result as unknown as { affectedRows?: number }).affectedRows ?? 0
    }
  }
  return stripped
}
