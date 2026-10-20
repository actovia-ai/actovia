# Appearance System — Design

Date: 2026-09-19
Status: Withdrawn — superseded by the Color tone picker (see note below)

> **Withdrawn (2026-09-19):** implemented, then replaced the same day by the much simpler Settings → General → Color tone picker (`settings.colorTone`, the universal-client approach) at the user's request. Kept for history only.

## Summary

Actovia gets a Settings → **Appearance** page, modelled on the ChatGPT
desktop app's Appearance settings (the user's reference screenshot): a theme
mode switcher (System / Light / Dark), one card per colour scheme (**Light
theme**, **Dark theme**) with a preset picker, three editable colours
(Accent, Background, Foreground), Import / Copy theme, then UI font, content
font, a Translucent-sidebar toggle and a Contrast slider.

Everything the user picks is persisted in one new `settings.appearance`
jsonb column and turned into the shadcn/Tailwind design tokens the whole
renderer already consumes (`--background`, `--primary`, `--sidebar`, …). No
component learns about themes: a pure **palette derivation** takes three
colours + a contrast level and writes every token, so a preset re-skins the
entire app, including sub-apps (search bar, quick chat, artifacts).

## Goals

- A curated list of well-known presets (GitHub, Catppuccin, Dracula, Gruvbox,
  Nord, Solarized, Everforest, Ayu, Tokyo Night, One Dark, Rosé Pine) plus
  the current look as **Actovia** (the default — a fresh install renders
  pixel-identically to today).
- Per-scheme customisation: pick a preset, then override Accent /
  Background / Foreground individually with a hex field + native colour
  picker. Named accents (Blue, Purple, Pink, Red, Orange, Yellow, Green,
  Graphite) in an accent dropdown, plus **Custom**.
- Import / Copy a scheme as a small JSON document so themes can be shared.
- Fonts: UI font (system default, serif, monospace, rounded, or any installed
  family typed by name) with a weight; content font (chat/markdown body)
  that can follow the UI font or differ.
- Translucent sidebar on/off (macOS vibrancy) — off paints the sidebar with
  the theme's sidebar colour and gives the window an opaque background.
- Contrast 0–100: scales how far surfaces, borders and secondary text sit
  from the background.
- Live preview: every change applies immediately (autosave), with no flash on
  boot (the last resolved theme is cached in `localStorage` and applied
  before React mounts).

## Non-goals

- Bundling web fonts. Font choices are CSS generic families or a family the
  user already has installed.
- Re-theming fixed palettes: syntax highlighting (`.hljs-*`), Monaco (Chat
  Audit / code editor), Philharmonic avatar hues and chart colours keep
  their own light/dark values.
- Per-chat or per-project themes, scheduled themes, or a theme marketplace.
- Moving the theme **mode** (System / Light / Dark) out of `next-themes`'
  `localStorage` key. Sub-apps and the e2e suite rely on that key; the mode
  switcher only moves from General to Appearance in the UI.

## Data model

`packages/shared/src/schemas/settings-schema.ts`:

```ts
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const AppearanceSchemeSchema = z.object({
  // A THEME_PRESETS id, or 'custom' once the user has imported a theme.
  preset: z.string().default('actovia'),
  // Overrides. null → take the preset's value.
  accent: hexColor.nullish(),
  background: hexColor.nullish(),
  foreground: hexColor.nullish()
})

export const FontSettingSchema = z.object({
  family: z
    .enum(['system', 'serif', 'mono', 'rounded', 'custom'])
    .default('system'),
  customFamily: z.string().max(100).nullish(),
  // 'light' (300) is what globals.css applied globally before this feature.
  weight: z.enum(['light', 'regular', 'medium']).default('light')
})

export const ContentFontSettingSchema = FontSettingSchema.extend({
  // 'ui' → same family AND weight as the UI font.
  family: z
    .enum(['ui', 'system', 'serif', 'mono', 'rounded', 'custom'])
    .default('ui')
})

export const AppearanceSchema = z.object({
  light: AppearanceSchemeSchema.prefault({}),
  dark: AppearanceSchemeSchema.prefault({}),
  uiFont: FontSettingSchema.prefault({}),
  contentFont: ContentFontSettingSchema.prefault({}),
  translucentSidebar: z.boolean().default(true),
  contrast: formNumber(z.number().int().min(0).max(100)).default(50)
})
```

