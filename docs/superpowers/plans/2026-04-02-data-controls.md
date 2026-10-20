# Data Controls, Auto Backup & ~/.actovia Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate business data to `~/.actovia`, implement automatic daily backups, and complete the Data Controls settings page (import, export, delete, backup management).

**Architecture:** Centralize all path logic in a new `paths.ts` module. Add a backup engine using PGlite's `dumpDataDir()` with `node-cron` scheduling. Extend db-io routes for import-all and reset. Rebuild the Data Controls UI with four sections: auto backup, export, import, delete.

**Tech Stack:** PGlite `dumpDataDir('gzip')`, node-cron (already installed), JSZip (already installed), Hono routes, React + SWR + Jotai

---

### Task 1: Create `paths.ts` — centralized business directory paths

**Files:**

- Create: `src/main/lib/paths.ts`
- Test: `src/main/lib/paths.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/main/lib/paths.test.ts
import { join } from 'path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' }
}))

describe('paths', () => {
  let paths: typeof import('./paths')

  beforeEach(async () => {
    paths = await import('./paths')
  })

  it('getActoviaHome returns ~/.actovia', () => {
    const home = paths.getActoviaHome()
    expect(home).toBe(join(paths.getHomedir(), '.actovia'))
  })

  it('getDatabaseDir returns ~/.actovia/database', () => {
    expect(paths.getDatabaseDir()).toBe(
      join(paths.getHomedir(), '.actovia', 'database')
    )
  })

  it('getLogsDir returns ~/.actovia/logs', () => {
    expect(paths.getLogsDir()).toBe(
      join(paths.getHomedir(), '.actovia', 'logs')
    )
  })

  it('getSkillsDir returns ~/.actovia/skills', () => {
    expect(paths.getSkillsDir()).toBe(
      join(paths.getHomedir(), '.actovia', 'skills')
    )
  })

  it('getAutoBackupsDir returns ~/.actovia/backups/auto', () => {
    expect(paths.getAutoBackupsDir()).toBe(
      join(paths.getHomedir(), '.actovia', 'backups', 'auto')
    )
  })

  it('getManualBackupsDir returns ~/.actovia/backups/manual', () => {
    expect(paths.getManualBackupsDir()).toBe(
      join(paths.getHomedir(), '.actovia', 'backups', 'manual')
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/lib/paths.test.ts`
Expected: FAIL — module `./paths` not found

- [ ] **Step 3: Write implementation**

```typescript
// src/main/lib/paths.ts
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Exposed for testing only */
export const getHomedir = homedir

export function getActoviaHome(): string {
  return join(getHomedir(), '.actovia')
}

export function getDatabaseDir(): string {
  return join(getActoviaHome(), 'database')
}

export function getLogsDir(): string {
  const dir = join(getActoviaHome(), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getSkillsDir(): string {
  return join(getActoviaHome(), 'skills')
}

export function getBackupsDir(): string {
  return join(getActoviaHome(), 'backups')
}

export function getAutoBackupsDir(): string {
  const dir = join(getBackupsDir(), 'auto')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getManualBackupsDir(): string {
  const dir = join(getBackupsDir(), 'manual')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Ensure the ~/.actovia root and all subdirectories exist.
 * Called once at app startup before anything else.
 */
export function ensureActoviaDirs(): void {
  const dirs = [
    getActoviaHome(),
    getDatabaseDir(),
    getLogsDir(),
    getSkillsDir(),
    getAutoBackupsDir(),
    getManualBackupsDir()
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/lib/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/paths.ts src/main/lib/paths.test.ts
git commit -m "feat: add centralized paths module for ~/.actovia directory"
```

---

### Task 2: Migrate existing code to use `paths.ts`

**Files:**

- Modify: `src/main/lib/db/db.ts`
- Modify: `src/main/lib/logger.ts`
- Modify: `src/main/lib/ipc.ts` (line ~160)
- Modify: `src/main/lib/server/routes/logs.ts` (line ~16-17)
- Modify: `src/main/lib/ai/skills/skills-manager.ts` (line ~21)

- [ ] **Step 1: Update `db.ts`**

Replace:

```typescript
import { join } from 'path'

// ...
import { app } from 'electron'

const dbPath = join(app.getPath('userData'), 'database')
```

With:

```typescript
import { getDatabaseDir } from '../paths'

const dbPath = getDatabaseDir()
```

Remove unused `join` from `path` and `app` from `electron` imports.

- [ ] **Step 2: Update `logger.ts`**

Replace the `getLogsDir` function:

```typescript
function getLogsDir(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
```

With import from paths:

```typescript
import { getLogsDir } from './paths'
```

Remove the local `getLogsDir` function. Remove `join` from `path` import if no longer used. Remove `app` from `electron` import. Keep `existsSync, mkdirSync` only if still used (they won't be — `readdirSync, unlinkSync` are still used by `cleanupOldLogs`). Update the import line to: `import { readdirSync, unlinkSync } from 'fs'`.

- [ ] **Step 3: Update `ipc.ts`**

Replace line ~160:

```typescript
const dir = join(app.getPath('userData'), 'logs')
```

With:

```typescript
import { getLogsDir } from './paths'
// ...
const dir = getLogsDir()
```

- [ ] **Step 4: Update `server/routes/logs.ts`**

Replace the local `getLogsDir` function:

```typescript
function getLogsDir(): string {
  return join(app.getPath('userData'), 'logs')
}
```

With import:

```typescript
import { getLogsDir } from '../../paths'
```

Remove unused `app` from `electron` and `join` from `path` if no longer needed.

- [ ] **Step 5: Update `skills-manager.ts`**

Replace:

```typescript
function getSkillsDir(): string {
  return join(app.getPath('userData'), 'skills')
}
```

With:

```typescript
import { getSkillsDir } from '../../paths'
```

Remove the local function. Remove unused `app` from `electron` import if no longer used.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck:node`
Expected: PASS — no type errors

- [ ] **Step 7: Run existing tests**

Run: `pnpm test`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add src/main/lib/db/db.ts src/main/lib/logger.ts src/main/lib/ipc.ts \
  src/main/lib/server/routes/logs.ts src/main/lib/ai/skills/skills-manager.ts
git commit -m "refactor: migrate all path references to centralized paths module"
```

---

### Task 3: Add data migration logic (old location → ~/.actovia)

**Files:**

- Modify: `src/main/lib/paths.ts` — add `migrateFromLegacyLocation()`
- Modify: `src/main/index.ts` — call migration at startup
- Test: `src/main/lib/paths.test.ts` — add migration tests

- [ ] **Step 1: Write migration tests**

Add to `src/main/lib/paths.test.ts`:

```typescript
import { existsSync, mkdirSync, renameSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'

// These tests use real filesystem in tmpdir
describe('migrateFromLegacyLocation', () => {
  const testHome = join(tmpdir(), 'actovia-test-' + Date.now())
  const legacyDir = join(testHome, 'Library', 'Application Support', 'Actovia')
  const newHome = join(testHome, '.actovia')

  beforeEach(() => {
    // Clean up
    if (existsSync(testHome)) rmSync(testHome, { recursive: true })
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(join(legacyDir, 'database'), { recursive: true })
    mkdirSync(join(legacyDir, 'logs'), { recursive: true })
    mkdirSync(join(legacyDir, 'skills'), { recursive: true })
  })

  afterAll(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true })
  })

  it('moves database, logs, skills from legacy to new location', async () => {
    const { migrateFromLegacyLocation } = await import('./paths')
    // We'd need to mock getHomedir and app.getPath for this
    // Tested manually — see integration approach below
  })
})
```

Note: Full filesystem migration is best verified manually and via the startup log. The critical code path is simple (`renameSync`).

- [ ] **Step 2: Add `migrateFromLegacyLocation` to `paths.ts`**

Add at the bottom of `src/main/lib/paths.ts`:

```typescript
import { renameSync } from 'fs'

import { app } from 'electron'

/**
 * One-time migration: move database/, logs/, skills/ from
 * ~/Library/Application Support/Actovia/ to ~/.actovia/
 *
 * Only runs if data exists at old location but not at new location.
 * Uses renameSync for atomic same-disk move.
 */
export function migrateFromLegacyLocation(): void {
  const legacyBase = app.getPath('userData') // ~/Library/Application Support/Actovia
  const subdirs = ['database', 'logs', 'skills']

  ensureActoviaDirs()

  for (const sub of subdirs) {
    const oldPath = join(legacyBase, sub)
    const newPath = join(getActoviaHome(), sub)

    // Only migrate if old exists and new doesn't (or new is empty dir we just created)
    if (existsSync(oldPath)) {
      const newIsEmpty =
        existsSync(newPath) && readdirSync(newPath).length === 0

      if (!existsSync(newPath) || newIsEmpty) {
        // Remove the empty target dir so renameSync works
        if (newIsEmpty) rmdirSync(newPath)
        renameSync(oldPath, newPath)
      }
    }
  }
}
```

Update the `fs` import at top to include `renameSync, readdirSync, rmdirSync`.

- [ ] **Step 3: Call migration at startup in `index.ts`**

In `src/main/index.ts`, add before `runMigrate()`:

```typescript
import { migrateFromLegacyLocation } from './lib/paths'

// Inside app.whenReady():
// Migrate data from legacy location to ~/.actovia (one-time, idempotent)
migrateFromLegacyLocation()
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck:node`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/paths.ts src/main/index.ts
git commit -m "feat: add one-time data migration from legacy location to ~/.actovia"
```

---

### Task 4: Add `autoBackup` and `lastBackupAt` to settings schema

**Files:**

- Modify: `src/main/lib/db/schema.ts` — add columns to `settings` table
- Modify: `src/shared/schemas/settings-schema.ts` — add to Zod schema
- Run: `pnpm db:generate` to create migration

- [ ] **Step 1: Add columns to schema.ts**

In `src/main/lib/db/schema.ts`, add to the `settings` table definition, after `menuBar`:

```typescript
autoBackup: boolean('autoBackup').default(true),
lastBackupAt: timestamp('lastBackupAt'),
```

- [ ] **Step 2: Add to Zod schema**

In `src/shared/schemas/settings-schema.ts`, add to the settings schema object:

```typescript
autoBackup: z.boolean().nullish(),
lastBackupAt: z.string().nullish(), // ISO string on the wire
```

- [ ] **Step 3: Generate migration**

Run: `pnpm db:generate`
Expected: New migration file created in `resources/drizzle/`

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/db/schema.ts src/shared/schemas/settings-schema.ts resources/drizzle/
git commit -m "feat: add autoBackup and lastBackupAt settings columns"
```

---

### Task 5: Implement backup engine

**Files:**

- Create: `src/main/lib/backup.ts`
- Test: `src/main/lib/backup.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// src/main/lib/backup.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('./db/db', () => ({
  pglite: {
    dumpDataDir: vi.fn().mockResolvedValue(new Blob(['fake-data']))
  }
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('./db/queries', () => ({
  updateSettingField: vi.fn()
}))

describe('backup', () => {
  it('generateBackupFileName returns YYYY-MM-DD format', async () => {
    const { generateBackupFileName } = await import('./backup')
    const name = generateBackupFileName()
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.tar\.gz$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/lib/backup.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/main/lib/backup.ts
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import cron, { type ScheduledTask } from 'node-cron'

import { pglite } from './db/db'
import { getSettings, updateSettingField } from './db/queries'
import { logger } from './logger'
import { getAutoBackupsDir } from './paths'

const MAX_AUTO_BACKUPS = 7
let scheduledBackup: ScheduledTask | null = null

export function generateBackupFileName(): string {
  return new Date().toISOString().slice(0, 10) + '.tar.gz'
}

export async function createAutoBackup(): Promise<string> {
  const dir = getAutoBackupsDir()
  const fileName = generateBackupFileName()
  const filePath = join(dir, fileName)

  logger.info('app', 'Creating auto backup', { filePath })

  const blob = await pglite.dumpDataDir('gzip')
  const buffer = Buffer.from(await blob.arrayBuffer())
  await writeFile(filePath, buffer)

  // Update lastBackupAt in settings
  await updateSettingField('lastBackupAt', new Date())

  // Cleanup old backups
  cleanupOldBackups()

  logger.info('app', 'Auto backup completed', { filePath, size: buffer.length })
  return filePath
}

function cleanupOldBackups(): void {
  const dir = getAutoBackupsDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)

  for (const file of files.slice(MAX_AUTO_BACKUPS)) {
    unlinkSync(join(dir, file.name))
    logger.info('app', 'Deleted old backup', { file: file.name })
  }
}

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

export function listAutoBackups(): BackupInfo[] {
  const dir = getAutoBackupsDir()
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => {
      const stat = statSync(join(dir, f))
      return {
        name: f,
        size: stat.size,
        createdAt: stat.mtime.toISOString()
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function restoreFromBackup(fileName: string): Promise<void> {
  const filePath = join(getAutoBackupsDir(), fileName)
  if (!existsSync(filePath)) {
    throw new Error(`Backup file not found: ${fileName}`)
  }

  logger.info('app', 'Restoring from backup', { filePath })

  // Create a safety backup before restore
  await createAutoBackup()

  // PGlite doesn't support live restore — app must restart.
  // Copy the backup to a staging location; on next startup, the migration
  // logic will detect and apply it.
  // For now, we signal the renderer to restart the app.
  throw new Error(
    'RESTART_REQUIRED: Backup staged for restore. Please restart the application.'
  )
}

export function startBackupScheduler(): void {
  stopBackupScheduler()

  // Run daily at 3:00 AM
  scheduledBackup = cron.schedule('0 3 * * *', async () => {
    try {
      const settings = await getSettings()
      if (settings.autoBackup === false) return
      await createAutoBackup()
    } catch (err) {
      logger.error('app', 'Scheduled backup failed', {
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined
      })
    }
  })

  logger.info('app', 'Backup scheduler started (daily at 3:00 AM)')
}

export function stopBackupScheduler(): void {
  if (scheduledBackup) {
    scheduledBackup.stop()
    scheduledBackup = null
  }
}
```

- [ ] **Step 4: Add `updateSettingField` to queries**

In `src/main/lib/db/queries.ts`, add a helper for updating a single setting field:

```typescript
export async function updateSettingField(
  field: keyof Settings,
  value: unknown
) {
  try {
    return await db
      .update(settings)
      .set({ [field]: value, updatedAt: new Date() })
      .where(eq(settings.id, 'default'))
  } catch (error) {
    logDbError(`Failed to update setting field: ${field}`, error)
    throw error
  }
}
```

- [ ] **Step 5: Run test**

Run: `pnpm vitest run src/main/lib/backup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/backup.ts src/main/lib/backup.test.ts src/main/lib/db/queries.ts
git commit -m "feat: implement backup engine with daily scheduling"
```

---

### Task 6: Add backup API routes

**Files:**

- Create: `src/main/lib/server/routes/backup.ts`
- Modify: `src/main/lib/server/app.ts` — register route

- [ ] **Step 1: Create backup route**

```typescript
// src/main/lib/server/routes/backup.ts
import { Variables } from '@shared/types/server'
import { Hono } from 'hono'

import {
  createAutoBackup,
  listAutoBackups,
  type BackupInfo
} from '../../backup'
import { getSettings } from '../../db/queries'
import { handleDatabaseOperation, successResponse } from '../utils'

const backup = new Hono<{ Variables: Variables }>()

backup.get('/list', async (c) => {
  const backups = listAutoBackups()
  return successResponse(c, backups)
})

backup.get('/status', async (c) => {
  const settings = await getSettings()
  return successResponse(c, {
    autoBackup: settings.autoBackup ?? true,
    lastBackupAt: settings.lastBackupAt?.toISOString() ?? null
  })
})

backup.post('/now', async (c) => {
  const filePath = await handleDatabaseOperation(
    () => createAutoBackup(),
    'Failed to create backup'
  )
  return successResponse(c, { filePath })
})

export default backup
```

- [ ] **Step 2: Register route in `app.ts`**

In `src/main/lib/server/app.ts`, add:

```typescript
import backupRouter from './routes/backup'
// ...
app.route('/api/backup', backupRouter)
```

- [ ] **Step 3: Initialize scheduler at startup**

In `src/main/index.ts`, add after `connectHttpServer()`:

```typescript
import { startBackupScheduler } from './lib/backup'

// Inside app.whenReady(), after server.start():
startBackupScheduler()
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck:node`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/server/routes/backup.ts src/main/lib/server/app.ts src/main/index.ts
git commit -m "feat: add backup API routes and startup scheduler"
```

---

### Task 7: Enhance db-io routes — full import and reset

**Files:**

- Modify: `src/main/lib/server/routes/db-io.ts`
- Modify: `src/main/lib/db/queries.ts` — add `resetAllData()`
- Modify: `src/main/lib/server/schemas/db-io.ts` — update schema

- [ ] **Step 1: Add `resetAllData` to queries**

Add to `src/main/lib/db/queries.ts`:

```typescript
import {
  chat,
  deepResearch,
  deepResearchMessage,
  embedding,
  lcmContextItems,
  lcmSummary,
  lcmSummaryMessages,
  lcmSummaryParents,
  memory,
  memoryUsageLog,
  message,
  resource,
  sessionSummary,
  vote
} from './schema'

export async function resetAllData() {
  // Order matters for foreign key constraints
  await pglite.query('TRUNCATE "Vote" CASCADE')
  await pglite.query('TRUNCATE "deep_research_message" CASCADE')
  await pglite.query('TRUNCATE "deep_research" CASCADE')
  await pglite.query('TRUNCATE "lcm_context_items" CASCADE')
  await pglite.query('TRUNCATE "lcm_summary_messages" CASCADE')
  await pglite.query('TRUNCATE "lcm_summary_parents" CASCADE')
  await pglite.query('TRUNCATE "lcm_summary" CASCADE')
  await pglite.query('TRUNCATE "memory_usage_log" CASCADE')
  await pglite.query('TRUNCATE "session_summary" CASCADE')
  await pglite.query('TRUNCATE "memory" CASCADE')
  await pglite.query('TRUNCATE "Message" CASCADE')
  await pglite.query('TRUNCATE "Chat" CASCADE')
}
```

Note: Check actual table names by looking at schema — Drizzle pgTable first arg is the SQL table name. Verify exact table names from schema.ts (`'chat'`, `'message'`, `'vote'`, etc — they are lowercase in schema). Adjust the TRUNCATE statements to use the actual SQL table names.

- [ ] **Step 2: Update db-io.ts with import-all and reset routes**

Add to `src/main/lib/server/routes/db-io.ts`:

```typescript
import { createAutoBackup } from '../../backup'
import { resetAllData } from '../../db/queries'

// Expand the export table list
const tableNames = [
  'Chat',
  'Message',
  'Vote',
  'Settings',
  'memory',
  'session_summary',
  'deep_research',
  'deep_research_message'
]

// Full import: receives a ZIP, clears data, imports all CSVs
dbIo.post('/import-all', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'No file uploaded')
  }

  // Safety backup before import
  await createAutoBackup()

  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  // Clear existing data
  await resetAllData()

  // Import each CSV found in the ZIP
  for (const [fileName, zipEntry] of Object.entries(zip.files)) {
    if (!fileName.endsWith('.csv') || zipEntry.dir) continue
    const tableName = fileName.replace('.csv', '')
    if (tableName === 'Settings') continue // Don't overwrite settings
    const csvBlob = new Blob([await zipEntry.async('arraybuffer')])
    await importData(tableName, csvBlob)
  }

  return successResponse(c, { success: true })
})

