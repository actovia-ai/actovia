# Color Tone Presets + Naming Cleanup

**Date**: 2026-03-24

---

## 1. Color Tone Selection (Settings → General)

### Overview

Add a "Color Tone" picker to the General settings page. Six presets that shift the OKLCH hue channel across all CSS variables — background, card, border, primary, sidebar, etc. — for full global tinting in both light and dark modes.

### Presets

| Name    | Hue | Description                    |
| ------- | --- | ------------------------------ |
| Neutral | —   | Default, pure gray, chroma → 0 |
| Emerald | 160 | Green                          |
| Blue    | 230 | Classic blue                   |
| Violet  | 285 | Purple                         |
| Rose    | 350 | Warm pink                      |
| Orange  | 55  | Warm amber                     |

### Implementation

**Storage**: Add `colorTone` field to the `settings` table (text column, default `'emerald'`). Add corresponding field to `SettingsSchema` as `z.enum(['neutral', 'emerald', 'blue', 'violet', 'rose', 'orange']).default('neutral')`.

**CSS Strategy**: Use a data attribute on `<html>` (e.g., `data-tone="blue"`) to select the active tone. Define each tone as a CSS ruleset:

```css
:root,
[data-tone='neutral'] {
  /* default: chroma → 0, pure gray */
}
[data-tone='emerald'] {
  /* hue ~160 (current green values) */
}
[data-tone='blue'] {
  /* hue ~230 */
}
[data-tone='violet'] {
  /* hue ~285 */
}
/* ... */
```

Dark mode variants use `.dark[data-tone="blue"]` selectors.

**Tone Provider**: Create a `ToneProvider` (similar pattern to `ThemeProvider`) that:

1. Reads `colorTone` from the settings form / SWR data
2. Sets `data-tone` attribute on `document.documentElement`
3. Exposes `tone` and `setTone` via React context

Alternatively, integrate into the existing `ThemeProvider` to avoid a second provider. Since the tone is persisted server-side (in the settings table) unlike theme (localStorage), a separate thin provider or a hook is cleaner.

**UI**: In `generals.tsx`, add a `SettingRow` with label "Color Tone" below the Theme row. Display the 6 options as colored circle buttons (swatch picker style) — each circle filled with the preset's primary color. The active tone gets a ring indicator. On click, update the form field and the `data-tone` attribute.

**CSS Variable Generation**: For each tone, compute CSS variables by substituting the hue value. The chroma and lightness values stay the same as the current emerald theme; only the hue channel changes. For "Neutral", set chroma to 0 across all variables.

**Exceptions — colors that do NOT shift with tone**:

- `--destructive` / `--destructive-foreground` — always red (hue ~27), semantic meaning must be preserved
- `--chart-1` through `--chart-5` — keep their independent hues (160, 265, 25, 80, 330) for data visualization readability. Only `--chart-1` shifts to match the primary tone.

### Color Values Per Tone

Each tone replaces the hue in OKLCH. The current emerald values serve as the template. All variables in `:root` and `.dark` that carry a hue are shifted, except destructive and chart-2..5:

**Light mode variables shifted** (H = tone hue):

- `--background: oklch(0.985 0.004 H)`
- `--foreground: oklch(0.16 0.02 H)`
- `--card: oklch(0.995 0.003 H-5)`
- `--card-foreground: oklch(0.16 0.02 H)`
- `--popover: oklch(0.995 0.003 H-5)`
- `--popover-foreground: oklch(0.16 0.02 H)`
- `--primary: oklch(0.52 0.17 H)`
- `--primary-foreground: oklch(0.98 0 0)` (white, no hue)
- `--secondary: oklch(0.955 0.01 H-5)`
- `--secondary-foreground: oklch(0.2 0.02 H)`
- `--muted: oklch(0.955 0.01 H-5)`
- `--muted-foreground: oklch(0.5 0.015 H)`
- `--accent: oklch(0.94 0.02 H-5)`
- `--accent-foreground: oklch(0.2 0.02 H)`
- `--border: oklch(0.905 0.012 H-5)`
- `--input: oklch(0.905 0.012 H-5)`
- `--ring: oklch(0.55 0.16 H)`
- `--chart-1: oklch(0.55 0.17 H)`
- `--sidebar: oklch(0.975 0.006 H-5)`
- `--sidebar-foreground: oklch(0.16 0.02 H)`
- `--sidebar-primary: oklch(0.52 0.17 H)`
- `--sidebar-primary-foreground: oklch(0.98 0 0)`
- `--sidebar-accent: oklch(0.94 0.02 H-5)`
- `--sidebar-accent-foreground: oklch(0.2 0.02 H)`
- `--sidebar-border: oklch(0.905 0.012 H-5)`
- `--sidebar-ring: oklch(0.55 0.16 H)`