`SettingsSchema` gains `appearance: AppearanceSchema.nullish()`; the DB
table gains `appearance: jsonb('appearance')` (migration
`resources/drizzle/0003_*.sql` via `bun run db:generate`). `null` (every
existing install) resolves to the defaults, i.e. today's look.

The page never writes dotted sub-paths. It normalises the stored value with
`AppearanceSchema.parse(raw ?? {})`, applies a patch, and writes the whole
object back with `form.setValue('appearance', next)` so one preset pick (which
touches four fields) is one autosave.

## Presets and named accents

`packages/shared/src/constants/appearance.ts`:

```ts
export interface SchemeColors {
  accent: string
  background: string
  foreground: string
}
export interface ThemePreset {
  id: string
  name: string
  light: SchemeColors
  dark: SchemeColors
}
export const THEME_PRESETS: readonly ThemePreset[]
export const NAMED_ACCENTS: readonly {
  id: string
  light: string
  dark: string
}[]
export const FONT_FAMILY_STACKS: Record<
  'system' | 'serif' | 'mono' | 'rounded',
  string
>
export const FONT_WEIGHTS: Record<'light' | 'regular' | 'medium', number> // 300 / 400 / 500
export const APPEARANCE_CACHE_KEY = 'actovia-appearance'
export const CUSTOM_PRESET_ID = 'custom'
```

Preset names are proper nouns (not translated); the `Actovia` preset's colours
are the hex equivalents of the current `globals.css` oklch tokens. A unit
test asserts every preset's foreground/background pair meets WCAG AA (≥ 4.5)
in both schemes, so no shipped preset is illegible.

## Palette derivation

`packages/shared/src/utils/color.ts` — pure colour maths, no DOM:
`parseHex`, `formatHex`, sRGB ⇄ OKLab, `mix(a, b, t)` (in OKLab),
`relativeLuminance`, `contrastRatio` (WCAG), `contrastingForeground(color,
candidates)`.

`packages/shared/src/utils/appearance.ts`:

- `resolveScheme(scheme, slot: 'light'|'dark') → SchemeColors` — preset
  lookup (unknown id → `actovia`) with overrides applied.
- `derivePalette(colors, contrast) → Record<TokenName, string>` — every
  shadcn token. `isDark = relativeLuminance(background) < 0.4` picks one of
  two ramp tables (dark surfaces need larger steps than light ones); each
  entry is a mix ratio `t` between background and foreground. The ramps are
  tuned so `Actovia` at contrast 50 reproduces today's tokens. Contrast maps
  to a multiplier `k = 0.5 + contrast / 100` applied to every surface,
  border and muted-foreground ratio (clamped to `[0, 1]`); `background`,
  `foreground` and `primary` are never scaled.
  - Accent → `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`.
  - `--primary-foreground` = whichever of background/foreground has the
    higher contrast against the accent.
  - `--destructive` is a fixed red per scheme.
  - `--chart-1..5` are a neutral bg→fg ramp (unchanged from today).
- `resolveAppearance(raw) → ResolvedAppearance` —
  `{ light: Palette, dark: Palette, fonts: { ui: {family, weight}, content: {family, weight} }, translucentSidebar, contrast }`
  with the font family already expanded to a CSS stack (a custom family is
  quoted and followed by the system stack).
- `exportScheme(colors, name) → string` and `parseSchemeImport(text) →
  SchemeColors | { error }` — the JSON shape is
  `{ "name": "GitHub", "accent": "#1F6FEB", "background": "#0D1117", "foreground": "#E6EDF3" }`.

## Applying a theme (renderer)

