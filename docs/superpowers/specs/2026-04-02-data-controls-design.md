# Data Controls, Auto Backup & ~/.actovia Migration

**Date**: 2026-04-02
**Status**: Approved

## 1. ~/.actovia Directory Structure

```
~/.actovia/
├── database/          # PGlite data files (migrated from old location)
├── logs/              # Application logs (JSONL, 7-day retention)
├── skills/            # Skill files
└── backups/
    ├── auto/          # Daily PGlite snapshots (dumpDataDir, gzipped)
    └── manual/        # Manual CSV ZIP exports
```

Electron's own data (Cache, Session Storage, blob_storage) stays in `~/Library/Application Support/Actovia`.

## 2. Data Directory Migration

### New module: `src/main/lib/paths.ts`

Centralizes all business data paths:

- `getActoviaHome()` → `~/.actovia`
- `getDatabaseDir()` → `~/.actovia/database`
- `getLogsDir()` → `~/.actovia/logs`
- `getSkillsDir()` → `~/.actovia/skills`
- `getBackupsDir()` → `~/.actovia/backups`
- `getAutoBackupsDir()` → `~/.actovia/backups/auto`
- `getManualBackupsDir()` → `~/.actovia/backups/manual`

### Migration logic (runs once at startup)

1. Check if `~/.actovia/database` exists
2. If not, check if `~/Library/Application Support/Actovia/database` exists
3. If old location exists, move via `fs.renameSync` (same disk = instant)
4. Same for `logs/` and `skills/`
5. Migration is idempotent — once files are in new location, no-op

### Files to update

- `src/main/lib/db/db.ts` — use `getDatabaseDir()`
- `src/main/lib/logger.ts` — use `getLogsDir()`
- `src/main/lib/server/routes/logs.ts` — use `getLogsDir()`
- `src/main/lib/ipc.ts` — use `getLogsDir()`
- `src/main/lib/ai/skills/skills-manager.ts` — use `getSkillsDir()`

## 3. Automatic Backups

### New module: `src/main/lib/backup.ts`

**Backup engine:**

- `createAutoBackup()`: calls `pglite.dumpDataDir()`, gzip compresses, writes to `~/.actovia/backups/auto/YYYY-MM-DD.tar.gz`
- `cleanupOldBackups()`: keeps most recent 7 files, deletes older ones
- `restoreFromBackup(filePath)`: stops PGlite, replaces database dir with extracted backup, restarts
- `listAutoBackups()`: returns sorted list of backup files with metadata (name, size, date)
- `initBackupScheduler()`: registers daily cron job at `0 3 * * *` (3 AM)

**Scheduling:**

- Uses `node-cron` (already installed)
- Backup enabled/disabled via setting stored in DB (`autoBackup` boolean)
- Records `lastBackupAt` timestamp in settings

### New API routes: `src/main/lib/server/routes/backup.ts`

- `GET /api/backup/list` — list auto backups
- `POST /api/backup/now` — trigger immediate backup
- `POST /api/backup/restore` — restore from a specific backup file
- `GET /api/backup/status` — last backup time, enabled/disabled

## 4. Data Controls UI

### File: `src/renderer/components/settings/settings-form/data-controls.tsx`

Four sections:

### 4.1 Automatic Backups

- Toggle switch (on/off)
- "Last backup: [date]" display
- "Back Up Now" button
- "Restore from Backup" dropdown → select from list → confirmation dialog

### 4.2 Export Data

- Description: "Download a portable copy of your conversations, settings, and other data as a ZIP archive."
- Button: "Export Data" (existing logic, downloads CSV ZIP)

### 4.3 Import Data

- Description: "Restore from a previously exported ZIP archive. This will replace all existing data."
- Button: "Import Data" → file picker (.zip) → confirmation dialog → upload → import
- Flow: select file → confirm ("This will replace all existing data. Continue?") → upload to backend → clear tables → import CSVs → auto-backup → success toast

### 4.4 Delete All Data

- Description: "Permanently erase all conversations, memories, and research data. Your settings will be preserved."
- Button: "Delete All Data" (destructive red)
- Requires typing "DELETE" in confirmation dialog
- Backend clears all tables except Settings
- Auto-backup triggered before deletion

## 5. Import Implementation

### Backend: update `src/main/lib/server/routes/db-io.ts`

Enhanced import route (`POST /api/db-io/import`):

1. Receive uploaded ZIP file
2. Extract and validate CSV files
3. Begin transaction
4. Truncate target tables (Chat, Message, Vote — NOT Settings)
5. `COPY FROM` each CSV
6. Commit transaction
7. Trigger auto-backup
8. Return success

### Frontend: update `src/renderer/hooks/use-db-io.ts`

- `importData()`: file picker → read file → confirmation → upload FormData → toast result

## 6. Delete Implementation

### Backend: new route in `db-io.ts`

`DELETE /api/db-io/reset`:

1. Trigger auto-backup (safety net)
2. Truncate tables: Message, Chat, Vote, Memory, Embedding, Resource, DeepResearch, DeepResearchMessage, SessionSummary, MemoryUsageLog
3. Return success

### Frontend

- Confirmation dialog requiring "DELETE" typed input
- Calls reset endpoint
- Success toast + page refresh

## 7. Tables included in export/import

Current: Chat, Message, Vote, Settings

Updated export: Chat, Message, Vote, Settings, Memory, Resource, Embedding, DeepResearch, DeepResearchMessage, SessionSummary

Import overwrites all of the above except Settings.

## 8. Error Handling

- All destructive operations (import, delete, restore) create a backup first
- Restore failure leaves current data intact (extract to temp dir first, then swap)
- Import uses transaction — rollback on any CSV parse error
