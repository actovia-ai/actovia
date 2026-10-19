import { APP_DISPLAY_NAME } from '@exodus/shared/constants/brand'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { Notification } from 'electron'

import { QUEUE_NAMES } from '../jobs/types'
import { logger } from '../logger'
import { getResourcePath } from '../paths'
import { db, pglite } from './db'

export const runMigrate = async () => {
  try {
    logger.info('migration', 'Running migrations...')
    const start = performance.now()
    await pglite.waitReady
    await pglite.exec('CREATE EXTENSION IF NOT EXISTS vector;')
    // pg_trgm backs the message search index (gin_trgm_ops) — must exist
    // before the migration that creates that index runs.
    await pglite.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
    // getResourcePath('drizzle') resolves to <repo>/resources/drizzle in dev
    // and Contents/Resources/resources/drizzle in a packaged build (see
    // paths.ts) — replaces universal-client's electron-builder-specific
    // `app.asar.unpacked` path, which doesn't apply to forge's packaging.
    await migrate(db, { migrationsFolder: getResourcePath('drizzle') })

    // Idempotent column additions for columns that may have been missed by the migrator
    await pglite.exec(
      `ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "lastRunStatus" varchar;`
    )
    await pglite.exec(
      `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "language" text DEFAULT 'auto';`
    )

    // Job-queue setup runs AFTER the Drizzle migrations on purpose. No
    // migration in resources/drizzle references pgmq, and `@electric-sql/
    // pglite-pgmq`'s peer range does not cover this project's pinned PGlite
    // version — so if the extension ever fails to install, that must not take
    // the core schema migrations down with it (the outer catch below only
    // notifies; it does not rethrow).
    await pglite.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')
    for (const queueName of QUEUE_NAMES) {
      try {
        await pglite.exec(`SELECT pgmq.create('${queueName}');`)
      } catch (error) {
        // Usually just "queue already exists from a previous run" — pgmq.create
        // is not guaranteed idempotent across versions, so tolerate it rather
        // than checking existence first. Logged so a genuine failure is visible.
        logger.error('jobs', `Failed to create queue ${queueName}`, {
          error
        })
      }
    }
    // The retired search-index queue (2026-10-15): nothing reads it any
    // more, so whatever was still waiting in it is dropped.
    try {
      await pglite.exec(
        `SELECT pgmq.drop_queue(queue_name) FROM pgmq.list_queues() WHERE queue_name = 'index-message';`
      )
    } catch (error) {
      logger.error('jobs', 'Failed to drop queue index-message', { error })
    }

    const end = performance.now()
    logger.info('migration', 'Migrations completed', {
      durationMs: end - start
    })
  } catch (error) {
    logger.error('migration', 'Migration failed', {
      error,
      cause: error instanceof Error ? String(error.cause) : undefined
    })
    new Notification({
      title: APP_DISPLAY_NAME,
      body:
        error instanceof Error ? error.message : 'Failed to migrate database.'
    }).show()
  }
}