`src/renderer/lib/appearance.ts`:

- `buildAppearanceCss(resolved) → string` — pure; emits
  `:root { …light tokens… }`, `.dark { …dark tokens… }` and
  `:root { --font-ui; --font-weight-base; --font-content; --font-weight-content }`.
- `applyAppearance(resolved)` — upserts a `<style id="actovia-appearance">`
  at the end of `<head>` (after the bundled globals.css, so equal-specificity
  rules win) and sets `data-translucent-sidebar` on `<html>`.
- `readAppearanceCache()` / `writeAppearanceCache(raw)` — the raw
  `AppearanceSchema` value under `APPEARANCE_CACHE_KEY`, wrapped in
  try/catch.
- `bootAppearance()` — synchronous: cache → resolve → apply. Called at the
  top of every renderer entry (`main.tsx` and the three sub-apps) before
  `createRoot`, so the first paint already has the theme.
- `subscribeAppearanceCache(cb)` — a `storage` listener; sub-apps use it to
  follow changes made in the main window (same origin, shared
  `localStorage` in both dev and packaged builds).

`src/renderer/components/appearance-provider.tsx` — `AppearanceProvider`, a
side-effect bridge like `LocaleBridge`: `useSettings()` → `resolveAppearance`
→ `applyAppearance` + `writeAppearanceCache` + `setWindowTranslucency(...)`
over IPC. Mounted inside `ThemeProvider` in `main.tsx`.

`globals.css` changes:

- `* { font-weight: var(--font-weight-base, 300) }` replaces `font-light`.
- `html { font-family: var(--font-ui, <system stack>) }`.
- `.markdown { font-family: var(--font-content, inherit); --font-weight-base: var(--font-weight-content, 300) }`
  — redefining the variable for the subtree means the `*` rule picks up the
  content weight for every descendant while `strong`/headings keep their
  explicit weights.
- An unlayered rule paints the sidebar and the settings sidebar opaque when
  `html[data-translucent-sidebar='false']` (unlayered beats the
  `bg-transparent` utility).

## Main process

- IPC `set-window-translucency` `{ enabled: boolean; backgroundColor: string }`
  in `src/main/lib/ipc.ts`: on darwin `setVibrancy(enabled ? 'sidebar' : null)`;
  when disabled `setBackgroundColor(backgroundColor)`, when enabled
  `setBackgroundColor('#00000000')` first so the vibrancy view shows through
  again. Other platforms only set the background colour.
- Renderer wrapper `setWindowTranslucency()` in `src/renderer/lib/ipc.ts`.
- Schema: `appearance` jsonb column + Drizzle migration.

## UI

`SettingsLabel.Appearance` ('Appearance'), slug `appearance`, in the
Personal group right after General. The General page loses its Theme row;
the switcher component moves to the new page (test id
`settings.themeMode-*` and its e2e assertions keep working, the spec just
opens the Appearance section first).

`src/renderer/components/settings/settings-form/appearance.tsx` composes:

1. **Mode** — the existing System / Light / Dark pill.
2. **Light theme** / **Dark theme** — `appearance/scheme-card.tsx`, one per
   slot. Card header: title, `Import`, `Copy theme` (ghost buttons), an
   `Aa` tile in the resolved colours, the preset `Select` (each item = `Aa`
   tile + name; the trigger shows **Custom** when the stored preset is
   `custom` or any override is set). Rows: Accent (accent `Select` of named
   accents + Custom, and a `ColorField`), Background, Foreground
   (`ColorField`). A low-contrast warning (`SettingsRow warning`) appears
   when foreground/background < 4.5.
   - Picking a preset sets `preset` and clears the three overrides.
   - Editing a colour writes the override; the preset value is kept as the
     base for the other two.
   - Named accent → `accent` override = the named hex for that slot;
     "Preset" → `accent: null`; Custom → enables the hex field.
   - Copy theme → clipboard JSON + toast. Import → `theme-import-dialog.tsx`
     (Dialog + Textarea + Import button); a valid document sets
     `preset: 'custom'` and all three overrides; invalid JSON shows the
     error inline.
