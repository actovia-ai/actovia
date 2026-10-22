import { mkdirSync } from 'fs'

import { PGlite } from '@electric-sql/pglite'
import { pgmq } from '@electric-sql/pglite-pgmq'
import { vector } from '@electric-sql/pglite-pgvector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'

import { getDatabaseDir } from '../paths'
import { holdSingleInstanceLock } from '../single-instance'
import { pinSessionUtc } from './session'

// PGlite has no cross-process lock, so nothing may open the data directory
// until this process holds the app's single-instance lock. It is taken here —
// not in main.ts — because this module opens the database as it is imported,
// before any code in main.ts's body gets to run. Ends the process if another
// instance owns the directory.
holdSingleInstanceLock()

// PGlite's own dataDir mkdir isn't recursive — it needs the parent
// (`getActoviaHome()`) to already exist. This module is evaluated at import
// time (ES module hoisting), before `app.on('ready')`'s `ensureActoviaDirs()`
// call ever runs, so it can't rely on that — it must create its own
// directory tree up front.
const dbPath = getDatabaseDir()
mkdirSync(dbPath, { recursive: true })
export const pglite = new PGlite({
  dataDir: dbPath,
  extensions: { vector, pgmq, pg_trgm }
})
// Queued ahead of every other query (see session.ts). `runMigrate` awaits it,
// so a failure is reported there; the empty catch only keeps it from being an
// unhandled rejection until then.
export const sessionPinned = pinSessionUtc(pglite)
sessionPinned.catch(() => {})

export const db = drizzle(pglite)