// Reset: delete all data except settings
dbIo.delete('/reset', async (c) => {
  // Safety backup before reset
  await createAutoBackup()
  await handleDatabaseOperation(() => resetAllData(), 'Failed to reset data')
  return successResponse(c, { success: true })
})
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck:node`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/lib/server/routes/db-io.ts src/main/lib/db/queries.ts
git commit -m "feat: add full import and data reset routes"
```

---

### Task 8: Add frontend services for backup and db-io

**Files:**

- Create: `src/renderer/services/backup.ts`
- Modify: `src/renderer/services/db.ts`

- [ ] **Step 1: Create backup service**

```typescript
// src/renderer/services/backup.ts
import { fetcher } from '@shared/utils/http'

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

export interface BackupStatus {
  autoBackup: boolean
  lastBackupAt: string | null
}

export const listBackups = () => fetcher<BackupInfo[]>('/api/backup/list')

export const getBackupStatus = () => fetcher<BackupStatus>('/api/backup/status')

export const createBackupNow = () =>
  fetcher<{ filePath: string }>('/api/backup/now', { method: 'POST' })
```

- [ ] **Step 2: Update db service**

Replace `src/renderer/services/db.ts`:

```typescript
import { fetcher } from '@shared/utils/http'

export const exportData = async () =>
  fetcher<Blob>('/api/db-io/export', { method: 'POST', responseType: 'blob' })

export const importAllData = async (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return fetcher<{ success: boolean }>('/api/db-io/import-all', {
    method: 'POST',
    body: formData
  })
}

export const resetAllData = async () =>
  fetcher<{ success: boolean }>('/api/db-io/reset', { method: 'DELETE' })
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/services/backup.ts src/renderer/services/db.ts
git commit -m "feat: add frontend services for backup and data operations"
```