**Dark mode** follows the same pattern with the current dark emerald lightness/chroma values, hue shifted to H/H+5.

For Neutral: all chroma values become 0, hues become irrelevant.

### Startup Flash Prevention (FOUC)

The tone is persisted server-side in the settings table, but also cached in `localStorage` (key: `'actovia-color-tone'`). On page load, a synchronous inline script in `index.html` reads localStorage and sets `data-tone` on `<html>` before React mounts — identical to how the theme class is applied. When settings load from the server, the tone is reconciled and localStorage is updated.

### Sub-App Support

All three entry points (main app, searchbar, quick-chat) share the same `globals.css` and apply the `data-tone` attribute via the same inline script in their respective HTML files.

---

## 2. "Setting" → "Settings" Rename

### Scope

Rename all occurrences of singular "Setting" to plural "Settings" across the full stack:

**Database**:

- Table: `setting` → `settings` (requires migration)
- Type: `Setting` → `Settings`

**Backend**:

- Route file: `routes/setting.ts` → `routes/settings.ts`
- Route path: `/api/setting` → `/api/settings`
- Schema file: `schemas/setting.ts` → `schemas/settings.ts`
- Query functions: `getSetting()` → `getSettings()`, `updateSetting()` → `updateSettings()`

**Shared**:

- Schema file: `schemas/setting-schema.ts` → `schemas/settings-schema.ts`
- Types: `SettingSchema` → `SettingsSchema`, `SettingInput` → `SettingsInput`, `Setting` → `Settings`

**Frontend**:

- Service: `services/setting.ts` → `services/settings.ts`
- Hook: `hooks/use-setting.ts` → `hooks/use-settings.ts`, `useSetting()` → `useSettings()`
- Store: `stores/setting.ts` → `stores/settings.ts`
- Component directory: `components/setting/` → `components/settings/`
- All imports updated accordingly

### Migration Strategy

Generate a Drizzle migration that renames the table. All internal references (column names, foreign keys) remain unchanged since `setting` has no foreign key dependents. The implementer must do a comprehensive search (grep for `/api/setting`, `useSetting`, `getSetting`, `'setting'` etc.) to catch all references — the list above covers the major ones but 27+ files may be affected.

---

## 3. Database Column Naming Standardization

### Convention

- **Table names**: snake_case (already correct for most tables)
- **Column names**: camelCase (need to fix snake_case columns in newer tables)

### Columns to Rename

**`setting` table** (renamed to `settings` in step 2, but column renames happen first while still called `setting`):

- `created_at` → `createdAt`
- `updated_at` → `updatedAt`

**`memory` table**:

- `user_id` → `userId`
- `created_at` → `createdAt`
- `updated_at` → `updatedAt`
- `last_used_at` → `lastUsedAt`
- `is_active` → `isActive`

**`session_summary` table**:

- `session_id` → `sessionId`
- `user_id` → `userId`
- `updated_at` → `updatedAt`

**`memory_usage_log` table**:

- `memory_id` → `memoryId`
- `session_id` → `sessionId`
- `created_at` → `createdAt`

**`lcm_summary` table**:

- `chat_id` → `chatId`
- `token_count` → `tokenCount`
- `descendant_count` → `descendantCount`
- `earliest_at` → `earliestAt`
- `latest_at` → `latestAt`
- `created_at` → `createdAt`

**`lcm_summary_messages` table**:

- `summary_id` → `summaryId`
- `message_id` → `messageId`

**`lcm_summary_parents` table**:

- `child_id` → `childId`
- `parent_id` → `parentId`

**`lcm_context_items` table**:

- `chat_id` → `chatId`
- `token_count` → `tokenCount`
- `ref_id` → `refId`

### Migration Strategy

Generate a single Drizzle migration with `ALTER TABLE ... RENAME COLUMN` statements for all affected columns. Use `ALTER TABLE IF EXISTS` to guard against tables that may not exist in older databases (e.g., `lcm_*` tables added recently). Update the schema.ts file to use camelCase strings in the column definitions.

**Note**: The TypeScript property names in schema.ts already use camelCase (e.g., `createdAt: timestamp('created_at')`). After the rename, they become `createdAt: timestamp('createdAt')` — the string argument matches the property name, so some can be simplified to just `timestamp()` with no explicit name.

**Raw SQL caveat**: camelCase column names in Postgres require double-quoting in raw SQL (e.g., `SELECT "createdAt" FROM chat`). Audit any raw SQL in the codebase (e.g., the GIN index in schema.ts) to ensure correct quoting. Drizzle handles this automatically for ORM queries.

---

## Ordering

1. **Column rename migration** — foundation, no code changes beyond schema.ts
2. **Setting → Settings rename** — includes table rename migration + full-stack rename
3. **Color tone feature** — new feature built on top of the renamed settings infrastructure
