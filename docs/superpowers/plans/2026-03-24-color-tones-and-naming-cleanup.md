# Color Tones & Naming Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add color tone presets to Settings → General, rename "Setting" to "Settings" across the full stack, and standardize all database column names to camelCase.

**Architecture:** Three sequential migrations/changes: (1) rename snake_case DB columns to camelCase, (2) rename `setting` table/type/route/service to `settings`, (3) add color tone feature with 6 OKLCH presets. Each phase is independently committable.

**Tech Stack:** Drizzle ORM, PGlite, Hono, React 19, Jotai, SWR, Tailwind CSS v4, OKLCH colors, React Hook Form + Zod

**Spec:** `docs/superpowers/specs/2026-03-24-color-tones-and-naming-cleanup-design.md`

---

## Phase 1: Database Column Rename (snake_case → camelCase)

### Task 1: Create column rename migration

**Files:**

- Create: `resources/drizzle/0007_rename_columns_camelcase.sql`
- Modify: `resources/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `resources/drizzle/0007_rename_columns_camelcase.sql`:

```sql
-- Phase 1: Rename snake_case columns to camelCase across all tables

-- setting table
ALTER TABLE "setting" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "setting" RENAME COLUMN "updated_at" TO "updatedAt";

-- memory table
ALTER TABLE IF EXISTS "memory" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE IF EXISTS "memory" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE IF EXISTS "memory" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE IF EXISTS "memory" RENAME COLUMN "last_used_at" TO "lastUsedAt";
ALTER TABLE IF EXISTS "memory" RENAME COLUMN "is_active" TO "isActive";

-- session_summary table
ALTER TABLE IF EXISTS "session_summary" RENAME COLUMN "session_id" TO "sessionId";
ALTER TABLE IF EXISTS "session_summary" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE IF EXISTS "session_summary" RENAME COLUMN "updated_at" TO "updatedAt";

-- memory_usage_log table
ALTER TABLE IF EXISTS "memory_usage_log" RENAME COLUMN "memory_id" TO "memoryId";
ALTER TABLE IF EXISTS "memory_usage_log" RENAME COLUMN "session_id" TO "sessionId";
ALTER TABLE IF EXISTS "memory_usage_log" RENAME COLUMN "created_at" TO "createdAt";

-- lcm_summary table
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "chat_id" TO "chatId";
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "token_count" TO "tokenCount";
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "descendant_count" TO "descendantCount";
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "earliest_at" TO "earliestAt";
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "latest_at" TO "latestAt";
ALTER TABLE IF EXISTS "lcm_summary" RENAME COLUMN "created_at" TO "createdAt";

-- lcm_summary_messages table
ALTER TABLE IF EXISTS "lcm_summary_messages" RENAME COLUMN "summary_id" TO "summaryId";
ALTER TABLE IF EXISTS "lcm_summary_messages" RENAME COLUMN "message_id" TO "messageId";

-- lcm_summary_parents table
ALTER TABLE IF EXISTS "lcm_summary_parents" RENAME COLUMN "child_id" TO "childId";
ALTER TABLE IF EXISTS "lcm_summary_parents" RENAME COLUMN "parent_id" TO "parentId";

-- lcm_context_items table
ALTER TABLE IF EXISTS "lcm_context_items" RENAME COLUMN "chat_id" TO "chatId";
ALTER TABLE IF EXISTS "lcm_context_items" RENAME COLUMN "token_count" TO "tokenCount";
ALTER TABLE IF EXISTS "lcm_context_items" RENAME COLUMN "ref_id" TO "refId";
```

- [ ] **Step 2: Add journal entry**

Add to `resources/drizzle/meta/_journal.json` entries array:

```json
{
  "idx": 7,
  "version": "7",
  "when": 1742860800000,
  "tag": "0007_rename_columns_camelcase",
  "breakpoints": true
}
```

- [ ] **Step 3: Commit**

```bash
git add resources/drizzle/0007_rename_columns_camelcase.sql resources/drizzle/meta/_journal.json
git commit -m "migration: rename snake_case columns to camelCase"
```

### Task 2: Update schema.ts column definitions

**Files:**

- Modify: `src/main/lib/db/schema.ts:96-431`

Update all column definition strings from snake_case to camelCase. The TypeScript property names already use camelCase — only the string arguments change.

- [ ] **Step 1: Update `setting` table columns**

In `src/main/lib/db/schema.ts`, change lines 113-114:

```typescript
// Before:
createdAt: timestamp('created_at').defaultNow().notNull(),
updatedAt: timestamp('updated_at').defaultNow().notNull()

// After:
createdAt: timestamp('createdAt').defaultNow().notNull(),
updatedAt: timestamp('updatedAt').defaultNow().notNull()
```

- [ ] **Step 2: Update `memory` table columns**

In `src/main/lib/db/schema.ts`, change lines 339-348:

```typescript
// Before:
userId: uuid('user_id').notNull(),
createdAt: timestamp('created_at').defaultNow(),
updatedAt: timestamp('updated_at').defaultNow(),
lastUsedAt: timestamp('last_used_at'),
isActive: boolean('is_active').default(true)

// After:
userId: uuid('userId').notNull(),
createdAt: timestamp('createdAt').defaultNow(),
updatedAt: timestamp('updatedAt').defaultNow(),
lastUsedAt: timestamp('lastUsedAt'),
isActive: boolean('isActive').default(true)
```

- [ ] **Step 3: Update `session_summary` table columns**

```typescript
// Before:
sessionId: uuid('session_id').primaryKey(),
userId: uuid('user_id').notNull(),
updatedAt: timestamp('updated_at').defaultNow()

// After:
sessionId: uuid('sessionId').primaryKey(),
userId: uuid('userId').notNull(),
updatedAt: timestamp('updatedAt').defaultNow()
```

- [ ] **Step 4: Update `memory_usage_log` table columns**

```typescript
// Before:
memoryId: uuid('memory_id'),
sessionId: uuid('session_id'),
createdAt: timestamp('created_at').defaultNow()