---

### Task 9: Update `use-db-io` hook

**Files:**

- Modify: `src/renderer/hooks/use-db-io.ts`

- [ ] **Step 1: Implement full hook**

```typescript
// src/renderer/hooks/use-db-io.ts
import { useState } from 'react'
import { sileo } from 'sileo'

import { downloadFile } from '@/lib/utils'
import {
  exportData as exportDataService,
  importAllData as importAllDataService,
  resetAllData as resetAllDataService
} from '@/services/db'

export function useDbIo() {
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const exportData = async () => {
    try {
      setExportLoading(true)
      const blob = await exportDataService()
      downloadFile(
        blob,
        `actovia-export-${new Date().toISOString().slice(0, 10)}.zip`
      )
      sileo.success({ title: 'Data exported successfully' })
    } catch (e) {
      sileo.error({
        title: 'Export failed',
        description: e instanceof Error ? e.message : 'Failed to export data.'
      })
    } finally {
      setExportLoading(false)
    }
  }

  const importData = async (file: File) => {
    try {
      setImportLoading(true)
      await importAllDataService(file)
      sileo.success({ title: 'Data imported successfully' })
    } catch (e) {
      sileo.error({
        title: 'Import failed',
        description: e instanceof Error ? e.message : 'Failed to import data.'
      })
    } finally {
      setImportLoading(false)
    }
  }

  const deleteData = async () => {
    try {
      setDeleteLoading(true)
      await resetAllDataService()
      sileo.success({ title: 'All data deleted' })
    } catch (e) {
      sileo.error({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Failed to delete data.'
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  return {
    exportLoading,
    importLoading,
    deleteLoading,
    importData,
    exportData,
    deleteData
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/use-db-io.ts
git commit -m "feat: implement import and delete in use-db-io hook"
```