3. **Fonts** — UI font (`SettingsSelect`: System default / Serif / Monospace
   / Rounded / Custom…) + weight; a text input for the family name when
   Custom; Content font (Same as UI font / …) + weight (disabled while
   following the UI font).
4. **Window** — Translucent sidebar `Switch` (row hidden unless
   `window.electron.process.platform === 'darwin'`), Contrast `Slider`
   with the numeric value beside it.

`appearance/color-field.tsx` is an `InputGroup`: a leading addon holding a
native `<input type="color">` rendered as a circle swatch, and the hex text
input; the group is filled with the colour itself and its text uses the
contrasting foreground, as in the reference. Invalid hex is ignored until it
parses.

All copy lives under `settings:appearance.*` (plus `nav.appearance.title`) in
all ten locales.

## Test IDs

`TEST_IDS.appearance.*` — `presetSelect`, `accentSelect`, `colorInput`
(suffixed `-light-accent`, `-dark-background`, … like `settings.themeMode-*`),
`copyTheme`, `importTheme`, `importTextarea`, `importConfirm`, `uiFontSelect`,
`uiFontWeight`, `customFontInput`, `contentFontSelect`, `contentFontWeight`,
`translucentSidebar`, `contrastSlider`.

## Testing

Unit (node, no DOM):

- `tests/unit/shared/utils/color.test.ts` — hex round trip, OKLab mix
  endpoints/midpoint monotonicity, luminance of black/white, WCAG contrast of
  known pairs (black/white = 21), `contrastingForeground`.
- `tests/unit/shared/utils/appearance.test.ts` — `resolveScheme` (preset,
  overrides, unknown preset falls back), `derivePalette` (Actovia at 50
  matches today's tokens within tolerance, higher contrast moves border
  further from background, dark detection, `primary-foreground` legible),
  `resolveAppearance(null)` defaults, font stack expansion (custom quoted),
  export/import round trip and rejection of bad input.
- `tests/unit/shared/constants/appearance.test.ts` — unique ids, valid hex,
  AA contrast for every preset in both schemes, named accents valid.
- `tests/unit/shared/schemas/settings-schema.test.ts` — `AppearanceSchema`
  defaults from `{}`, hex validation, contrast bounds.
- `tests/unit/renderer/lib/appearance.test.ts` — `buildAppearanceCss`
  contains both scheme blocks and the font variables.
- `tests/unit/i18n/settings-namespace.test.ts` — new keys present.

E2E (`tests/e2e/settings-appearance.spec.ts`): open Appearance; switch mode
to dark and pick the GitHub preset → `--background` on `<html>` becomes
`#0d1117`; edit the hex field → token follows; toggle translucent sidebar →
`data-translucent-sidebar="false"`; nudge the contrast slider with the
keyboard → the value label changes; import a theme via the dialog → colours
follow; reload → persisted. `settings-e2e.spec.ts`'s theme-mode test opens
the Appearance section.

## Files

New: `packages/shared/src/constants/appearance.ts`,
`packages/shared/src/utils/color.ts`, `packages/shared/src/utils/appearance.ts`,
`src/renderer/lib/appearance.ts`, `src/renderer/components/appearance-provider.tsx`,
`src/renderer/components/settings/settings-form/appearance.tsx`,
`src/renderer/components/settings/settings-form/appearance/{scheme-card,color-field,preset-select,theme-import-dialog,theme-mode-switcher}.tsx`,
`resources/drizzle/0003_*.sql`, the tests above.

Modified: `settings-schema.ts`, `db/schema.ts`, `ipc.ts` (both; `window.ts`
is untouched — vibrancy stays as the boot default), `settings-menu.ts`,
`use-settings-tab.ts`, `settings-form.tsx`, `generals.tsx`, `main.tsx` + three
sub-app entries, `globals.css`, `test-ids.ts`, ten `settings.json` catalogs,
`CLAUDE.md`.