// After:
memoryId: uuid('memoryId'),
sessionId: uuid('sessionId'),
createdAt: timestamp('createdAt').defaultNow()
```

- [ ] **Step 5: Update `lcm_summary` table columns**

```typescript
// Before:
chatId: uuid('chat_id').notNull().references(() => chat.id, { onDelete: 'cascade' }),
tokenCount: integer('token_count').notNull(),
descendantCount: integer('descendant_count').notNull().default(0),
earliestAt: timestamp('earliest_at').notNull(),
latestAt: timestamp('latest_at').notNull(),
createdAt: timestamp('created_at').notNull().defaultNow()

// After:
chatId: uuid('chatId').notNull().references(() => chat.id, { onDelete: 'cascade' }),
tokenCount: integer('tokenCount').notNull(),
descendantCount: integer('descendantCount').notNull().default(0),
earliestAt: timestamp('earliestAt').notNull(),
latestAt: timestamp('latestAt').notNull(),
createdAt: timestamp('createdAt').notNull().defaultNow()
```

- [ ] **Step 6: Update `lcm_summary_messages` table columns**

```typescript
// Before:
summaryId: text('summary_id').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' }),
messageId: uuid('message_id').notNull().references(() => message.id, { onDelete: 'cascade' })

// After:
summaryId: text('summaryId').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' }),
messageId: uuid('messageId').notNull().references(() => message.id, { onDelete: 'cascade' })
```

- [ ] **Step 7: Update `lcm_summary_parents` table columns**

```typescript
// Before:
childId: text('child_id').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' }),
parentId: text('parent_id').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' })

// After:
childId: text('childId').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' }),
parentId: text('parentId').notNull().references(() => lcmSummary.id, { onDelete: 'cascade' })
```

- [ ] **Step 8: Update `lcm_context_items` table columns**

```typescript
// Before:
chatId: uuid('chat_id').notNull().references(() => chat.id, { onDelete: 'cascade' }),
refId: text('ref_id').notNull(),
tokenCount: integer('token_count')

// After:
chatId: uuid('chatId').notNull().references(() => chat.id, { onDelete: 'cascade' }),
refId: text('refId').notNull(),
tokenCount: integer('tokenCount')
```

- [ ] **Step 9: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS (no type changes, only DB column name strings changed)

- [ ] **Step 10: Commit**

```bash
git add src/main/lib/db/schema.ts
git commit -m "refactor: update schema column definitions to camelCase"
```

---

## Phase 2: Setting → Settings Rename

### Task 3: Create table rename migration

**Files:**

- Create: `resources/drizzle/0008_rename_setting_to_settings.sql`
- Modify: `resources/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `resources/drizzle/0008_rename_setting_to_settings.sql`:

```sql
ALTER TABLE "setting" RENAME TO "settings";
```

- [ ] **Step 2: Add journal entry**

Add to `resources/drizzle/meta/_journal.json` entries array:

```json
{
  "idx": 8,
  "version": "7",
  "when": 1742860800001,
  "tag": "0008_rename_setting_to_settings",
  "breakpoints": true
}
```

- [ ] **Step 3: Commit**

```bash
git add resources/drizzle/0008_rename_setting_to_settings.sql resources/drizzle/meta/_journal.json
git commit -m "migration: rename setting table to settings"
```

### Task 4: Rename shared schema file and types

**Files:**

- Rename: `src/shared/schemas/setting-schema.ts` → `src/shared/schemas/settings-schema.ts`
- Modify: `src/shared/schemas/settings-schema.ts` (type renames)

- [ ] **Step 1: Rename the file**

```bash
git mv src/shared/schemas/setting-schema.ts src/shared/schemas/settings-schema.ts
```

- [ ] **Step 2: Rename types inside the file**

In `src/shared/schemas/settings-schema.ts`, rename:

- `SettingSchema` → `SettingsSchema` (line 129)
- `Setting` → `Settings` (line 148): `export type Settings = z.infer<typeof SettingsSchema>`
- `SettingInput` → `SettingsInput` (line 150): `export type SettingsInput = z.input<typeof SettingsSchema>`
- `UseFormReturnType` stays the same (generic utility type, no "Setting" in name)
- Update the `UseFormReturnType` definition to use `SettingsInput`: `export type UseFormReturnType = UseFormReturn<SettingsInput>`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename SettingSchema/Setting to SettingsSchema/Settings"
```

### Task 5: Rename database schema and queries

**Files:**

- Modify: `src/main/lib/db/schema.ts:96-117`
- Modify: `src/main/lib/db/queries.ts:185-198`

- [ ] **Step 1: Update schema.ts**

In `src/main/lib/db/schema.ts`:

```typescript
// Before (line 96):
export const setting = pgTable('setting', {
// After:
export const settings = pgTable('settings', {

// Before (line 117):
export type Setting = InferSelectModel<typeof setting>
// After:
export type Settings = InferSelectModel<typeof settings>
```

- [ ] **Step 2: Update queries.ts**

In `src/main/lib/db/queries.ts`:

```typescript
// Before (line 185-189):
export async function getSetting() {
  await db.insert(setting).values({ id: 'global' }).onConflictDoNothing()
  const [data] = await db.select().from(setting)
  return data!
}

// After:
export async function getSettings() {
  await db.insert(settings).values({ id: 'global' }).onConflictDoNothing()
  const [data] = await db.select().from(settings)
  return data!
}

// Before (line 191-198):
export async function updateSetting(payload: Setting) {
  const { createdAt, updatedAt, ...rest } = payload
  return await db
    .update(setting)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(setting.id, payload.id))
}

// After:
export async function updateSettings(payload: Settings) {
  const { createdAt, updatedAt, ...rest } = payload
  return await db
    .update(settings)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(settings.id, payload.id))
}
```

Also update the imports at the top of queries.ts: `setting` → `settings`, `Setting` → `Settings`.

- [ ] **Step 3: Commit**

```bash
git add src/main/lib/db/schema.ts src/main/lib/db/queries.ts
git commit -m "refactor: rename setting to settings in schema and queries"
```

### Task 6: Rename server-side files and routes

**Files:**

- Modify: `src/shared/types/server.ts`
- Rename: `src/main/lib/server/schemas/setting.ts` → `src/main/lib/server/schemas/settings.ts`
- Rename: `src/main/lib/server/routes/setting.ts` → `src/main/lib/server/routes/settings.ts`
- Modify: `src/main/lib/server/routes/settings.ts` (update internals)
- Modify: `src/main/lib/server/app.ts`

- [ ] **Step 1: Update server types**

In `src/shared/types/server.ts`:

```typescript
// Before:
import { Setting } from '../../main/lib/db/schema'
export interface Variables {
  setting: Setting
}

// After:
import { Settings } from '../../main/lib/db/schema'
export interface Variables {
  settings: Settings
}
```

- [ ] **Step 2: Rename and update server schema file**

```bash
git mv src/main/lib/server/schemas/setting.ts src/main/lib/server/schemas/settings.ts
```

In `src/main/lib/server/schemas/settings.ts`:

```typescript
import { Settings } from '@shared/schemas/settings-schema'
import z from 'zod'

export const updateSettingsSchema = z.custom<Settings>()
```

- [ ] **Step 3: Rename and update route file**

```bash
git mv src/main/lib/server/routes/setting.ts src/main/lib/server/routes/settings.ts
```

In `src/main/lib/server/routes/settings.ts`:

```typescript
import { Variables } from '@shared/types/server'
import { Hono } from 'hono'

import { updateSettings } from '../../db/queries'
import { Settings as DBSettings } from '../../db/schema'
import { updateSettingsSchema } from '../schemas/settings'
import {
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const settingsRouter = new Hono<{ Variables: Variables }>()

settingsRouter.get('/', async (c) => {
  const settings = c.get('settings')
  return successResponse(c, settings)
})

settingsRouter.post('/', async (c) => {
  const payload = validateSchema(
    updateSettingsSchema,
    await c.req.json(),
    'settings',
    'Invalid settings configuration'
  )

  const updatedSettings = await handleDatabaseOperation(
    () => updateSettings(payload as unknown as DBSettings),
    'Failed to update settings'
  )

  return successResponse(c, updatedSettings)
})

export default settingsRouter
```

- [ ] **Step 4: Update app.ts**

In `src/main/lib/server/app.ts`:

```typescript
// Line 9: import { getSetting } → import { getSettings }
import { getSettings } from '../db/queries'
// Line 20: import settingsRouter from './routes/setting'
import settingsRouter from './routes/settings'

// Line 39: const setting = await getSetting()
const settings = await getSettings()

// Line 40: c.set('setting', setting)
c.set('settings', settings)

// Line 53: app.route('/api/setting', settingsRouter)
app.route('/api/settings', settingsRouter)
```

- [ ] **Step 5: Update all backend routes that read `c.get('setting')`**

Grep for `c.get('setting')` across all route files and update to `c.get('settings')`:

- `src/main/lib/server/routes/audio.ts`
- `src/main/lib/server/routes/chat.ts`
- `src/main/lib/server/routes/deep-research.ts`
- `src/main/lib/server/routes/s3-uploader.ts`

Also update any `Setting` type imports from schema to `Settings`.

- [ ] **Step 6: Update ALL remaining backend files that reference Setting type or getSetting**

Run a comprehensive grep to find every remaining reference:

```bash
grep -rn "Setting\|getSetting\|updateSetting\|setting-schema\|c\.get('setting')" src/main/ src/shared/ --include="*.ts" --include="*.tsx"
```

Known files that need updating (beyond those already handled above):

- `src/main/index.ts` — imports `getSetting`, rename to `getSettings`
- `src/main/lib/ai/utils/web-search-util.ts` — imports from `setting-schema`
- `src/main/lib/ai/utils/tool-binding-util.ts` — imports `Setting` type
- `src/main/lib/ai/utils/model-util.ts` — imports `Setting` type
- `src/main/lib/server/utils/validation.ts` — uses `Setting` as parameter type
- `src/main/lib/ai/agent-x/auto-fill.ts`
- `src/main/lib/ai/agent-x/auto-router.ts`
- `src/main/lib/ai/agent-x/smart-dispatch.ts`
- `src/main/lib/ai/agent-x/execution-engine.ts`

Update all imports from `Setting` to `Settings`, `getSetting` to `getSettings`, `setting-schema` to `settings-schema`, and `setting` variable names to `settings`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename setting to settings in server routes and types"
```

### Task 7: Rename frontend service and hook files

**Files:**

- Rename: `src/renderer/services/setting.ts` → `src/renderer/services/settings.ts`
- Rename: `src/renderer/hooks/use-setting.ts` → `src/renderer/hooks/use-settings.ts`

Note: The store file (`stores/setting.ts`) is deferred to Task 8 because it imports from the components directory which is also renamed in Task 8.

- [ ] **Step 1: Rename and update service file**

```bash
git mv src/renderer/services/setting.ts src/renderer/services/settings.ts
```

In `src/renderer/services/settings.ts`:

```typescript
import { fetcher } from '@shared/utils/http'
import type { Settings } from 'src/shared/schemas/settings-schema'

export const updateSettings = async (payload: Settings) =>
  fetcher<void>('/api/settings', { method: 'POST', body: payload })
```

- [ ] **Step 2: Rename and update hook file**

```bash
git mv src/renderer/hooks/use-setting.ts src/renderer/hooks/use-settings.ts
```

In `src/renderer/hooks/use-settings.ts`:

```typescript
import { sileo } from 'sileo'
import type { Settings } from 'src/shared/schemas/settings-schema'
import useSWR from 'swr'

import { updateSettings as updateSettingsService } from '@/services/settings'

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<Settings>('/api/settings')

  const updateSettings = async (payload: Settings) => {
    await updateSettingsService(payload)
    mutate()
    sileo.success({ title: 'Auto saved' })
  }

  return {
    data,
    isLoading,
    error,
    updateSettings
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename setting to settings in frontend service and hook"
```

### Task 8: Rename components directory, store, and all internal references

**Files:**

- Rename: `src/renderer/components/setting/` → `src/renderer/components/settings/`
- Rename: `src/renderer/stores/setting.ts` → `src/renderer/stores/settings.ts`
- Modify: All files within the directory (rename exports)
- Modify: All files that import from `setting/` directory

This is a large batch rename. The key renames inside the directory:

- [ ] **Step 1: Rename the directory**

```bash
git mv src/renderer/components/setting src/renderer/components/settings
```

- [ ] **Step 2: Rename files inside the directory**

```bash
git mv src/renderer/components/settings/setting-menu.ts src/renderer/components/settings/settings-menu.ts
git mv src/renderer/components/settings/setting-form.tsx src/renderer/components/settings/settings-form.tsx
git mv src/renderer/components/settings/setting-row.tsx src/renderer/components/settings/settings-row.tsx
git mv src/renderer/components/settings/setting-select.tsx src/renderer/components/settings/settings-select.tsx
git mv src/renderer/components/settings/setting-sidebar.tsx src/renderer/components/settings/settings-sidebar.tsx
git mv src/renderer/components/settings/setting-dialog.tsx src/renderer/components/settings/settings-dialog.tsx
git mv src/renderer/components/settings/setting-form src/renderer/components/settings/settings-form
```

- [ ] **Step 3: Rename and update store file**

```bash
git mv src/renderer/stores/setting.ts src/renderer/stores/settings.ts
```

In `src/renderer/stores/settings.ts`:

```typescript
import { atom } from 'jotai'

import {
  SettingsLabel,
  SettingsPage
} from '@/components/settings/settings-menu'

export const settingsLabelAtom = atom<SettingsPage>(SettingsLabel.General)
```

- [ ] **Step 4: Update exports inside renamed files**

In `settings-menu.ts`:

- `SettingLabel` → `SettingsLabel`
- `SettingPage` → `SettingsPage`

In `settings-row.tsx`:

- `SettingRow` → `SettingsRow`
- `SettingSection` → `SettingsSection`

In `settings-select.tsx`:

- `SettingSelect` → `SettingsSelect`

In `settings-form.tsx`:

- `SettingsForm` (already plural) — update internal imports
- Update `useSetting` → `useSettings` import
- Update `Setting` → `Settings` type references
- Update `UseFormReturnType` import path to `settings-schema`

In `settings-sidebar.tsx`:

- Update `SettingLabel` → `SettingsLabel` references
- Update `settingLabelAtom` → `settingsLabelAtom`

In `settings-dialog.tsx`:

- Update internal imports

- [ ] **Step 5: Update all sub-form files**

All files in `src/renderer/components/settings/settings-form/` that import `UseFormReturnType`:

- Update import path from `setting-schema` to `settings-schema`
- Update `SettingRow` → `SettingsRow`, `SettingSection` → `SettingsSection` imports
- Update `SettingSelect` → `SettingsSelect` imports

Files: `generals.tsx`, `audio-speech.tsx`, `avatar-uploader.tsx`, `data-controls.tsx`, `deep-research.tsx`, `google-maps.tsx`, `graph-rag.tsx`, `image-generation.tsx`, `memory-layer.tsx`, `mcp-servers.tsx`, `provider-config.tsx`, `s3.tsx`, `skills-market.tsx`, `system-info.tsx`, `tools.tsx`, `update-panel.tsx`, `web-search.tsx`, and all files in `providers/`.

- [ ] **Step 6: Update external imports**

Files outside the settings directory that reference it:

`src/renderer/layouts/settings-layout/index.tsx`:

- Update imports from `@/components/setting/` → `@/components/settings/`
- `SettingsForm` import path
- `SettingsSidebar` import path
- `settingLabelAtom` → `settingsLabelAtom`

`src/renderer/components/messages.tsx`:

- Update `useSetting` → `useSettings` import

`src/renderer/components/calling-tools/google-maps-routing/routing-card.tsx`:

- Update `useSetting` → `useSettings` import

`src/renderer/components/calling-tools/google-maps-places/places-accordion.tsx`:

- Update `useSetting` → `useSettings` import

`src/renderer/hooks/use-audio.ts`:

- Update `useSetting` → `useSettings` import

- [ ] **Step 7: Comprehensive grep audit**

Run a final grep to catch any remaining singular "setting" references in the renderer:

```bash
grep -rn "useSetting\b\|settingLabelAtom\|SettingLabel\|SettingPage\|SettingRow\|SettingSection\|SettingSelect\|/setting\b\|setting-schema\|'setting'" src/renderer/ --include="*.ts" --include="*.tsx"
```

Fix any remaining references.

- [ ] **Step 8: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS — all renames consistent.

- [ ] **Step 9: Run lint**

```bash
pnpm lint
```

Fix any issues.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename setting to settings across all components and imports"
```

---

## Phase 3: Color Tone Feature

### Task 9: Add colorTone to schema and Zod validation

**Files:**

- Modify: `src/shared/schemas/settings-schema.ts`
- Modify: `src/main/lib/db/schema.ts`

- [ ] **Step 1: Add ColorTone enum and schema field**

In `src/shared/schemas/settings-schema.ts`, add before `SettingsSchema`:

```typescript
export const ColorTone = z.enum([
  'neutral',
  'emerald',
  'blue',
  'violet',
  'rose',
  'orange'
])
export type ColorTone = z.infer<typeof ColorTone>
```

Add `colorTone` field to `SettingsSchema`:

```typescript
export const SettingsSchema = z.object({
  id: z.string(),
  // ... existing fields ...
  colorTone: ColorTone.default('neutral').nullish(),
  createdAt: z.any(),
  updatedAt: z.any()
})
```

- [ ] **Step 2: Add column to DB schema**

In `src/main/lib/db/schema.ts`, add to the `settings` table definition:

```typescript
colorTone: text('colorTone').default('neutral'),
```

- [ ] **Step 3: Create migration**

Create `resources/drizzle/0009_add_color_tone.sql`:

```sql
ALTER TABLE "settings" ADD COLUMN "colorTone" text DEFAULT 'neutral';
```

Add journal entry (idx 9).

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add colorTone field to settings schema and database"
```

### Task 10: Write CSS tone rulesets

**Files:**

- Modify: `src/renderer/assets/stylesheets/globals.css`

- [ ] **Step 1: Replace `:root` with neutral defaults and add tone rulesets**

Replace the current `:root` block (which uses emerald hue ~160) with neutral values (chroma → 0). Then add rulesets for each tone. The `:root` selector serves as the fallback for when no `data-tone` is set.

```css
:root,
[data-tone='neutral'] {
  --radius: 0.625rem;
  /* Pure neutral — no color tint */
  --background: oklch(0.985 0 0);
  --foreground: oklch(0.16 0 0);
  --card: oklch(0.995 0 0);
  --card-foreground: oklch(0.16 0 0);
  --popover: oklch(0.995 0 0);
  --popover-foreground: oklch(0.16 0 0);
  --primary: oklch(0.52 0 0);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0 0);
  --secondary-foreground: oklch(0.2 0 0);
  --muted: oklch(0.955 0 0);
  --muted-foreground: oklch(0.5 0 0);
  --accent: oklch(0.94 0 0);
  --accent-foreground: oklch(0.2 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.905 0 0);
  --input: oklch(0.905 0 0);
  --ring: oklch(0.55 0 0);
  --chart-1: oklch(0.55 0 0);
  --chart-2: oklch(0.58 0.22 265);
  --chart-3: oklch(0.65 0.24 25);
  --chart-4: oklch(0.7 0.18 80);
  --chart-5: oklch(0.6 0.2 330);
  /* Sidebar */
  --sidebar: oklch(0.975 0 0);
  --sidebar-foreground: oklch(0.16 0 0);
  --sidebar-primary: oklch(0.52 0 0);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0 0);
  --sidebar-accent-foreground: oklch(0.2 0 0);
  --sidebar-border: oklch(0.905 0 0);
  --sidebar-ring: oklch(0.45 0 0);
}

[data-tone='emerald'] {
  --background: oklch(0.985 0.004 160);
  --foreground: oklch(0.16 0.02 160);
  --card: oklch(0.995 0.003 155);
  --card-foreground: oklch(0.16 0.02 160);
  --popover: oklch(0.995 0.003 155);
  --popover-foreground: oklch(0.16 0.02 160);
  --primary: oklch(0.52 0.17 160);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0.01 155);
  --secondary-foreground: oklch(0.2 0.02 160);
  --muted: oklch(0.955 0.01 155);
  --muted-foreground: oklch(0.5 0.015 160);
  --accent: oklch(0.94 0.02 155);
  --accent-foreground: oklch(0.2 0.02 160);
  --border: oklch(0.905 0.012 155);
  --input: oklch(0.905 0.012 155);
  --ring: oklch(0.55 0.16 160);
  --chart-1: oklch(0.55 0.17 160);
  --sidebar: oklch(0.975 0.006 155);
  --sidebar-foreground: oklch(0.16 0.02 160);
  --sidebar-primary: oklch(0.52 0.17 160);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0.02 155);
  --sidebar-accent-foreground: oklch(0.2 0.02 160);
  --sidebar-border: oklch(0.905 0.012 155);
  --sidebar-ring: oklch(0.55 0.16 160);
}

[data-tone='blue'] {
  --background: oklch(0.985 0.004 230);
  --foreground: oklch(0.16 0.02 230);
  --card: oklch(0.995 0.003 225);
  --card-foreground: oklch(0.16 0.02 230);
  --popover: oklch(0.995 0.003 225);
  --popover-foreground: oklch(0.16 0.02 230);
  --primary: oklch(0.52 0.17 230);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0.01 225);
  --secondary-foreground: oklch(0.2 0.02 230);
  --muted: oklch(0.955 0.01 225);
  --muted-foreground: oklch(0.5 0.015 230);
  --accent: oklch(0.94 0.02 225);
  --accent-foreground: oklch(0.2 0.02 230);
  --border: oklch(0.905 0.012 225);
  --input: oklch(0.905 0.012 225);
  --ring: oklch(0.55 0.16 230);
  --chart-1: oklch(0.55 0.17 230);
  --sidebar: oklch(0.975 0.006 225);
  --sidebar-foreground: oklch(0.16 0.02 230);
  --sidebar-primary: oklch(0.52 0.17 230);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0.02 225);
  --sidebar-accent-foreground: oklch(0.2 0.02 230);
  --sidebar-border: oklch(0.905 0.012 225);
  --sidebar-ring: oklch(0.55 0.16 230);
}

[data-tone='violet'] {
  --background: oklch(0.985 0.004 285);
  --foreground: oklch(0.16 0.02 285);
  --card: oklch(0.995 0.003 280);
  --card-foreground: oklch(0.16 0.02 285);
  --popover: oklch(0.995 0.003 280);
  --popover-foreground: oklch(0.16 0.02 285);
  --primary: oklch(0.52 0.17 285);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0.01 280);
  --secondary-foreground: oklch(0.2 0.02 285);
  --muted: oklch(0.955 0.01 280);
  --muted-foreground: oklch(0.5 0.015 285);
  --accent: oklch(0.94 0.02 280);
  --accent-foreground: oklch(0.2 0.02 285);
  --border: oklch(0.905 0.012 280);
  --input: oklch(0.905 0.012 280);
  --ring: oklch(0.55 0.16 285);
  --chart-1: oklch(0.55 0.17 285);
  --sidebar: oklch(0.975 0.006 280);
  --sidebar-foreground: oklch(0.16 0.02 285);
  --sidebar-primary: oklch(0.52 0.17 285);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0.02 280);
  --sidebar-accent-foreground: oklch(0.2 0.02 285);
  --sidebar-border: oklch(0.905 0.012 280);
  --sidebar-ring: oklch(0.55 0.16 285);
}

[data-tone='rose'] {
  --background: oklch(0.985 0.004 350);
  --foreground: oklch(0.16 0.02 350);
  --card: oklch(0.995 0.003 345);
  --card-foreground: oklch(0.16 0.02 350);
  --popover: oklch(0.995 0.003 345);
  --popover-foreground: oklch(0.16 0.02 350);
  --primary: oklch(0.52 0.17 350);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0.01 345);
  --secondary-foreground: oklch(0.2 0.02 350);
  --muted: oklch(0.955 0.01 345);
  --muted-foreground: oklch(0.5 0.015 350);
  --accent: oklch(0.94 0.02 345);
  --accent-foreground: oklch(0.2 0.02 350);
  --border: oklch(0.905 0.012 345);
  --input: oklch(0.905 0.012 345);
  --ring: oklch(0.55 0.16 350);
  --chart-1: oklch(0.55 0.17 350);
  --sidebar: oklch(0.975 0.006 345);
  --sidebar-foreground: oklch(0.16 0.02 350);
  --sidebar-primary: oklch(0.52 0.17 350);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0.02 345);
  --sidebar-accent-foreground: oklch(0.2 0.02 350);
  --sidebar-border: oklch(0.905 0.012 345);
  --sidebar-ring: oklch(0.55 0.16 350);
}

[data-tone='orange'] {
  --background: oklch(0.985 0.004 55);
  --foreground: oklch(0.16 0.02 55);
  --card: oklch(0.995 0.003 50);
  --card-foreground: oklch(0.16 0.02 55);
  --popover: oklch(0.995 0.003 50);
  --popover-foreground: oklch(0.16 0.02 55);
  --primary: oklch(0.52 0.17 55);
  --primary-foreground: oklch(0.98 0 0);
  --secondary: oklch(0.955 0.01 50);
  --secondary-foreground: oklch(0.2 0.02 55);
  --muted: oklch(0.955 0.01 50);
  --muted-foreground: oklch(0.5 0.015 55);
  --accent: oklch(0.94 0.02 50);
  --accent-foreground: oklch(0.2 0.02 55);
  --border: oklch(0.905 0.012 50);
  --input: oklch(0.905 0.012 50);
  --ring: oklch(0.55 0.16 55);
  --chart-1: oklch(0.55 0.17 55);
  --sidebar: oklch(0.975 0.006 50);
  --sidebar-foreground: oklch(0.16 0.02 55);
  --sidebar-primary: oklch(0.52 0.17 55);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.94 0.02 50);
  --sidebar-accent-foreground: oklch(0.2 0.02 55);
  --sidebar-border: oklch(0.905 0.012 50);
  --sidebar-ring: oklch(0.55 0.16 55);
}
```

- [ ] **Step 2: Add dark mode tone rulesets**

Replace the existing `.dark` block with neutral defaults and add dark tone rulesets:

```css
.dark,
.dark[data-tone='neutral'] {
  --background: oklch(0.13 0 0);
  --foreground: oklch(0.93 0 0);
  --card: oklch(0.17 0 0);
  --card-foreground: oklch(0.93 0 0);
  --popover: oklch(0.17 0 0);
  --popover-foreground: oklch(0.93 0 0);
  --primary: oklch(0.72 0 0);
  --primary-foreground: oklch(0.13 0 0);
  --secondary: oklch(0.22 0 0);
  --secondary-foreground: oklch(0.93 0 0);
  --muted: oklch(0.22 0 0);
  --muted-foreground: oklch(0.62 0 0);
  --accent: oklch(0.22 0 0);
  --accent-foreground: oklch(0.93 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 16%);
  --ring: oklch(0.65 0 0);
  --chart-1: oklch(0.68 0 0);
  --chart-2: oklch(0.65 0.2 265);
  --chart-3: oklch(0.72 0.22 40);
  --chart-4: oklch(0.7 0.18 80);
  --chart-5: oklch(0.68 0.22 330);
  --sidebar: oklch(0.15 0 0);
  --sidebar-foreground: oklch(0.93 0 0);
  --sidebar-primary: oklch(0.72 0 0);
  --sidebar-primary-foreground: oklch(0.93 0 0);
  --sidebar-accent: oklch(0.22 0 0);
  --sidebar-accent-foreground: oklch(0.93 0 0);
  --sidebar-border: oklch(1 0 0 / 12%);
  --sidebar-ring: oklch(0.65 0 0);
}

.dark[data-tone='emerald'] {
  --background: oklch(0.13 0.02 165);
  --foreground: oklch(0.93 0.006 155);
  --card: oklch(0.17 0.025 165);
  --card-foreground: oklch(0.93 0.006 155);
  --popover: oklch(0.17 0.025 165);
  --popover-foreground: oklch(0.93 0.006 155);
  --primary: oklch(0.72 0.19 160);
  --primary-foreground: oklch(0.13 0.02 165);
  --secondary: oklch(0.22 0.025 165);
  --secondary-foreground: oklch(0.93 0.006 155);
  --muted: oklch(0.22 0.025 165);
  --muted-foreground: oklch(0.62 0.015 165);
  --accent: oklch(0.22 0.035 165);
  --accent-foreground: oklch(0.93 0.006 155);
  --border: oklch(1 0.02 165 / 12%);
  --input: oklch(1 0.02 165 / 16%);
  --ring: oklch(0.65 0.18 160);
  --chart-1: oklch(0.68 0.19 160);
  --sidebar: oklch(0.15 0.025 165);
  --sidebar-foreground: oklch(0.93 0.006 155);
  --sidebar-primary: oklch(0.72 0.19 160);
  --sidebar-primary-foreground: oklch(0.93 0.006 155);
  --sidebar-accent: oklch(0.22 0.035 165);
  --sidebar-accent-foreground: oklch(0.93 0.006 155);
  --sidebar-border: oklch(1 0.02 165 / 12%);
  --sidebar-ring: oklch(0.65 0.18 160);
}

.dark[data-tone='blue'] {
  --background: oklch(0.13 0.02 235);
  --foreground: oklch(0.93 0.006 225);
  --card: oklch(0.17 0.025 235);
  --card-foreground: oklch(0.93 0.006 225);
  --popover: oklch(0.17 0.025 235);
  --popover-foreground: oklch(0.93 0.006 225);
  --primary: oklch(0.72 0.19 230);
  --primary-foreground: oklch(0.13 0.02 235);
  --secondary: oklch(0.22 0.025 235);
  --secondary-foreground: oklch(0.93 0.006 225);
  --muted: oklch(0.22 0.025 235);
  --muted-foreground: oklch(0.62 0.015 235);
  --accent: oklch(0.22 0.035 235);
  --accent-foreground: oklch(0.93 0.006 225);
  --border: oklch(1 0.02 235 / 12%);
  --input: oklch(1 0.02 235 / 16%);
  --ring: oklch(0.65 0.18 230);
  --chart-1: oklch(0.68 0.19 230);
  --sidebar: oklch(0.15 0.025 235);
  --sidebar-foreground: oklch(0.93 0.006 225);
  --sidebar-primary: oklch(0.72 0.19 230);
  --sidebar-primary-foreground: oklch(0.93 0.006 225);
  --sidebar-accent: oklch(0.22 0.035 235);
  --sidebar-accent-foreground: oklch(0.93 0.006 225);
  --sidebar-border: oklch(1 0.02 235 / 12%);
  --sidebar-ring: oklch(0.65 0.18 230);
}

.dark[data-tone='violet'] {
  --background: oklch(0.13 0.02 290);
  --foreground: oklch(0.93 0.006 280);
  --card: oklch(0.17 0.025 290);
  --card-foreground: oklch(0.93 0.006 280);
  --popover: oklch(0.17 0.025 290);
  --popover-foreground: oklch(0.93 0.006 280);
  --primary: oklch(0.72 0.19 285);
  --primary-foreground: oklch(0.13 0.02 290);
  --secondary: oklch(0.22 0.025 290);
  --secondary-foreground: oklch(0.93 0.006 280);
  --muted: oklch(0.22 0.025 290);
  --muted-foreground: oklch(0.62 0.015 290);
  --accent: oklch(0.22 0.035 290);
  --accent-foreground: oklch(0.93 0.006 280);
  --border: oklch(1 0.02 290 / 12%);
  --input: oklch(1 0.02 290 / 16%);
  --ring: oklch(0.65 0.18 285);
  --chart-1: oklch(0.68 0.19 285);
  --sidebar: oklch(0.15 0.025 290);
  --sidebar-foreground: oklch(0.93 0.006 280);
  --sidebar-primary: oklch(0.72 0.19 285);
  --sidebar-primary-foreground: oklch(0.93 0.006 280);
  --sidebar-accent: oklch(0.22 0.035 290);
  --sidebar-accent-foreground: oklch(0.93 0.006 280);
  --sidebar-border: oklch(1 0.02 290 / 12%);
  --sidebar-ring: oklch(0.65 0.18 285);
}

.dark[data-tone='rose'] {
  --background: oklch(0.13 0.02 355);
  --foreground: oklch(0.93 0.006 345);
  --card: oklch(0.17 0.025 355);
  --card-foreground: oklch(0.93 0.006 345);
  --popover: oklch(0.17 0.025 355);
  --popover-foreground: oklch(0.93 0.006 345);
  --primary: oklch(0.72 0.19 350);
  --primary-foreground: oklch(0.13 0.02 355);
  --secondary: oklch(0.22 0.025 355);
  --secondary-foreground: oklch(0.93 0.006 345);
  --muted: oklch(0.22 0.025 355);
  --muted-foreground: oklch(0.62 0.015 355);
  --accent: oklch(0.22 0.035 355);
  --accent-foreground: oklch(0.93 0.006 345);
  --border: oklch(1 0.02 355 / 12%);
  --input: oklch(1 0.02 355 / 16%);
  --ring: oklch(0.65 0.18 350);
  --chart-1: oklch(0.68 0.19 350);
  --sidebar: oklch(0.15 0.025 355);
  --sidebar-foreground: oklch(0.93 0.006 345);
  --sidebar-primary: oklch(0.72 0.19 350);
  --sidebar-primary-foreground: oklch(0.93 0.006 345);
  --sidebar-accent: oklch(0.22 0.035 355);
  --sidebar-accent-foreground: oklch(0.93 0.006 345);
  --sidebar-border: oklch(1 0.02 355 / 12%);
  --sidebar-ring: oklch(0.65 0.18 350);
}

.dark[data-tone='orange'] {
  --background: oklch(0.13 0.02 60);
  --foreground: oklch(0.93 0.006 50);
  --card: oklch(0.17 0.025 60);
  --card-foreground: oklch(0.93 0.006 50);
  --popover: oklch(0.17 0.025 60);
  --popover-foreground: oklch(0.93 0.006 50);
  --primary: oklch(0.72 0.19 55);
  --primary-foreground: oklch(0.13 0.02 60);
  --secondary: oklch(0.22 0.025 60);
  --secondary-foreground: oklch(0.93 0.006 50);
  --muted: oklch(0.22 0.025 60);
  --muted-foreground: oklch(0.62 0.015 60);
  --accent: oklch(0.22 0.035 60);
  --accent-foreground: oklch(0.93 0.006 50);
  --border: oklch(1 0.02 60 / 12%);
  --input: oklch(1 0.02 60 / 16%);
  --ring: oklch(0.65 0.18 55);
  --chart-1: oklch(0.68 0.19 55);
  --sidebar: oklch(0.15 0.025 60);
  --sidebar-foreground: oklch(0.93 0.006 50);
  --sidebar-primary: oklch(0.72 0.19 55);
  --sidebar-primary-foreground: oklch(0.93 0.006 50);
  --sidebar-accent: oklch(0.22 0.035 60);
  --sidebar-accent-foreground: oklch(0.93 0.006 50);
  --sidebar-border: oklch(1 0.02 60 / 12%);
  --sidebar-ring: oklch(0.65 0.18 55);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/assets/stylesheets/globals.css
git commit -m "feat: add CSS tone rulesets for 6 color presets (light + dark)"
```

### Task 11: Add tone initialization script to HTML entry points

**Files:**

- Create: `src/renderer/tone-init.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/sub-apps/searchbar/index.html`
- Modify: `src/renderer/sub-apps/quick-chat/index.html`

Note: Inline scripts are blocked by CSP (`script-src 'self'`), so we use an external file.

- [ ] **Step 1: Create tone-init.js**

Create `src/renderer/tone-init.js`:

```javascript
;(function () {
  var t = localStorage.getItem('actovia-color-tone')
  if (t) document.documentElement.setAttribute('data-tone', t)
})()
```

- [ ] **Step 2: Add script tag to all 3 HTML entry points**

Add before `</head>` in each file:

`src/renderer/index.html`:

```html
<script src="/tone-init.js"></script>
```

`src/renderer/sub-apps/searchbar/index.html`:

```html
<script src="../../tone-init.js"></script>
```

`src/renderer/sub-apps/quick-chat/index.html`:

```html
<script src="../../tone-init.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/tone-init.js src/renderer/index.html src/renderer/sub-apps/searchbar/index.html src/renderer/sub-apps/quick-chat/index.html
git commit -m "feat: add tone initialization script to all HTML entry points for FOUC prevention"
```

### Task 12: Create useTone hook

**Files:**

- Create: `src/renderer/hooks/use-tone.ts`

- [ ] **Step 1: Write the hook**

Create `src/renderer/hooks/use-tone.ts`:

```typescript
import type { ColorTone } from '@shared/schemas/settings-schema'
import { useCallback, useEffect } from 'react'

import { useSettings } from '@/hooks/use-settings'

const STORAGE_KEY = 'actovia-color-tone'

function applyTone(tone: string) {
  document.documentElement.setAttribute('data-tone', tone)
  localStorage.setItem(STORAGE_KEY, tone)
}

export function useTone() {
  const { data, updateSettings } = useSettings()
  const tone: ColorTone = data?.colorTone ?? 'neutral'

  // Sync data-tone attribute whenever settings change
  useEffect(() => {
    applyTone(tone)
  }, [tone])

  const setTone = useCallback(
    async (newTone: ColorTone) => {
      applyTone(newTone)
      if (data) {
        await updateSettings({ ...data, colorTone: newTone })
      }
    },
    [data, updateSettings]
  )

  return { tone, setTone }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/use-tone.ts
git commit -m "feat: add useTone hook for color tone management"
```

### Task 13: Add Color Tone picker to General settings

**Files:**

- Modify: `src/renderer/components/settings/settings-form/generals.tsx`

- [ ] **Step 1: Add the tone picker UI**

In `generals.tsx`, add imports:

```typescript
import type { ColorTone } from '@shared/schemas/settings-schema'

import { useTone } from '@/hooks/use-tone'
```

Add the tone picker after the Theme `SettingsRow`. Use colored circle buttons:

```tsx
const TONE_PRESETS: { value: ColorTone; label: string; color: string }[] = [
  { value: 'neutral', label: 'Neutral', color: 'oklch(0.52 0 0)' },
  { value: 'emerald', label: 'Emerald', color: 'oklch(0.52 0.17 160)' },
  { value: 'blue', label: 'Blue', color: 'oklch(0.52 0.17 230)' },
  { value: 'violet', label: 'Violet', color: 'oklch(0.52 0.17 285)' },
  { value: 'rose', label: 'Rose', color: 'oklch(0.52 0.17 350)' },
  { value: 'orange', label: 'Orange', color: 'oklch(0.52 0.17 55)' }
]
```

Inside the component, add after `useTheme()`:

```tsx
const { tone, setTone } = useTone()
```

Add this JSX after the Theme `SettingsRow`:

```tsx
<SettingsRow
  label="Color Tone"
  description="Choose a color accent for the interface"
>
  <div className="flex items-center gap-2">
    {TONE_PRESETS.map((preset) => (
      <button
        key={preset.value}
        type="button"
        title={preset.label}
        className={`h-6 w-6 rounded-full transition-all ${
          tone === preset.value
            ? 'ring-ring ring-offset-background ring-2 ring-offset-2'
            : 'hover:scale-110'
        }`}
        style={{ backgroundColor: preset.color }}
        onClick={() => setTone(preset.value)}
      />
    ))}
  </div>
</SettingsRow>
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Run dev and visually verify**

```bash
pnpm dev
```

Navigate to Settings → General. Verify:

- 6 color circles appear below Theme
- Clicking a circle changes the app's color tone immediately
- Refreshing preserves the selected tone
- Both light and dark modes work with each tone

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/settings-form/generals.tsx
git commit -m "feat: add color tone picker to General settings page"
```

### Task 14: Final verification

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

- [ ] **Step 4: Run format**

```bash
pnpm format
```

- [ ] **Step 5: Verify app startup**

```bash
pnpm dev
```

Verify:

- App starts without errors
- Settings page loads
- All existing settings (providers, tools, etc.) still work
- Color tone picker works in light and dark mode
- Tone persists across app restart

- [ ] **Step 6: Final commit if any format/lint fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