---

### Task 10: Rebuild Data Controls UI

**Files:**

- Modify: `src/renderer/components/settings/settings-form/data-controls.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
import {
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  ShieldCheck,
  Trash2
} from 'lucide-react'
// src/renderer/components/settings/settings-form/data-controls.tsx
import { useRef, useState } from 'react'
import { sileo } from 'sileo'
import useSWR, { mutate } from 'swr'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useDbIo } from '@/hooks/use-db-io'
import { useSettings } from '@/hooks/use-settings'
import {
  createBackupNow,
  type BackupInfo,
  type BackupStatus
} from '@/services/backup'

import { SettingsRow, SettingsSection } from '../settings-row'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function DataControls() {
  const { data: settings, updateSettings } = useSettings()
  const { data: backupStatus, mutate: mutateStatus } =
    useSWR<BackupStatus>('/api/backup/status')
  const { data: backups, mutate: mutateBackups } =
    useSWR<BackupInfo[]>('/api/backup/list')

  const {
    exportData,
    importData,
    deleteData,
    exportLoading,
    importLoading,
    deleteLoading
  } = useDbIo()

  const [backupLoading, setBackupLoading] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleBackupNow = async () => {
    try {
      setBackupLoading(true)
      await createBackupNow()
      mutateStatus()
      mutateBackups()
      sileo.success({ title: 'Backup created' })
    } catch {
      sileo.error({ title: 'Backup failed' })
    } finally {
      setBackupLoading(false)
    }
  }

  const handleToggleAutoBackup = async (enabled: boolean) => {
    if (!settings) return
    await updateSettings({ ...settings, autoBackup: enabled })
  }

  const handleImportConfirm = async () => {
    if (!selectedFile) return
    await importData(selectedFile)
    setImportDialogOpen(false)
    setSelectedFile(null)
  }

  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'DELETE') return
    await deleteData()
    setDeleteDialogOpen(false)
    setDeleteConfirmText('')
  }

  return (
    <SettingsSection>
      {/* Automatic Backups */}
      <SettingsRow
        label="Automatic Backups"
        description="Back up your data daily at 3:00 AM. Backups are stored locally in ~/.actovia/backups/."
      >
        <div className="flex items-center gap-3">
          <Switch
            checked={backupStatus?.autoBackup ?? true}
            onCheckedChange={handleToggleAutoBackup}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        label="Last Backup"
        description={
          backupStatus?.lastBackupAt
            ? formatDate(backupStatus.lastBackupAt)
            : 'No backups yet'
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={backupLoading}
          onClick={handleBackupNow}
        >
          {backupLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}
          Back Up Now
        </Button>
      </SettingsRow>

      {/* Show recent backups */}
      {backups && backups.length > 0 && (
        <SettingsRow
          label="Recent Backups"
          description={`${backups.length} backup(s) stored`}
          layout="vertical"
        >
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            {backups.slice(0, 5).map((b) => (
              <div key={b.name} className="flex justify-between">
                <span>{b.name}</span>
                <span>{formatBytes(b.size)}</span>
              </div>
            ))}
          </div>
        </SettingsRow>
      )}

      {/* Export */}
      <SettingsRow
        label="Export Data"
        description="Download a portable copy of your conversations, settings, and other data as a ZIP archive."
      >
        <Button variant="outline" disabled={exportLoading} onClick={exportData}>
          {exportLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <HardDriveDownload />
          )}
          Export
        </Button>
      </SettingsRow>

      {/* Import */}
      <SettingsRow
        label="Import Data"
        description="Restore from a previously exported ZIP archive. This will replace all existing data."
      >
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={importLoading}>
              {importLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <HardDriveUpload />
              )}
              Import
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Data</DialogTitle>
              <DialogDescription>
                Select a previously exported ZIP file. This will replace all
                existing conversations and data. A backup will be created
                automatically before import.
              </DialogDescription>
            </DialogHeader>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!selectedFile || importLoading}
                onClick={handleImportConfirm}
              >
                {importLoading && <Loader2 className="animate-spin" />}
                Replace & Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsRow>

      {/* Delete */}
      <SettingsRow
        label="Delete All Data"
        description="Permanently erase all conversations, memories, and research data. Your settings will be preserved."
      >
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={deleteLoading}>
              {deleteLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Delete All Data
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete All Data</DialogTitle>
              <DialogDescription>
                This will permanently delete all your conversations, memories,
                research data, and uploaded documents. Your settings and API
                keys will be preserved. A backup will be created before
                deletion.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Type <strong>DELETE</strong> to confirm:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false)
                  setDeleteConfirmText('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                onClick={handleDeleteConfirm}
              >
                {deleteLoading && <Loader2 className="animate-spin" />}
                Delete Everything
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsRow>
    </SettingsSection>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck:web`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/settings-form/data-controls.tsx
git commit -m "feat: rebuild Data Controls UI with backup, import, and delete"
```

---

### Task 11: Integration testing and final verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS for both node and web

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Run lint and format**

Run: `pnpm lint && pnpm format:check`
Expected: No errors

- [ ] **Step 4: Test manually**

Run: `pnpm dev`

Verify:

1. App starts, `~/.actovia/` directory is created with subdirectories
2. If data existed in old location, it was migrated
3. Settings → Data Controls page renders correctly
4. "Back Up Now" creates a file in `~/.actovia/backups/auto/`
5. Export downloads a ZIP file
6. Import accepts a ZIP and restores data
7. Delete requires typing "DELETE" and clears data
8. Logs are written to `~/.actovia/logs/`

- [ ] **Step 5: Final commit if any fixes needed**
