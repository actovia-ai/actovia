# Logger — Design Spec

**Date**: 2026-03-24

---

## Overview

Add a lightweight, built-in logging system to Actovia. Logs are written as JSONL files (one per day) in the userData directory. A new Logger page in Settings provides filtering, search, and management.

---

## 1. Storage

### Format & Location

- **Format**: JSONL — one JSON object per line, append-only
- **Directory**: `~/.app/logs/` (inside Electron's `app.getPath('userData')`)
- **File naming**: `YYYY-MM-DD.jsonl` (e.g., `2026-03-24.jsonl`)

### Retention

- Keep files for **7 days**
- On app startup, delete any `.jsonl` files older than 7 days
- "Clear logs" action in UI deletes all files

### Log Entry Schema

```json
{
  "ts": "2026-03-24T10:30:00.000Z",
  "level": "error",
  "surface": "chat",
  "message": "Stream failed",
  "detail": { "error": "Connection timeout" }
}
```

| Field     | Type                                           | Required | Description                                                                                                                                   |
| --------- | ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts`      | string (ISO 8601)                              | yes      | Timestamp                                                                                                                                     |
| `level`   | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | yes      | Severity                                                                                                                                      |
| `surface` | string                                         | yes      | Subsystem (reuses existing `Surface` type from `errors.ts`: chat, database, mcp, audio, etc.) Plus new surfaces: `app`, `server`, `migration` |
| `message` | string                                         | yes      | Human-readable description                                                                                                                    |
| `detail`  | object \| null                                 | no       | Structured metadata (error stack, request params, timing, etc.)                                                                               |

### Level Policy (fixed, not user-configurable)

- **Development** (`is.dev === true`): log `debug` and above
- **Production**: log `info` and above

---

## 2. Backend Logger Module

### File: `src/main/lib/logger.ts`

Zero-dependency module. Core API:

```typescript
logger.debug(surface, message, detail?)
logger.info(surface, message, detail?)
logger.warn(surface, message, detail?)
logger.error(surface, message, detail?)
```

### Behavior

- Each call appends one JSON line to today's file (`~/.app/logs/YYYY-MM-DD.jsonl`)
- Uses `fs.appendFile` (async, non-blocking)
- Also writes to `console.*` so terminal/DevTools output is preserved
- On first call of the day (or app startup), creates the file if it doesn't exist
- On startup, runs cleanup: deletes files older than 7 days

### Migration of Existing Console Calls

Replace all 44 `console.*` calls in `src/main/` with the appropriate `logger.*` call. Map existing patterns:

- `console.log('✅ Migrations completed...')` → `logger.info('migration', 'Migrations completed', { durationMs })`
- `console.error('[chat] Failed to...')` → `logger.error('chat', 'Failed to...', { error })`
- `console.log('✅ Hono is running on', port)` → `logger.info('server', 'Hono is running', { port })`

---

## 3. API Routes

### File: `src/main/lib/server/routes/logs.ts`

**`GET /api/logs`** — Query log entries

Query params:

- `date` (string, `YYYY-MM-DD`, default: today)
- `level` (string, optional — minimum level filter)
- `surface` (string, optional — exact match)
- `keyword` (string, optional — substring match on `message`)
- `page` (number, default: 1)
- `pageSize` (number, default: 100)

Response: `{ entries: LogEntry[], total: number, page: number }`

Implementation: read the JSONL file for the given date, parse line by line, apply filters, paginate.

**`GET /api/logs/dates`** — List available log dates

Response: `{ dates: string[] }` — array of `YYYY-MM-DD` strings, sorted descending

Implementation: list `*.jsonl` files in the logs directory, extract dates from filenames.

**`DELETE /api/logs`** — Clear all logs

Deletes all `.jsonl` files in the logs directory.

**`GET /api/logs/export`** — Export a day's log file

Query params: `date` (string, `YYYY-MM-DD`)

Response: raw JSONL file as download (`Content-Disposition: attachment`)

---

## 4. Settings UI — Logger Page

### Menu Placement

In `settings-menu.ts`, add between Data Controls and About Actovia:

```typescript
{
  icon: ScrollTextIcon,
  title: SettingsLabel.Logger
}
```

### Page Layout

**Top bar** (filters):

- Date picker — select from available dates (populated from `GET /api/logs/dates`)
- Level dropdown — All / Debug / Info / Warn / Error (filters entries >= selected level)
- Surface dropdown — All / chat / database / ... (populated from entries)
- Keyword search — text input with debounce, matches against `message` field

**Action buttons** (top right):

- "Open Log Directory" — opens `~/.app/logs/` in system file manager via `shell.openPath`
- "Export" — downloads current date's JSONL file
- "Clear All" — deletes all log files with confirmation dialog

**Log table**:

- Columns: Time (HH:mm:ss), Level (colored badge), Surface (badge), Message
- Sorted newest first
- Click row to expand and show `detail` as formatted JSON
- Level badges: debug=gray, info=blue, warn=yellow, error=red
- Paginated (100 per page)

### Data Fetching

- Use SWR to fetch from `/api/logs` with filter params
- Date picker defaults to today
- Filters update the SWR key to re-fetch

---

## 5. File Structure

### New files

| File                                                        | Purpose                             |
| ----------------------------------------------------------- | ----------------------------------- |
| `src/main/lib/logger.ts`                                    | Core logger module (write, cleanup) |
| `src/main/lib/server/routes/logs.ts`                        | API routes for log querying         |
| `src/renderer/components/settings/settings-form/logger.tsx` | Logger settings page UI             |
| `src/renderer/services/logs.ts`                             | Frontend API service for logs       |

### Modified files

| File                                                 | Change                                 |
| ---------------------------------------------------- | -------------------------------------- |
| `src/main/lib/server/app.ts`                         | Register `/api/logs` route             |
| `src/renderer/components/settings/settings-menu.ts`  | Add Logger menu item                   |
| `src/renderer/components/settings/settings-form.tsx` | Add Logger form case                   |
| `src/main/index.ts`                                  | Initialize logger + cleanup on startup |
| `src/main/lib/db/migrate.ts`                         | Replace console._ with logger._        |
| `src/main/lib/server/routes/*.ts`                    | Replace console._ with logger._        |
| `src/main/lib/ai/**/*.ts`                            | Replace console._ with logger._        |
| `src/main/lib/db/queries.ts`                         | Replace console._ with logger._        |

---

## 6. Ordering

1. **Logger module** — core `logger.ts` with write/cleanup
2. **API routes** — log querying endpoints
3. **Settings UI** — Logger page with filters and table
4. **Console migration** — replace all `console.*` calls
