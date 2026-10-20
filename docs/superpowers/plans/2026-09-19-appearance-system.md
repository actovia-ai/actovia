# Appearance System Implementation Plan

> **Withdrawn (2026-09-19):** implemented, then replaced the same day by the much simpler Settings → General → Color tone picker (`settings.colorTone`, the universal-client approach) at the user's request. Kept for history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings → Appearance page (theme mode, light/dark scheme cards with presets + accent/background/foreground, import/copy, fonts, translucent sidebar, contrast) whose choices persist in `settings.appearance` and are rendered as the shadcn CSS tokens the whole renderer already uses.

**Architecture:** Pure, DOM-free modules in `packages/shared` (schema, presets, colour maths, palette derivation) produce a `ResolvedAppearance`; a renderer lib turns it into one injected `<style>` element plus `<html>` data attributes, applied synchronously from a `localStorage` cache at boot and kept current by an `AppearanceProvider` that follows `useSettings()`. The main process only learns one IPC: toggle window vibrancy / background colour.

**Tech Stack:** zod 4 (`prefault`), Drizzle + PGlite (jsonb column + migration), React 19 + react-hook-form autosave, shadcn/base-ui primitives (`Select`, `Slider`, `Switch`, `InputGroup`, `Dialog`), next-themes (mode only), Vitest (node env), Playwright Electron e2e.

**Spec:** `docs/superpowers/specs/2026-09-19-appearance-system-design.md`

## Global Constraints

- Every new user-facing string is a key under `settings:appearance.*` (or `settings:nav.appearance.title`) in `packages/shared/src/i18n/locales/en/settings.json` **and in the other nine locales** (`zh-Hant-TW`, `zh-Hant-HK`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `it`) — `bun run i18n:check` fails on a key missing from a `source: machine` locale.
- No raw `data-testid="…"`; every id goes through `TEST_IDS` and must be applied in `src/renderer` and referenced from a file under `tests/`.
- Unit tests live under `tests/unit/`, mirror `src/`/`packages/`, import via `@actovia/shared/...`, `@/...`, `@main/...`; Vitest runs in the **node** environment (no DOM).
- New `packages/shared` modules need an `exports` entry in `packages/shared/package.json`.
- Pre-commit gate: `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test`.
- The `Actovia` preset at contrast 50 must reproduce today's tokens: light `bg #ffffff fg #0a0a0a accent #171717`, dark `bg #0a0a0a fg #fafafa accent #e5e5e5`.
- Theme **mode** stays in next-themes (`vite-ui-theme` localStorage key); never persist it in settings.

---

### Task 1: Appearance schema + constants (presets, accents, fonts)

**Files:**

- Modify: `packages/shared/src/schemas/settings-schema.ts` (add schemas before `SettingsSchema`, add `appearance` field)
- Create: `packages/shared/src/constants/appearance.ts`
- Modify: `packages/shared/package.json` (exports)
- Test: `tests/unit/shared/schemas/settings-schema.test.ts` (append), `tests/unit/shared/constants/appearance.test.ts`

**Interfaces:**

- Produces: `AppearanceSchemeSchema`, `FontSettingSchema`, `ContentFontSettingSchema`, `AppearanceSchema`, types `Appearance`, `AppearanceScheme`, `FontSetting`, `ContentFontSetting`, `FontWeightId`, `FontFamilyId`; constants `THEME_PRESETS`, `DEFAULT_PRESET_ID = 'actovia'`, `CUSTOM_PRESET_ID = 'custom'`, `NAMED_ACCENTS`, `FONT_FAMILY_STACKS`, `FONT_WEIGHTS`, `APPEARANCE_CACHE_KEY`, `SchemeSlot`, `SchemeColors`, `ThemePreset`.

- [ ] **Step 1: Write the failing schema tests** (append to `tests/unit/shared/schemas/settings-schema.test.ts`)

```ts
import { AppearanceSchema } from '@actovia/shared/schemas/settings-schema'

describe('AppearanceSchema', () => {
  it('fills every default from an empty object', () => {
    const parsed = AppearanceSchema.parse({})
    expect(parsed.light.preset).toBe('actovia')
    expect(parsed.dark.preset).toBe('actovia')
    expect(parsed.uiFont).toEqual({ family: 'system', weight: 'light' })
    expect(parsed.contentFont).toEqual({ family: 'ui', weight: 'light' })
    expect(parsed.translucentSidebar).toBe(true)
    expect(parsed.contrast).toBe(50)
  })

  it('accepts overrides as 6-digit hex only', () => {
    expect(
      AppearanceSchema.safeParse({ light: { accent: '#1F6FEB' } }).success
    ).toBe(true)
    expect(
      AppearanceSchema.safeParse({ light: { accent: 'blue' } }).success
    ).toBe(false)
    expect(
      AppearanceSchema.safeParse({ light: { accent: '#fff' } }).success
    ).toBe(false)
  })

  it('bounds contrast to 0..100 and coerces the form string', () => {
    expect(AppearanceSchema.safeParse({ contrast: 101 }).success).toBe(false)
    expect(AppearanceSchema.parse({ contrast: '70' }).contrast).toBe(70)
  })
})
```

- [ ] **Step 2: Write the failing constants test** (`tests/unit/shared/constants/appearance.test.ts`)

```ts
import {
  CUSTOM_PRESET_ID,
  DEFAULT_PRESET_ID,
  FONT_FAMILY_STACKS,
  FONT_WEIGHTS,
  NAMED_ACCENTS,
  THEME_PRESETS
} from '@actovia/shared/constants/appearance'
import { contrastRatio } from '@actovia/shared/utils/color'
import { describe, expect, it } from 'vitest'

const HEX = /^#[0-9a-f]{6}$/

describe('THEME_PRESETS', () => {
  it('has unique ids, none of them the custom sentinel, and includes the default', () => {
    const ids = THEME_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(CUSTOM_PRESET_ID)
    expect(ids).toContain(DEFAULT_PRESET_ID)
  })

  it('uses lowercase 6-digit hex everywhere', () => {
    for (const p of THEME_PRESETS) {
      for (const slot of ['light', 'dark'] as const) {
        for (const c of Object.values(p[slot])) expect(c).toMatch(HEX)
      }
    }
  })

  it('every preset is legible (WCAG AA) in both schemes', () => {
    for (const p of THEME_PRESETS) {
      for (const slot of ['light', 'dark'] as const) {
        const { background, foreground } = p[slot]
        expect(
          contrastRatio(foreground, background),
          `${p.id}/${slot}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the Actovia preset reproduces the pre-appearance globals.css tokens', () => {
    const actovia = THEME_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
    expect(actovia.light).toEqual({
      background: '#ffffff',
      foreground: '#0a0a0a',
      accent: '#171717'
    })
    expect(actovia.dark).toEqual({
      background: '#0a0a0a',
      foreground: '#fafafa',
      accent: '#e5e5e5'
    })
  })
})

describe('NAMED_ACCENTS / fonts', () => {
  it('named accents are valid hex in both slots', () => {
    for (const a of NAMED_ACCENTS) {
      expect(a.light).toMatch(HEX)
      expect(a.dark).toMatch(HEX)
    }
  })
  it('weights map to CSS numbers', () => {
    expect(FONT_WEIGHTS).toEqual({ light: 300, regular: 400, medium: 500 })
  })
  it('every generic family stack ends in a CSS generic keyword', () => {
    expect(FONT_FAMILY_STACKS.system).toMatch(/sans-serif/)
    expect(FONT_FAMILY_STACKS.serif).toMatch(/serif$/)
    expect(FONT_FAMILY_STACKS.mono).toMatch(/monospace$/)
    expect(FONT_FAMILY_STACKS.rounded).toMatch(/sans-serif$/)
  })
})
```

- [ ] **Step 3: Run both tests, expect failure** — `bun run vitest run tests/unit/shared/constants/appearance.test.ts tests/unit/shared/schemas/settings-schema.test.ts` → module-not-found / `AppearanceSchema` undefined.

- [ ] **Step 4: Add the schemas** (in `settings-schema.ts`, above `SettingsSchema`)

```ts
// ─── Appearance ──────────────────────────────────────────────────────────────
// Everything on Settings → Appearance except the light/dark/system MODE, which
// next-themes keeps in localStorage (sub-apps and the e2e suite read that key).

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB')

export const AppearanceSchemeSchema = z.object({
  // A THEME_PRESETS id, or CUSTOM_PRESET_ID after an import.
  preset: z.string().default('actovia'),
  // Per-colour overrides. null → the preset's own value.
  accent: hexColor.nullish(),
  background: hexColor.nullish(),
  foreground: hexColor.nullish()
})
export type AppearanceScheme = z.infer<typeof AppearanceSchemeSchema>

export const FontWeightSchema = z.enum(['light', 'regular', 'medium'])
export type FontWeightId = z.infer<typeof FontWeightSchema>

export const FontFamilySchema = z.enum([
  'system',
  'serif',
  'mono',
  'rounded',
  'custom'
])
export type FontFamilyId = z.infer<typeof FontFamilySchema>

export const FontSettingSchema = z.object({
  family: FontFamilySchema.default('system'),
  // Only read when family === 'custom': a family installed on this machine.
  customFamily: z.string().max(100).nullish(),
  // 'light' (300) is the weight globals.css applied to every element before
  // this setting existed, so the default is a no-op.
  weight: FontWeightSchema.default('light')
})
export type FontSetting = z.infer<typeof FontSettingSchema>

export const ContentFontSettingSchema = FontSettingSchema.extend({
  // 'ui' → same family AND weight as the UI font.
  family: z.enum(['ui', ...FontFamilySchema.options]).default('ui')
})
export type ContentFontSetting = z.infer<typeof ContentFontSettingSchema>

export const AppearanceSchema = z.object({
  light: AppearanceSchemeSchema.prefault({}),
  dark: AppearanceSchemeSchema.prefault({}),
  uiFont: FontSettingSchema.prefault({}),
  contentFont: ContentFontSettingSchema.prefault({}),
  translucentSidebar: z.boolean().default(true),
  // 0..100; 50 is neutral (k = 1.0 in derivePalette).
  contrast: formNumber(z.number().int().min(0).max(100)).default(50)
})
export type Appearance = z.infer<typeof AppearanceSchema>
```

and in `SettingsSchema`, after `keyboardShortcuts`: `appearance: AppearanceSchema.nullish(),`.

- [ ] **Step 5: Create `packages/shared/src/constants/appearance.ts`**

```ts
export type SchemeSlot = 'light' | 'dark'

export interface SchemeColors {
  accent: string
  background: string
  foreground: string
}

export interface ThemePreset {
  id: string
  /** Proper noun — never translated. */
  name: string
  light: SchemeColors
  dark: SchemeColors
}

export const DEFAULT_PRESET_ID = 'actovia'
/** `AppearanceScheme.preset` after an import: no preset is the base. */
export const CUSTOM_PRESET_ID = 'custom'
/** localStorage key holding the raw `Appearance` value for flash-free boot. */
export const APPEARANCE_CACHE_KEY = 'actovia-appearance'

// Hex values are the canonical palettes' own numbers (GitHub Primer, Catppuccin
// Latte/Mocha, Dracula/Alucard, Gruvbox, Nord, Solarized, Everforest, Ayu
// Light/Mirage, Tokyo Night Day/Night, One Light/Dark, Rosé Pine Dawn/Main).
// `actovia` is the pre-appearance globals.css look (Tailwind neutral scale).
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'actovia',
    name: 'Actovia',
    light: { background: '#ffffff', foreground: '#0a0a0a', accent: '#171717' },
    dark: { background: '#0a0a0a', foreground: '#fafafa', accent: '#e5e5e5' }
  },
  {
    id: 'github',
    name: 'GitHub',
    light: { background: '#ffffff', foreground: '#1f2328', accent: '#0969da' },
    dark: { background: '#0d1117', foreground: '#e6edf3', accent: '#1f6feb' }
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    light: { background: '#eff1f5', foreground: '#4c4f69', accent: '#1e66f5' },
    dark: { background: '#1e1e2e', foreground: '#cdd6f4', accent: '#89b4fa' }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    light: { background: '#fffbeb', foreground: '#1f1f1f', accent: '#644ac9' },
    dark: { background: '#282a36', foreground: '#f8f8f2', accent: '#bd93f9' }
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    light: { background: '#fbf1c7', foreground: '#3c3836', accent: '#af3a03' },
    dark: { background: '#282828', foreground: '#ebdbb2', accent: '#fe8019' }
  },
  {
    id: 'nord',
    name: 'Nord',
    light: { background: '#eceff4', foreground: '#2e3440', accent: '#5e81ac' },
    dark: { background: '#2e3440', foreground: '#eceff4', accent: '#88c0d0' }
  },
  {
    id: 'solarized',
    name: 'Solarized',
    light: { background: '#fdf6e3', foreground: '#586e75', accent: '#268bd2' },
    dark: { background: '#002b36', foreground: '#93a1a1', accent: '#268bd2' }
  },
  {
    id: 'everforest',
    name: 'Everforest',
    light: { background: '#fdf6e3', foreground: '#5c6a72', accent: '#8da101' },
    dark: { background: '#2d353b', foreground: '#d3c6aa', accent: '#a7c080' }
  },
  {
    id: 'ayu',
    name: 'Ayu',
    light: { background: '#fcfcfc', foreground: '#5c6166', accent: '#ff9940' },
    dark: { background: '#1f2430', foreground: '#cccac2', accent: '#ffcc66' }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    light: { background: '#e1e2e7', foreground: '#3760bf', accent: '#2e7de9' },
    dark: { background: '#1a1b26', foreground: '#c0caf5', accent: '#7aa2f7' }
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    light: { background: '#fafafa', foreground: '#383a42', accent: '#4078f2' },
    dark: { background: '#282c34', foreground: '#abb2bf', accent: '#61afef' }
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    light: { background: '#faf4ed', foreground: '#575279', accent: '#907aa9' },
    dark: { background: '#191724', foreground: '#e0def4', accent: '#c4a7e7' }
  }
]

export function findPreset(id: string | null | undefined): ThemePreset {
  return (
    THEME_PRESETS.find((p) => p.id === id) ??
    THEME_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
  )
}

export type NamedAccentId =
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'graphite'

/** The macOS system accent colours, light and dark variants. */
export const NAMED_ACCENTS: readonly {
  id: NamedAccentId
  light: string
  dark: string
}[] = [
  { id: 'blue', light: '#007aff', dark: '#0a84ff' },
  { id: 'purple', light: '#af52de', dark: '#bf5af2' },
  { id: 'pink', light: '#ff2d55', dark: '#ff375f' },
  { id: 'red', light: '#ff3b30', dark: '#ff453a' },
  { id: 'orange', light: '#ff9500', dark: '#ff9f0a' },
  { id: 'yellow', light: '#ffcc00', dark: '#ffd60a' },
  { id: 'green', light: '#34c759', dark: '#30d158' },
  { id: 'graphite', light: '#8e8e93', dark: '#98989d' }
]

export const FONT_FAMILY_STACKS = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", Nunito, Quicksand, sans-serif'
} as const

export const FONT_WEIGHTS = { light: 300, regular: 400, medium: 500 } as const
```

- [ ] **Step 6: Register the exports** in `packages/shared/package.json` (`"./constants/appearance": "./src/constants/appearance.ts"`, `"./utils/color": "./src/utils/color.ts"`, `"./utils/appearance": "./src/utils/appearance.ts"`).

- [ ] **Step 7: Run the schema test → PASS; constants test still fails on `@actovia/shared/utils/color`** (Task 2 supplies it). Commit the schema + constants: `git add packages/shared && git commit -m "feat(appearance): appearance settings schema, presets and font constants"`.

---

### Task 2: Colour maths

**Files:**

- Create: `packages/shared/src/utils/color.ts`
- Test: `tests/unit/shared/utils/color.test.ts`

**Interfaces:**

- Produces: `parseHex(s): [r,g,b] | null` (0–255 ints; accepts `#abc`/`#aabbcc`, any case), `formatHex([r,g,b]): string` (lowercase `#rrggbb`), `normalizeHex(s): string | null`, `isHexColor(s): boolean`, `mix(a, b, t): string` (OKLab interpolation, hex in/out, `t` clamped 0–1), `relativeLuminance(hex): number`, `contrastRatio(a, b): number`, `contrastingForeground(color, preferred, fallback?)`.

- [ ] **Step 1: Write the failing test**

```ts
import {
  contrastRatio,
  contrastingForeground,
  formatHex,
  isHexColor,
  mix,
  normalizeHex,
  parseHex,
  relativeLuminance
} from '@actovia/shared/utils/color'
import { describe, expect, it } from 'vitest'

describe('hex parsing', () => {
  it('round-trips 6-digit hex in lowercase', () => {
    expect(formatHex(parseHex('#1F6FEB')!)).toBe('#1f6feb')
  })
  it('expands 3-digit hex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('ABC')).toBe('#aabbcc')
  })
  it('rejects garbage', () => {
    expect(parseHex('blue')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(isHexColor('#12345g')).toBe(false)
    expect(isHexColor('#0d1117')).toBe(true)
  })
})

describe('mix', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mix('#0a0a0a', '#fafafa', 0)).toBe('#0a0a0a')
    expect(mix('#0a0a0a', '#fafafa', 1)).toBe('#fafafa')
  })
  it('is monotonic in lightness', () => {
    const a = relativeLuminance(mix('#0a0a0a', '#fafafa', 0.25))
    const b = relativeLuminance(mix('#0a0a0a', '#fafafa', 0.5))
    const c = relativeLuminance(mix('#0a0a0a', '#fafafa', 0.75))
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })
  it('clamps t', () => {
    expect(mix('#0a0a0a', '#fafafa', -1)).toBe('#0a0a0a')
    expect(mix('#0a0a0a', '#fafafa', 2)).toBe('#fafafa')
  })
})

describe('contrast', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })
  it('luminance of white is 1 and black is 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })
  it('prefers a preferred candidate that is legible, otherwise falls back', () => {
    expect(contrastingForeground('#171717', ['#ffffff', '#0a0a0a'])).toBe(
      '#ffffff'
    )
    // Everforest light accent: neither scheme colour reaches 4.5, black does.
    expect(contrastingForeground('#8da101', ['#fdf6e3', '#5c6a72'])).toBe(
      '#000000'
    )
  })
})
```

- [ ] **Step 2: Run → FAIL** (`bun run vitest run tests/unit/shared/utils/color.test.ts`).

- [ ] **Step 3: Implement `packages/shared/src/utils/color.ts`**

```ts
// Pure colour maths for the appearance system — no DOM, no dependencies.
// sRGB ⇄ OKLab per Björn Ottosson (https://bottosson.github.io/posts/oklab/).

export type Rgb = [number, number, number] // 0..255 ints

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function parseHex(input: string): Rgb | null {
  const m = HEX_RE.exec(input.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function formatHex([r, g, b]: Rgb): string {
  return (
    '#' +
    [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')
  )
}

/** `#abc` / `ABC` / `#AABBCC` → `#aabbcc`; null when not a hex colour. */
export function normalizeHex(input: string): string | null {
  const rgb = parseHex(input)
  return rgb ? formatHex(rgb) : null
}

export function isHexColor(input: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(input)
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)))
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const toGamma = (c: number) => {
  const v = clamp01(c)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

type Lab = [number, number, number]

function srgbToOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r),
    lg = toLinear(g),
    lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function oklabToSrgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [toGamma(lr) * 255, toGamma(lg) * 255, toGamma(lb) * 255]
}

/** Interpolate `a → b` in OKLab. `t` is clamped to [0, 1]. */
export function mix(a: string, b: string, t: number): string {
  const ra = parseHex(a),
    rb = parseHex(b)
  if (!ra || !rb) throw new Error(`mix(): invalid hex (${a}, ${b})`)
  const k = clamp01(t)
  if (k === 0) return formatHex(ra)
  if (k === 1) return formatHex(rb)
  const la = srgbToOklab(ra),
    lb = srgbToOklab(rb)
  return formatHex(
    oklabToSrgb([
      la[0] + (lb[0] - la[0]) * k,
      la[1] + (lb[1] - la[1]) * k,
      la[2] + (lb[2] - la[2]) * k
    ])
  )
}

/** WCAG 2.x relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) throw new Error(`relativeLuminance(): invalid hex (${hex})`)
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 .. 21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a),
    lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const AA = 4.5

/**
 * The most legible text colour for `color`: the best of `preferred` when it
 * reaches WCAG AA, otherwise the best of `preferred` + `fallback`.
 */
export function contrastingForeground(
  color: string,
  preferred: readonly string[],
  fallback: readonly string[] = ['#ffffff', '#000000']
): string {
  const best = (cands: readonly string[]) =>
    cands.reduce((acc, c) =>
      contrastRatio(color, c) > contrastRatio(color, acc) ? c : acc
    )
  const p = best(preferred)
  if (contrastRatio(color, p) >= AA) return p
  return best([...preferred, ...fallback])
}
```

- [ ] **Step 4: Run color + constants tests → PASS.** Commit: `git add packages/shared tests/unit/shared && git commit -m "feat(appearance): OKLab colour maths + preset legibility tests"`.

---

### Task 3: Palette derivation, resolution, import/export

**Files:**

- Create: `packages/shared/src/utils/appearance.ts`
- Test: `tests/unit/shared/utils/appearance.test.ts`

**Interfaces:**

- Consumes: Task 1 constants/schema, Task 2 colour maths.
- Produces: `PALETTE_TOKENS` (readonly tuple of CSS token names without `--`), `Palette = Record<PaletteToken, string>`, `resolveScheme(scheme: Partial<AppearanceScheme> | null | undefined, slot: SchemeSlot): SchemeColors`, `isSchemeCustomized(scheme): boolean`, `derivePalette(colors: SchemeColors, contrast: number): Palette`, `resolveFontFamily(setting: FontSetting | ContentFontSetting, ui?: FontSetting): string`, `ResolvedAppearance`, `resolveAppearance(raw: unknown): ResolvedAppearance`, `exportScheme(colors: SchemeColors, name: string): string`, `parseSchemeImport(text: string): { ok: true; colors: SchemeColors; name: string | null } | { ok: false }`.

- [ ] **Step 1: Write the failing test**

```ts
import {
  derivePalette,
  exportScheme,
  isSchemeCustomized,
  parseSchemeImport,
  resolveAppearance,
  resolveFontFamily,
  resolveScheme
} from '@actovia/shared/utils/appearance'
import { contrastRatio, relativeLuminance } from '@actovia/shared/utils/color'
import { describe, expect, it } from 'vitest'

const ACTOVIA_LIGHT = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  accent: '#171717'
}

describe('resolveScheme', () => {
  it('returns the preset colours when nothing is overridden', () => {
    expect(resolveScheme({ preset: 'github' }, 'dark')).toEqual({
      background: '#0d1117',
      foreground: '#e6edf3',
      accent: '#1f6feb'
    })
  })
  it('applies overrides on top of the preset', () => {
    expect(
      resolveScheme({ preset: 'github', accent: '#ff0000' }, 'dark').accent
    ).toBe('#ff0000')
  })
  it('falls back to Actovia for unknown presets, null and custom', () => {
    expect(resolveScheme({ preset: 'nope' }, 'light')).toEqual(ACTOVIA_LIGHT)
    expect(resolveScheme(null, 'light')).toEqual(ACTOVIA_LIGHT)
    expect(resolveScheme({ preset: 'custom' }, 'light')).toEqual(ACTOVIA_LIGHT)
  })
  it('reports customisation for custom preset or bg/fg overrides, not accent', () => {
    expect(isSchemeCustomized({ preset: 'github' })).toBe(false)
    expect(isSchemeCustomized({ preset: 'github', accent: '#000000' })).toBe(
      false
    )
    expect(
      isSchemeCustomized({ preset: 'github', background: '#000000' })
    ).toBe(true)
    expect(isSchemeCustomized({ preset: 'custom' })).toBe(true)
  })
})

describe('derivePalette', () => {
  it('reproduces the pre-appearance light tokens for Actovia at contrast 50', () => {
    const p = derivePalette(ACTOVIA_LIGHT, 50)
    expect(p.background).toBe('#ffffff')
    expect(p.foreground).toBe('#0a0a0a')
    expect(p.card).toBe('#ffffff')
    expect(p.primary).toBe('#171717')
    expect(p['primary-foreground']).toBe('#ffffff')
    expect(p.secondary).toBe('#f5f5f5')
    expect(p.muted).toBe('#f5f5f5')
    expect(p.accent).toBe('#f5f5f5')
    expect(p['muted-foreground']).toBe('#737373')
    expect(p.border).toBe('#e5e5e5')
    expect(p.ring).toBe('#a1a1a1')
    expect(p.sidebar).toBe('#fafafa')
    expect(p.destructive).toBe('#e7000b')
    expect(p['chart-2']).toBe('#737373')
  })
  it('reproduces the pre-appearance dark tokens for Actovia at contrast 50', () => {
    const p = derivePalette(
      { background: '#0a0a0a', foreground: '#fafafa', accent: '#e5e5e5' },
      50
    )
    expect(p.card).toBe('#171717')
    expect(p.secondary).toBe('#262626')
    expect(p['muted-foreground']).toBe('#a1a1a1')
    expect(p.ring).toBe('#737373')
    expect(p.sidebar).toBe('#171717')
    expect(p.destructive).toBe('#ff6467')
    expect(p['primary-foreground']).toBe('#0a0a0a')
  })
  it('higher contrast pushes borders and muted text away from the background', () => {
    const lo = derivePalette(ACTOVIA_LIGHT, 0)
    const hi = derivePalette(ACTOVIA_LIGHT, 100)
    expect(relativeLuminance(hi.border)).toBeLessThan(
      relativeLuminance(lo.border)
    )
    expect(contrastRatio(hi['muted-foreground'], '#ffffff')).toBeGreaterThan(
      contrastRatio(lo['muted-foreground'], '#ffffff')
    )
  })
  it('picks a legible primary-foreground for a saturated accent', () => {
    const p = derivePalette(
      { background: '#fdf6e3', foreground: '#5c6a72', accent: '#8da101' },
      50
    )
    expect(
      contrastRatio(p.primary, p['primary-foreground'])
    ).toBeGreaterThanOrEqual(4.5)
  })
})

describe('resolveFontFamily', () => {
  it('expands generic families and quotes a custom one', () => {
    expect(resolveFontFamily({ family: 'serif', weight: 'light' })).toMatch(
      /^ui-serif/
    )
    expect(
      resolveFontFamily({
        family: 'custom',
        customFamily: 'Inter',
        weight: 'light'
      })
    ).toMatch(/^"Inter", ui-sans-serif/)
  })
  it('falls back to system when custom has no name, and follows the UI font for content', () => {
    expect(resolveFontFamily({ family: 'custom', weight: 'light' })).toMatch(
      /^ui-sans-serif/
    )
    expect(
      resolveFontFamily(
        { family: 'ui', weight: 'light' },
        { family: 'mono', weight: 'light' }
      )
    ).toMatch(/^ui-monospace/)
  })
})

describe('resolveAppearance', () => {
  it('resolves null to the default look', () => {
    const r = resolveAppearance(null)
    expect(r.light.background).toBe('#ffffff')
    expect(r.dark.background).toBe('#0a0a0a')
    expect(r.fonts.ui.weight).toBe(300)
    expect(r.fonts.content.weight).toBe(300)
    expect(r.translucentSidebar).toBe(true)
    expect(r.contrast).toBe(50)
  })
  it('tolerates garbage by falling back to defaults', () => {
    expect(resolveAppearance({ contrast: 'x', light: 5 }).contrast).toBe(50)
  })
  it('content weight follows the UI weight while family is ui', () => {
    const r = resolveAppearance({
      uiFont: { weight: 'medium' },
      contentFont: { family: 'ui', weight: 'light' }
    })
    expect(r.fonts.content.weight).toBe(500)
  })
})

describe('import / export', () => {
  it('round-trips', () => {
    const text = exportScheme(ACTOVIA_LIGHT, 'Actovia')
    const parsed = parseSchemeImport(text)
    expect(parsed).toEqual({ ok: true, colors: ACTOVIA_LIGHT, name: 'Actovia' })
  })
  it('normalises hex case and rejects incomplete or invalid documents', () => {
    expect(
      parseSchemeImport(
        '{"accent":"#1F6FEB","background":"#0D1117","foreground":"#E6EDF3"}'
      )
    ).toEqual({
      ok: true,
      colors: {
        accent: '#1f6feb',
        background: '#0d1117',
        foreground: '#e6edf3'
      },
      name: null
    })
    expect(parseSchemeImport('not json').ok).toBe(false)
    expect(parseSchemeImport('{"accent":"#1F6FEB"}').ok).toBe(false)
    expect(
      parseSchemeImport(
        '{"accent":"red","background":"#000000","foreground":"#ffffff"}'
      ).ok
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `packages/shared/src/utils/appearance.ts`**

```ts
import {
  DEFAULT_PRESET_ID,
  FONT_FAMILY_STACKS,
  FONT_WEIGHTS,
  findPreset,
  type SchemeColors,
  type SchemeSlot
} from '../constants/appearance'
import {
  AppearanceSchema,
  type Appearance,
  type AppearanceScheme,
  type ContentFontSetting,
  type FontSetting
} from '../schemas/settings-schema'
import {
  contrastingForeground,
  isHexColor,
  mix,
  normalizeHex,
  relativeLuminance
} from './color'

// ─── Scheme resolution ───────────────────────────────────────────────────────

export function resolveScheme(
  scheme: Partial<AppearanceScheme> | null | undefined,
  slot: SchemeSlot
): SchemeColors {
  const base = findPreset(scheme?.preset ?? DEFAULT_PRESET_ID)[slot]
  return {
    accent: scheme?.accent ?? base.accent,
    background: scheme?.background ?? base.background,
    foreground: scheme?.foreground ?? base.foreground
  }
}

/** True when the preset dropdown should read "Custom" (accent is its own axis). */
export function isSchemeCustomized(
  scheme: Partial<AppearanceScheme> | null | undefined
): boolean {
  if (!scheme) return false
  return (
    scheme.preset === 'custom' ||
    scheme.background != null ||
    scheme.foreground != null
  )
}

// ─── Palette derivation ──────────────────────────────────────────────────────

export const PALETTE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring'
] as const
export type PaletteToken = (typeof PALETTE_TOKENS)[number]
export type Palette = Record<PaletteToken, string>

// Mix ratios background → foreground (OKLab). Tuned so the Actovia preset at
// contrast 50 (k = 1) lands on the pre-appearance globals.css oklch tokens.
// Dark surfaces need larger steps than light ones to read as elevation.
interface Ramp {
  card: number
  surface: number // secondary / muted / accent / sidebar-accent
  border: number
  input: number
  mutedForeground: number
  ring: number
  sidebar: number
  chart: [number, number, number, number, number]
  destructive: string
}

const LIGHT_RAMP: Ramp = {
  card: 0,
  surface: 0.035,
  border: 0.091,
  input: 0.091,
  mutedForeground: 0.52,
  ring: 0.34,
  sidebar: 0.0175,
  chart: [0.152, 0.519, 0.656, 0.736, 0.855],
  destructive: '#e7000b'
}

const DARK_RAMP: Ramp = {
  card: 0.071,
  surface: 0.148,
  border: 0.12,
  input: 0.16,
  mutedForeground: 0.67,
  ring: 0.49,
  sidebar: 0.071,
  chart: [0.863, 0.489, 0.35, 0.269, 0.148],
  destructive: '#ff6467'
}

const DARK_LUMINANCE_THRESHOLD = 0.4

/** 0..100 → multiplier 0.5..1.5 applied to every surface/border ratio. */
function contrastFactor(contrast: number): number {
  const c = Number.isFinite(contrast)
    ? Math.min(100, Math.max(0, contrast))
    : 50
  return 0.5 + c / 100
}

export function derivePalette(colors: SchemeColors, contrast: number): Palette {
  const { background: bg, foreground: fg, accent } = colors
  const ramp =
    relativeLuminance(bg) < DARK_LUMINANCE_THRESHOLD ? DARK_RAMP : LIGHT_RAMP
  const k = contrastFactor(contrast)
  const step = (t: number) => mix(bg, fg, t * k)
  const card = step(ramp.card)
  const surface = step(ramp.surface)
  const border = step(ramp.border)
  const ring = mix(bg, fg, ramp.ring)
  const primaryForeground = contrastingForeground(accent, [bg, fg])
  return {
    background: bg,
    foreground: fg,
    card,
    'card-foreground': fg,
    popover: card,
    'popover-foreground': fg,
    primary: accent,
    'primary-foreground': primaryForeground,
    secondary: surface,
    'secondary-foreground': fg,
    muted: surface,
    'muted-foreground': step(ramp.mutedForeground),
    accent: surface,
    'accent-foreground': fg,
    destructive: ramp.destructive,
    border,
    input: step(ramp.input),
    ring,
    'chart-1': mix(bg, fg, ramp.chart[0]),
    'chart-2': mix(bg, fg, ramp.chart[1]),
    'chart-3': mix(bg, fg, ramp.chart[2]),
    'chart-4': mix(bg, fg, ramp.chart[3]),
    'chart-5': mix(bg, fg, ramp.chart[4]),
    sidebar: step(ramp.sidebar),
    'sidebar-foreground': fg,
    'sidebar-primary': accent,
    'sidebar-primary-foreground': primaryForeground,
    'sidebar-accent': surface,
    'sidebar-accent-foreground': fg,
    'sidebar-border': border,
    'sidebar-ring': ring
  }
}

// ─── Fonts ───────────────────────────────────────────────────────────────────

export function resolveFontFamily(
  setting: FontSetting | ContentFontSetting,
  ui?: FontSetting
): string {
  if (setting.family === 'ui') {
    return ui ? resolveFontFamily(ui) : FONT_FAMILY_STACKS.system
  }
  if (setting.family === 'custom') {
    const name = setting.customFamily?.trim().replace(/["\\]/g, '')
    return name
      ? `"${name}", ${FONT_FAMILY_STACKS.system}`
      : FONT_FAMILY_STACKS.system
  }
  return FONT_FAMILY_STACKS[setting.family]
}

// ─── Whole-appearance resolution ─────────────────────────────────────────────

export interface ResolvedFont {
  family: string
  weight: number
}

export interface ResolvedAppearance {
  light: Palette
  dark: Palette
  fonts: { ui: ResolvedFont; content: ResolvedFont }
  translucentSidebar: boolean
  contrast: number
}

/** Parse a stored/cached value leniently: anything invalid becomes the default. */
export function normalizeAppearance(raw: unknown): Appearance {
  const direct = AppearanceSchema.safeParse(raw ?? {})
  if (direct.success) return direct.data
  // Salvage per-field: keep every section that parses on its own.
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const salvaged: Record<string, unknown> = {}
  for (const key of Object.keys(AppearanceSchema.shape)) {
    const single = AppearanceSchema.safeParse({ [key]: obj[key] })
    if (single.success) salvaged[key] = obj[key]
  }
  return AppearanceSchema.parse(salvaged)
}

export function resolveAppearance(raw: unknown): ResolvedAppearance {
  const a = normalizeAppearance(raw)
  const uiWeight = FONT_WEIGHTS[a.uiFont.weight]
  return {
    light: derivePalette(resolveScheme(a.light, 'light'), a.contrast),
    dark: derivePalette(resolveScheme(a.dark, 'dark'), a.contrast),
    fonts: {
      ui: { family: resolveFontFamily(a.uiFont), weight: uiWeight },
      content: {
        family: resolveFontFamily(a.contentFont, a.uiFont),
        weight:
          a.contentFont.family === 'ui'
            ? uiWeight
            : FONT_WEIGHTS[a.contentFont.weight]
      }
    },
    translucentSidebar: a.translucentSidebar,
    contrast: a.contrast
  }
}

// ─── Import / export ─────────────────────────────────────────────────────────

export function exportScheme(colors: SchemeColors, name: string): string {
  return JSON.stringify(
    {
      name,
      accent: colors.accent,
      background: colors.background,
      foreground: colors.foreground
    },
    null,
    2
  )
}

export type SchemeImportResult =
  | { ok: true; colors: SchemeColors; name: string | null }
  | { ok: false }

export function parseSchemeImport(text: string): SchemeImportResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false }
  }
  if (!doc || typeof doc !== 'object') return { ok: false }
  const o = doc as Record<string, unknown>
  const pick = (k: string) =>
    typeof o[k] === 'string' && isHexColor(normalizeHex(o[k] as string) ?? '')
      ? normalizeHex(o[k] as string)!
      : null
  const accent = pick('accent'),
    background = pick('background'),
    foreground = pick('foreground')
  if (!accent || !background || !foreground) return { ok: false }
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null
  return { ok: true, colors: { accent, background, foreground }, name }
}
```

- [ ] **Step 4: Run → PASS** (adjust a ramp only if a token is off by one hex step; the ramps above were derived from the oklch tokens). Commit: `git commit -m "feat(appearance): palette derivation, resolution and theme import/export"`.

---

### Task 4: DB column + migration

**Files:**

- Modify: `src/main/lib/db/schema.ts` (settings table, after `keyboardShortcuts`)
- Create: `resources/drizzle/0003_<generated>.sql` + meta (via `bun run db:generate`)

- [ ] **Step 1:** Add to the `settings` table:

```ts
  appearance: jsonb('appearance').$type<z.infer<typeof AppearanceSchema>>(),
```

and import `AppearanceSchema` alongside the other schema imports at the top of `schema.ts`.

- [ ] **Step 2:** `bun run db:generate` → expect a new `resources/drizzle/0003_*.sql` containing exactly `ALTER TABLE "settings" ADD COLUMN "appearance" jsonb;` and a new journal entry. Inspect the SQL; if drizzle-kit emits anything else, stop and reconcile the schema first.
- [ ] **Step 3:** `bun run typecheck:node` → PASS. Commit: `git add src/main/lib/db/schema.ts resources/drizzle && git commit -m "feat(appearance): settings.appearance jsonb column"`.

---

### Task 5: Renderer theme engine (CSS builder, cache, boot) + globals.css + IPC + provider

**Files:**

- Create: `src/renderer/lib/appearance.ts`
- Create: `src/renderer/components/appearance-provider.tsx`
- Modify: `src/renderer/assets/stylesheets/globals.css`
- Modify: `src/renderer/lib/ipc.ts` (add `setWindowTranslucency`)
- Modify: `src/main/lib/ipc.ts` (add `set-window-translucency`)
- Modify: `src/renderer/main.tsx`, `src/renderer/sub-apps/{searchbar,quick-chat,artifacts}/main.tsx`
- Test: `tests/unit/renderer/lib/appearance.test.ts`

**Interfaces:**

- Produces: `APPEARANCE_STYLE_ID = 'actovia-appearance'`, `buildAppearanceCss(resolved: ResolvedAppearance): string`, `applyAppearance(resolved): void`, `readAppearanceCache(): unknown`, `writeAppearanceCache(raw: unknown): void`, `bootAppearance(): void`, `subscribeAppearanceCache(cb: () => void): () => void`, `isMacRenderer(): boolean`; IPC `setWindowTranslucency(enabled: boolean, backgroundColor: string): Promise<void>`.

- [ ] **Step 1: Failing test** (`tests/unit/renderer/lib/appearance.test.ts`)

```ts
import { resolveAppearance } from '@actovia/shared/utils/appearance'
import { describe, expect, it } from 'vitest'

import { buildAppearanceCss } from '@/lib/appearance'

describe('buildAppearanceCss', () => {
  const css = buildAppearanceCss(
    resolveAppearance({
      dark: { preset: 'github' },
      uiFont: { family: 'mono', weight: 'medium' },
      contentFont: {
        family: 'custom',
        customFamily: 'Inter',
        weight: 'regular'
      }
    })
  )

  it('emits a :root block with the light tokens and a .dark block with the dark ones', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--background:\s*#ffffff/)
    expect(css).toMatch(/\.dark\s*\{[^}]*--background:\s*#0d1117/)
    expect(css).toMatch(/\.dark\s*\{[^}]*--primary:\s*#1f6feb/)
  })

  it('emits the font variables', () => {
    expect(css).toContain('--font-ui: ui-monospace')
    expect(css).toContain('--font-weight-base: 500')
    expect(css).toContain('--font-content: "Inter"')
    expect(css).toContain('--font-weight-content: 400')
  })

  it('covers every palette token in both blocks', () => {
    for (const token of ['sidebar-ring', 'chart-5', 'destructive']) {
      expect(css.split(`--${token}:`).length).toBe(3)
    }
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/renderer/lib/appearance.ts`**

```ts
import { APPEARANCE_CACHE_KEY } from '@actovia/shared/constants/appearance'
import {
  PALETTE_TOKENS,
  resolveAppearance,
  type Palette,
  type ResolvedAppearance
} from '@actovia/shared/utils/appearance'

export const APPEARANCE_STYLE_ID = 'actovia-appearance'

function block(selector: string, palette: Palette): string {
  const lines = PALETTE_TOKENS.map((t) => `  --${t}: ${palette[t]};`)
  return `${selector} {\n${lines.join('\n')}\n}`
}

/**
 * The stylesheet that overrides globals.css's token defaults. Pure: the same
 * `ResolvedAppearance` always yields the same text (so a no-op re-apply is
 * cheap to detect).
 */
export function buildAppearanceCss(resolved: ResolvedAppearance): string {
  const fonts = [
    ':root {',
    `  --font-ui: ${resolved.fonts.ui.family};`,
    `  --font-weight-base: ${resolved.fonts.ui.weight};`,
    `  --font-content: ${resolved.fonts.content.family};`,
    `  --font-weight-content: ${resolved.fonts.content.weight};`,
    '}'
  ].join('\n')
  return [
    block(':root', resolved.light),
    block('.dark', resolved.dark),
    fonts
  ].join('\n\n')
}

export function isMacRenderer(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.electron?.process?.platform === 'darwin'
  )
}

/** Upsert the `<style id=actovia-appearance>` at the END of <head> and set the html data attributes. */
export function applyAppearance(resolved: ResolvedAppearance): void {
  if (typeof document === 'undefined') return
  const css = buildAppearanceCss(resolved)
  let el = document.getElementById(
    APPEARANCE_STYLE_ID
  ) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = APPEARANCE_STYLE_ID
    document.head.append(el)
  } else if (el !== document.head.lastElementChild) {
    document.head.append(el) // keep it after any stylesheet Vite injects later
  }
  if (el.textContent !== css) el.textContent = css
  // Only macOS has vibrancy; elsewhere the sidebar is always painted opaque.
  document.documentElement.dataset.translucentSidebar = String(
    resolved.translucentSidebar && isMacRenderer()
  )
}

export function readAppearanceCache(): unknown {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeAppearanceCache(raw: unknown): void {
  try {
    if (raw == null) window.localStorage.removeItem(APPEARANCE_CACHE_KEY)
    else window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(raw))
  } catch {
    // Private mode / blocked storage: the provider will still apply live.
  }
}

/** Synchronous first paint: cache → resolve → apply. Call before createRoot. */
export function bootAppearance(): void {
  applyAppearance(resolveAppearance(readAppearanceCache()))
}

/** Sub-apps: follow changes the main window writes (same-origin `storage` event). */
export function subscribeAppearanceCache(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === APPEARANCE_CACHE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
```

- [ ] **Step 4: Run the test → PASS.**

- [ ] **Step 5: globals.css** — in `@layer base`, replace `@apply border-border outline-ring/50 font-light;` with:

```css
* {
  @apply border-border outline-ring/50;
  font-weight: var(--font-weight-base, 300);
}
html {
  font-family: var(
    --font-ui,
    ui-sans-serif,
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    'Noto Sans',
    sans-serif
  );
}
```

In `.markdown { … }` add `font-family: var(--font-content, inherit); --font-weight-base: var(--font-weight-content, 300);`.

After the Philharmonic hue block (unlayered), add:

```css
/* ── Opaque sidebar when translucency is off (or unsupported) ─────────────
 * The chat/Philharmonic sidebar is `bg-transparent` so macOS vibrancy shows
 * through. Unlayered so it beats that utility. */
html[data-translucent-sidebar='false'] [data-slot='sidebar'] {
  background-color: var(--sidebar);
}

/* Native colour input drawn as a round swatch (Settings → Appearance). */
.color-swatch-input {
  appearance: none;
  -webkit-appearance: none;
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  cursor: pointer;
}
.color-swatch-input::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color-swatch-input::-webkit-color-swatch {
  border: 1px solid rgb(0 0 0 / 0.25);
  border-radius: 9999px;
}
.color-swatch-input:disabled {
  cursor: default;
}
```

- [ ] **Step 6: IPC.** `src/renderer/lib/ipc.ts`:

```ts
export function setWindowTranslucency(
  enabled: boolean,
  backgroundColor: string
) {
  return window.electron.ipcRenderer.invoke('set-window-translucency', {
    enabled,
    backgroundColor
  })
}
```

`src/main/lib/ipc.ts`, next to `set-native-theme`:

```ts
// Settings → Appearance → Translucent sidebar. The window boots with
// `vibrancy: 'sidebar'` (window.ts); this flips it at runtime. Off = an
// opaque window painted in the theme's background so nothing white leaks
// behind the transparent <body>. Non-mac has no vibrancy: only the colour.
safeHandle('set-window-translucency', (_, arg: unknown) => {
  const { enabled, backgroundColor } = arg as {
    enabled: boolean
    backgroundColor: string
  }
  const win = getMainWindow()
  if (!win) return
  const color = /^#[0-9a-f]{6}$/i.test(backgroundColor)
    ? backgroundColor
    : '#ffffff'
  if (process.platform === 'darwin') {
    if (enabled) {
      win.setBackgroundColor('#00000000')
      win.setVibrancy('sidebar')
    } else {
      win.setVibrancy(null)
      win.setBackgroundColor(color)
    }
    return
  }
  win.setBackgroundColor(color)
})
```

- [ ] **Step 7: `src/renderer/components/appearance-provider.tsx`**

```tsx
import { resolveAppearance } from '@actovia/shared/utils/appearance'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'

import { useSettings } from '@/hooks/use-settings'
import { applyAppearance, writeAppearanceCache } from '@/lib/appearance'
import { setWindowTranslucency } from '@/lib/ipc'

/**
 * Follows `settings.appearance` and keeps the injected token stylesheet, the
 * boot cache and the window's vibrancy in sync. Side-effect only — mirrors
 * `LocaleBridge` / `NativeThemeBridge`. `bootAppearance()` already applied
 * the cached value before React mounted, so this only ever changes something
 * when the setting itself changed.
 */
export function AppearanceProvider() {
  const { data: settings } = useSettings()
  const { resolvedTheme } = useTheme()
  const raw = settings?.appearance
  const loaded = settings !== undefined

  useEffect(() => {
    if (!loaded) return
    const resolved = resolveAppearance(raw ?? null)
    applyAppearance(resolved)
    writeAppearanceCache(raw ?? null)
    if (typeof window === 'undefined' || !window.electron) return
    const palette = resolvedTheme === 'dark' ? resolved.dark : resolved.light
    setWindowTranslucency(
      resolved.translucentSidebar,
      palette.background
    ).catch((err) => {
      console.error('[appearance] failed to update window translucency', err)
    })
  }, [raw, loaded, resolvedTheme])

  return null
}
```

- [ ] **Step 8: Wire the entries.** `src/renderer/main.tsx`: import `bootAppearance` from `@/lib/appearance` and `AppearanceProvider`; call `bootAppearance()` right after the CSS import (module top level, before `i18nReady`), and render `<AppearanceProvider />` inside `<ThemeProvider>` before `<I18nProvider>`. `searchbar/main.tsx` and `quick-chat/main.tsx`: call `bootAppearance()` at top level and `subscribeAppearanceCache(bootAppearance)` (no provider — they don't fetch settings). `artifacts/main.tsx`: same two calls after `applyTheme()`.

- [ ] **Step 9:** `bun run typecheck && bun run lint` → PASS. Commit: `git commit -m "feat(appearance): renderer theme engine, boot cache, window translucency IPC"`.

---

### Task 6: Appearance settings page — navigation, mode switcher, nav copy

**Files:**

- Modify: `src/renderer/components/settings/settings-menu.ts` (enum, `NAV_TITLE_KEYS`, `menus` Personal group after General)
- Modify: `src/renderer/hooks/use-settings-tab.ts` (`[SettingsLabel.Appearance]: 'appearance'`)
- Modify: `src/renderer/components/settings/settings-form.tsx` (route `Appearance`)
- Create: `src/renderer/components/settings/settings-form/appearance/theme-mode-switcher.tsx` (moved `AppearanceSwitcher` + `APPEARANCE_MODES` from `generals.tsx`, exported as `ThemeModeSwitcher`)
- Create: `src/renderer/components/settings/settings-form/appearance.tsx` (first version: only the Mode row)
- Modify: `src/renderer/components/settings/settings-form/generals.tsx` (remove the Theme row, the switcher, unused imports)
- Modify: `packages/shared/src/i18n/locales/*/settings.json` (`nav.appearance.title`)
- Modify: `tests/e2e/settings-e2e.spec.ts` (theme-mode test opens the Appearance section: `await openSettings(mainWindow, 'Appearance')`)
- Test: `tests/unit/i18n/settings-namespace.test.ts` (add `expect(settings.nav.appearance.title).toBe('Appearance')` to the nav test)

- [ ] **Step 1:** Add the nav-title assertion to the unit test; run → FAIL.
- [ ] **Step 2:** Enum member `Appearance = 'Appearance'`, `NAV_TITLE_KEYS` entry `'nav.appearance.title'`, menu item `{ title: SettingsLabel.Appearance, icon: PaletteIcon }` (lucide `PaletteIcon`) right after General; slug `appearance`.
- [ ] **Step 3:** `theme-mode-switcher.tsx` = the existing `APPEARANCE_MODES` + `AppearanceSwitcher` body verbatim, exported as `ThemeModeSwitcher`. `appearance.tsx`:

```tsx
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { useTranslation } from 'react-i18next'

import { SettingsRow, SettingsSection } from '../settings-row'
import { ThemeModeSwitcher } from './appearance/theme-mode-switcher'

export function Appearance({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  void form
  return (
    <SettingsSection>
      <SettingsRow
        label={t('general.theme.label')}
        description={t('general.theme.description')}
      >
        <ThemeModeSwitcher />
      </SettingsRow>
    </SettingsSection>
  )
}
```

Route it in `settings-form.tsx` (`{activeTitle === SettingsLabel.Appearance && <Appearance form={form} />}`). Remove the Theme row + switcher + `Moon/Sun/SunMoon`, `useTheme`, `Theme`, `ParseKeys` imports from `generals.tsx`.

- [ ] **Step 4:** `nav.appearance.title` in en + nine locales: en `Appearance`, zh-Hant-TW `外觀`, zh-Hant-HK `外觀`, ja `外観`, ko `모양`, fr `Apparence`, de `Erscheinungsbild`, es `Apariencia`, pt-BR `Aparência`, it `Aspetto`.
- [ ] **Step 5:** Update `tests/e2e/settings-e2e.spec.ts` theme-mode test to `openSettings(mainWindow, 'Appearance')`.
- [ ] **Step 6:** `bun run test tests/unit/i18n tests/unit/renderer/hooks && bun run typecheck && bun run i18n:check` → PASS. Commit: `git commit -m "feat(appearance): Appearance settings tab with the theme mode switcher"`.

---

### Task 7: Scheme cards (presets, colours, accent, import/copy)

**Files:**

- Create: `src/renderer/components/settings/settings-form/appearance/use-appearance-form.ts`
- Create: `src/renderer/components/settings/settings-form/appearance/scheme-swatch.tsx`
- Create: `src/renderer/components/settings/settings-form/appearance/color-field.tsx`
- Create: `src/renderer/components/settings/settings-form/appearance/preset-select.tsx`
- Create: `src/renderer/components/settings/settings-form/appearance/theme-import-dialog.tsx`
- Create: `src/renderer/components/settings/settings-form/appearance/scheme-card.tsx`
- Modify: `src/renderer/components/settings/settings-form/appearance.tsx`
- Modify: `packages/shared/src/constants/test-ids.ts` (`appearance` group)
- Modify: `packages/shared/src/i18n/locales/en/settings.json` (`appearance.*`)

**Interfaces:**

- `useAppearanceForm(form) → { appearance: Appearance; update(patch: Partial<Appearance>): void }`
- `<SchemeSwatch colors={SchemeColors} size?='sm'|'md' />`
- `<ColorField value={hex} onChange={(hex) => void} disabled? testId? ariaLabel />`
- `<PresetSelect slot value={presetId | 'custom'} onChange={(id) => void} />`
- `<ThemeImportDialog open onOpenChange onImport={(colors: SchemeColors) => void} />`
- `<SchemeCard slot scheme={AppearanceScheme} onChange={(next: AppearanceScheme) => void} />`

- [ ] **Step 1: Test ids** in `test-ids.ts`:

```ts
  appearance: {
    presetSelect: 'appearance.preset-select',
    accentSelect: 'appearance.accent-select',
    colorInput: 'appearance.color-input',
    copyTheme: 'appearance.copy-theme',
    importTheme: 'appearance.import-theme',
    importTextarea: 'appearance.import-textarea',
    importConfirm: 'appearance.import-confirm',
    uiFontSelect: 'appearance.ui-font-select',
    uiFontWeight: 'appearance.ui-font-weight',
    customFontInput: 'appearance.custom-font-input',
    contentFontSelect: 'appearance.content-font-select',
    contentFontWeight: 'appearance.content-font-weight',
    translucentSidebar: 'appearance.translucent-sidebar',
    contrastSlider: 'appearance.contrast-slider'
  },
```

(`presetSelect`, `accentSelect`, `colorInput` are applied with a `-${slot}` / `-${slot}-${field}` suffix, like `settings.themeMode`.)

- [ ] **Step 2: English copy** (`en/settings.json`, new top-level `appearance` object):

```json
"appearance": {
  "scheme": {
    "light": "Light theme",
    "dark": "Dark theme",
    "import": "Import",
    "copy": "Copy theme",
    "custom": "Custom",
    "presetDefault": "Preset default",
    "presetLabel": "Theme preset",
    "previewLabel": "Theme preview",
    "accent": "Accent",
    "background": "Background",
    "foreground": "Foreground",
    "pickColor": "Pick a colour",
    "lowContrast": "Low contrast ({{ratio}}:1) — text may be hard to read",
    "accents": {
      "blue": "Blue",
      "purple": "Purple",
      "pink": "Pink",
      "red": "Red",
      "orange": "Orange",
      "yellow": "Yellow",
      "green": "Green",
      "graphite": "Graphite"
    }
  },
  "importDialog": {
    "title": "Import theme",
    "description": "Paste a theme copied from Actovia — a JSON object with accent, background and foreground colours.",
    "placeholder": "{ \"accent\": \"#1f6feb\", \"background\": \"#0d1117\", \"foreground\": \"#e6edf3\" }",
    "invalid": "That doesn't look like an Actovia theme.",
    "confirm": "Import",
    "cancel": "Cancel"
  },
  "fonts": {
    "title": "Fonts",
    "ui": { "label": "UI font", "description": "The typeface used across the interface." },
    "content": { "label": "Content font", "description": "The typeface used for chat messages." },
    "customFamily": {
      "label": "Font family",
      "description": "The name of a font installed on this computer.",
      "placeholder": "e.g. Inter"
    },
    "families": {
      "ui": "Same as UI font",
      "system": "System default",
      "serif": "Serif",
      "mono": "Monospace",
      "rounded": "Rounded",
      "custom": "Custom…"
    },
    "weights": { "light": "Light", "regular": "Regular", "medium": "Medium" }
  },
  "window": {
    "title": "Window",
    "translucentSidebar": {
      "label": "Translucent sidebar",
      "description": "Let the desktop show through the sidebar."
    },
    "contrast": {
      "label": "Contrast",
      "description": "How strongly surfaces, borders and secondary text stand out from the background."
    }
  },
  "toast": {
    "copied": "Theme copied to the clipboard",
    "copyFailed": "Couldn't copy the theme",
    "imported": "Theme imported"
  }
}
```

- [ ] **Step 3: `use-appearance-form.ts`**

```ts
import {
  AppearanceSchema,
  type Appearance,
  type UseFormReturnType
} from '@actovia/shared/schemas/settings-schema'
import { normalizeAppearance } from '@actovia/shared/utils/appearance'
import { useCallback, useMemo } from 'react'

/**
 * The Appearance page's view of `settings.appearance`: always a complete,
 * normalised object (null / partial rows from older installs are filled with
 * defaults), and one `update()` that writes the WHOLE object back so a preset
 * pick — four fields — is one autosave.
 */
export function useAppearanceForm(form: UseFormReturnType) {
  const raw = form.watch('appearance')
  const appearance = useMemo(() => normalizeAppearance(raw), [raw])
  const update = useCallback(
    (patch: Partial<Appearance>) => {
      form.setValue(
        'appearance',
        AppearanceSchema.parse({ ...appearance, ...patch }),
        { shouldDirty: true }
      )
    },
    [form, appearance]
  )
  return { appearance, update }
}
```

- [ ] **Step 4: `scheme-swatch.tsx`** — the "Aa" tile.

```tsx
import type { SchemeColors } from '@actovia/shared/constants/appearance'

import { cn } from '@/lib/utils'

export function SchemeSwatch({
  colors,
  size = 'md',
  className
}: {
  colors: SchemeColors
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold ring-1 ring-black/10 select-none',
        size === 'sm' ? 'size-6 text-[11px]' : 'size-8 text-sm',
        className
      )}
      style={{ backgroundColor: colors.background, color: colors.accent }}
    >
      Aa
    </span>
  )
}
```

- [ ] **Step 5: `color-field.tsx`**

```tsx
import {
  contrastingForeground,
  normalizeHex
} from '@actovia/shared/utils/color'
import { useEffect, useState } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

/**
 * A colour chip filled with the colour itself: a native colour picker drawn as
 * a round swatch on the left and the hex on the right. Typing only commits
 * once the text parses as a hex colour; blur restores the last committed value.
 */
export function ColorField({
  value,
  onChange,
  disabled,
  testId,
  ariaLabel
}: {
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
  testId?: string
  ariaLabel: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const fg = contrastingForeground(value, ['#ffffff', '#000000'])

  return (
    <InputGroup
      className={cn('w-36 border-transparent', disabled && 'opacity-70')}
      style={{ backgroundColor: value, color: fg }}
    >
      <InputGroupAddon align="inline-start">
        <input
          type="color"
          className="color-swatch-input"
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroupAddon>
      <InputGroupInput
        data-testid={testId}
        value={text}
        disabled={disabled}
        spellCheck={false}
        className="font-mono text-xs uppercase placeholder:opacity-60"
        style={{ color: fg }}
        onChange={(e) => {
          setText(e.target.value)
          const hex = normalizeHex(e.target.value)
          if (hex && hex !== value) onChange(hex)
        }}
        onBlur={() => setText(value)}
      />
    </InputGroup>
  )
}
```

- [ ] **Step 6: `preset-select.tsx`**

```tsx
import {
  CUSTOM_PRESET_ID,
  THEME_PRESETS,
  type SchemeSlot
} from '@actovia/shared/constants/appearance'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

import { SchemeSwatch } from './scheme-swatch'

export function PresetSelect({
  slot,
  value,
  onChange
}: {
  slot: SchemeSlot
  /** A preset id, or CUSTOM_PRESET_ID when the scheme is customised. */
  value: string
  onChange: (presetId: string) => void
}) {
  const { t } = useTranslation('settings')
  const label = (id: string) =>
    id === CUSTOM_PRESET_ID
      ? t('appearance.scheme.custom')
      : (THEME_PRESETS.find((p) => p.id === id)?.name ?? id)

  return (
    <Select
      value={value}
      onValueChange={(v) => v && v !== CUSTOM_PRESET_ID && onChange(v)}
    >
      <SelectTrigger
        data-testid={`${TEST_IDS.appearance.presetSelect}-${slot}`}
        aria-label={t('appearance.scheme.presetLabel')}
        className="min-w-36"
      >
        <SelectValue>{(v: string) => label(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {value === CUSTOM_PRESET_ID && (
            <SelectItem value={CUSTOM_PRESET_ID} disabled>
              {t('appearance.scheme.custom')}
            </SelectItem>
          )}
          {THEME_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <SchemeSwatch colors={p[slot]} size="sm" />
              {p.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 7: `theme-import-dialog.tsx`**

```tsx
import type { SchemeColors } from '@actovia/shared/constants/appearance'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { parseSchemeImport } from '@actovia/shared/utils/appearance'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export function ThemeImportDialog({
  open,
  onOpenChange,
  onImport
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (colors: SchemeColors) => void
}) {
  const { t } = useTranslation('settings')
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = () => {
    const result = parseSchemeImport(text)
    if (!result.ok) {
      setInvalid(true)
      return
    }
    onImport(result.colors)
    setText('')
    setInvalid(false)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setInvalid(false)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('appearance.importDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('appearance.importDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          data-testid={TEST_IDS.appearance.importTextarea}
          value={text}
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={t('appearance.importDialog.placeholder')}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setText(e.target.value)
            setInvalid(false)
          }}
        />
        {invalid && (
          <p className="text-destructive text-xs">
            {t('appearance.importDialog.invalid')}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('appearance.importDialog.cancel')}
          </Button>
          <Button
            data-testid={TEST_IDS.appearance.importConfirm}
            onClick={submit}
            disabled={!text.trim()}
          >
            {t('appearance.importDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 8: `scheme-card.tsx`**

```tsx
import {
  CUSTOM_PRESET_ID,
  NAMED_ACCENTS,
  findPreset,
  type SchemeColors,
  type SchemeSlot
} from '@actovia/shared/constants/appearance'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { AppearanceScheme } from '@actovia/shared/schemas/settings-schema'
import {
  exportScheme,
  isSchemeCustomized,
  resolveScheme
} from '@actovia/shared/utils/appearance'
import { contrastRatio } from '@actovia/shared/utils/color'
import { ClipboardCopyIcon, DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { SettingsRow } from '../../settings-row'
import { SettingsSelect } from '../../settings-select'
import { ColorField } from './color-field'
import { PresetSelect } from './preset-select'
import { SchemeSwatch } from './scheme-swatch'
import { ThemeImportDialog } from './theme-import-dialog'

const ACCENT_PRESET = 'preset'
const ACCENT_CUSTOM = 'custom'
const AA = 4.5

export function SchemeCard({
  slot,
  scheme,
  onChange
}: {
  slot: SchemeSlot
  scheme: AppearanceScheme
  onChange: (next: AppearanceScheme) => void
}) {
  const { t } = useTranslation('settings')
  const [importOpen, setImportOpen] = useState(false)
  const resolved = resolveScheme(scheme, slot)
  const presetValue = isSchemeCustomized(scheme)
    ? CUSTOM_PRESET_ID
    : scheme.preset
  const accentValue =
    scheme.accent == null
      ? ACCENT_PRESET
      : (NAMED_ACCENTS.find((a) => a[slot] === scheme.accent)?.id ??
        ACCENT_CUSTOM)
  const ratio = contrastRatio(resolved.foreground, resolved.background)

  const accentOptions = [
    { value: ACCENT_PRESET, label: t('appearance.scheme.presetDefault') },
    ...NAMED_ACCENTS.map((a) => ({
      value: a.id,
      label: t(`appearance.scheme.accents.${a.id}`)
    })),
    { value: ACCENT_CUSTOM, label: t('appearance.scheme.custom') }
  ]

  const onAccentMode = (mode: string) => {
    if (mode === ACCENT_PRESET) return onChange({ ...scheme, accent: null })
    if (mode === ACCENT_CUSTOM)
      return onChange({ ...scheme, accent: resolved.accent })
    const named = NAMED_ACCENTS.find((a) => a.id === mode)
    if (named) onChange({ ...scheme, accent: named[slot] })
  }

  const copyTheme = async () => {
    const name =
      presetValue === CUSTOM_PRESET_ID
        ? t('appearance.scheme.custom')
        : findPreset(scheme.preset).name
    try {
      await navigator.clipboard.writeText(exportScheme(resolved, name))
      sileo.success({ title: t('appearance.toast.copied') })
    } catch {
      sileo.error({ title: t('appearance.toast.copyFailed') })
    }
  }

  const importTheme = (colors: SchemeColors) => {
    onChange({ preset: CUSTOM_PRESET_ID, ...colors })
    sileo.success({ title: t('appearance.toast.imported') })
  }

  const colorTestId = (field: keyof SchemeColors) =>
    `${TEST_IDS.appearance.colorInput}-${slot}-${field}`

  return (
    <Card className="divide-border gap-0 divide-y px-3 py-0 *:px-2.5 *:py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {t(`appearance.scheme.${slot}`)}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            data-testid={`${TEST_IDS.appearance.importTheme}-${slot}`}
            onClick={() => setImportOpen(true)}
          >
            <DownloadIcon data-icon="inline-start" />
            {t('appearance.scheme.import')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            data-testid={`${TEST_IDS.appearance.copyTheme}-${slot}`}
            onClick={() => void copyTheme()}
          >
            <ClipboardCopyIcon data-icon="inline-start" />
            {t('appearance.scheme.copy')}
          </Button>
          <SchemeSwatch colors={resolved} />
          <PresetSelect
            slot={slot}
            value={presetValue}
            onChange={(id) =>
              onChange({
                preset: id,
                accent: null,
                background: null,
                foreground: null
              })
            }
          />
        </div>
      </div>

      <SettingsRow label={t('appearance.scheme.accent')}>
        <div className="flex items-center gap-2">
          <SettingsSelect
            testId={`${TEST_IDS.appearance.accentSelect}-${slot}`}
            value={accentValue}
            onValueChange={onAccentMode}
            options={accentOptions}
          />
          <ColorField
            value={resolved.accent}
            disabled={accentValue !== ACCENT_CUSTOM}
            testId={colorTestId('accent')}
            ariaLabel={t('appearance.scheme.pickColor')}
            onChange={(hex) => onChange({ ...scheme, accent: hex })}
          />
        </div>
      </SettingsRow>

      <SettingsRow label={t('appearance.scheme.background')}>
        <ColorField
          value={resolved.background}
          testId={colorTestId('background')}
          ariaLabel={t('appearance.scheme.pickColor')}
          onChange={(hex) => onChange({ ...scheme, background: hex })}
        />
      </SettingsRow>

      <SettingsRow
        label={t('appearance.scheme.foreground')}
        warning={
          ratio < AA
            ? t('appearance.scheme.lowContrast', { ratio: ratio.toFixed(1) })
            : undefined
        }
      >
        <ColorField
          value={resolved.foreground}
          testId={colorTestId('foreground')}
          ariaLabel={t('appearance.scheme.pickColor')}
          onChange={(hex) => onChange({ ...scheme, foreground: hex })}
        />
      </SettingsRow>

      <ThemeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importTheme}
      />
    </Card>
  )
}
```

- [ ] **Step 9:** In `appearance.tsx`, after the Mode section, render both cards:

```tsx
const { appearance, update } = useAppearanceForm(form)
…
<SchemeCard slot="light" scheme={appearance.light} onChange={(light) => update({ light })} />
<SchemeCard slot="dark" scheme={appearance.dark} onChange={(dark) => update({ dark })} />
```

- [ ] **Step 10:** `bun run typecheck && bun run lint && bun run vitest run tests/unit/i18n` → the hardcoded-string guard passes (the only JSX text is `Aa`, under the 3-letter prose threshold); the linkage test still fails for the ids not yet applied/referenced (finished in Tasks 8–9). Commit: `git commit -m "feat(appearance): light/dark scheme cards with presets, colours, import and copy"`.

---

### Task 8: Fonts + window sections

**Files:**

- Modify: `src/renderer/components/settings/settings-form/appearance.tsx`

- [ ] **Step 1:** Append two sections:

```tsx
const isMac = isMacRenderer()   // from '@/lib/appearance'
const familyOptions = (withUi: boolean) =>
  [...(withUi ? ['ui'] : []), 'system', 'serif', 'mono', 'rounded', 'custom'].map((id) => ({
    value: id,
    label: t(`appearance.fonts.families.${id}` as ParseKeys<'settings'>)
  }))
const weightOptions = (['light', 'regular', 'medium'] as const).map((id) => ({
  value: id,
  label: t(`appearance.fonts.weights.${id}`)
}))

<SettingsSection title={t('appearance.fonts.title')}>
  <SettingsRow label={t('appearance.fonts.ui.label')} description={t('appearance.fonts.ui.description')}>
    <div className="flex items-center gap-2">
      <SettingsSelect testId={TEST_IDS.appearance.uiFontSelect} value={appearance.uiFont.family}
        onValueChange={(v) => update({ uiFont: { ...appearance.uiFont, family: v as FontFamilyId } })}
        options={familyOptions(false)} />
      <SettingsSelect testId={TEST_IDS.appearance.uiFontWeight} value={appearance.uiFont.weight}
        onValueChange={(v) => update({ uiFont: { ...appearance.uiFont, weight: v as FontWeightId } })}
        options={weightOptions} />
    </div>
  </SettingsRow>
  {appearance.uiFont.family === 'custom' && (
    <SettingsRow label={t('appearance.fonts.customFamily.label')} description={t('appearance.fonts.customFamily.description')}>
      <Input data-testid={TEST_IDS.appearance.customFontInput} className="w-48"
        value={appearance.uiFont.customFamily ?? ''} placeholder={t('appearance.fonts.customFamily.placeholder')}
        onChange={(e) => update({ uiFont: { ...appearance.uiFont, customFamily: e.target.value } })} />
    </SettingsRow>
  )}
  <SettingsRow label={t('appearance.fonts.content.label')} description={t('appearance.fonts.content.description')}>
    <div className="flex items-center gap-2">
      <SettingsSelect testId={TEST_IDS.appearance.contentFontSelect} value={appearance.contentFont.family}
        onValueChange={(v) => update({ contentFont: { ...appearance.contentFont, family: v as ContentFontSetting['family'] } })}
        options={familyOptions(true)} />
      <SettingsSelect testId={TEST_IDS.appearance.contentFontWeight}
        value={appearance.contentFont.family === 'ui' ? appearance.uiFont.weight : appearance.contentFont.weight}
        disabled={appearance.contentFont.family === 'ui'}
        onValueChange={(v) => update({ contentFont: { ...appearance.contentFont, weight: v as FontWeightId } })}
        options={weightOptions} />
    </div>
  </SettingsRow>
  {appearance.contentFont.family === 'custom' && ( /* same Input bound to contentFont.customFamily, testId `${TEST_IDS.appearance.customFontInput}-content` */ )}
</SettingsSection>

<SettingsSection title={t('appearance.window.title')}>
  {isMac && (
    <SettingsRow label={t('appearance.window.translucentSidebar.label')} description={t('appearance.window.translucentSidebar.description')}>
      <Switch data-testid={TEST_IDS.appearance.translucentSidebar} checked={appearance.translucentSidebar}
        onCheckedChange={(checked) => update({ translucentSidebar: checked })} />
    </SettingsRow>
  )}
  <SettingsRow label={t('appearance.window.contrast.label')} description={t('appearance.window.contrast.description')}>
    <div className="flex w-56 items-center gap-3">
      <Slider data-testid={TEST_IDS.appearance.contrastSlider} min={0} max={100} step={5}
        value={[appearance.contrast]}
        onValueChange={(v) => update({ contrast: Array.isArray(v) ? v[0] : v })} />
      <span className="text-muted-foreground w-8 text-right text-sm tabular-nums">{appearance.contrast}</span>
    </div>
  </SettingsRow>
</SettingsSection>
```

(The second custom-family `Input` for the content font is the same JSX with `contentFont`; its test id carries a `-content` suffix.)

- [ ] **Step 2:** `bun run typecheck && bun run lint` → PASS. Commit: `git commit -m "feat(appearance): font and window sections"`.

---

### Task 9: E2E spec, remaining locales, unit-test parity, CLAUDE.md

**Files:**

- Create: `tests/e2e/settings-appearance.spec.ts`
- Modify: nine non-English `settings.json` catalogs (`appearance.*` block translated)
- Modify: `tests/unit/i18n/settings-namespace.test.ts` (an `appearance` keys test)
- Modify: `CLAUDE.md` (Appearance section under Architecture; Code Structure entries for `src/renderer/lib/appearance.ts`, `src/renderer/components/appearance-provider.tsx`, `src/renderer/components/settings/settings-form/appearance/`, `packages/shared/src/utils/appearance.ts`, `packages/shared/src/utils/color.ts`, `packages/shared/src/constants/appearance.ts`; the `appearance` column in the settings-table list; `set-window-translucency` in the IPC line)

- [ ] **Step 1: E2E spec**

```ts
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

const cssVar = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  )

test.describe('Settings — Appearance', () => {
  test('a dark preset re-skins the tokens, persists, and survives a reload without the cache', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow, 'Appearance')
    await mainWindow.getByTestId(`${TEST_IDS.settings.themeMode}-dark`).click()
    await expect
      .poll(() => mainWindow.evaluate(() => document.documentElement.className))
      .toContain('dark')

    await mainWindow
      .getByTestId(`${TEST_IDS.appearance.presetSelect}-dark`)
      .click()
    await mainWindow.getByRole('option', { name: 'GitHub' }).click()
    await expect.poll(() => cssVar(mainWindow, '--background')).toBe('#0d1117')
    await expect(
      mainWindow.getByTestId(
        `${TEST_IDS.appearance.colorInput}-dark-background`
      )
    ).toHaveValue('#0d1117')

    // Saved to the backend (autosave), not just applied.
    await expect
      .poll(() =>
        mainWindow.evaluate(async () => {
          const r = await fetch('http://localhost:60223/api/v1/settings')
          const s = await r.json()
          return s?.appearance?.dark?.preset ?? null
        })
      )
      .toBe('github')

    await mainWindow.evaluate(() =>
      window.localStorage.removeItem('actovia-appearance')
    )
    await mainWindow.reload()
    await expect.poll(() => cssVar(mainWindow, '--background')).toBe('#0d1117')
  })

  test('typing a hex colour and choosing a named accent update the tokens', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow, 'Appearance')
    await mainWindow.getByTestId(`${TEST_IDS.settings.themeMode}-light`).click()
    const bg = mainWindow.getByTestId(
      `${TEST_IDS.appearance.colorInput}-light-background`
    )
    await bg.fill('#fdf6e3')
    await expect.poll(() => cssVar(mainWindow, '--background')).toBe('#fdf6e3')
    await expect(
      mainWindow.getByTestId(`${TEST_IDS.appearance.presetSelect}-light`)
    ).toContainText('Custom')

    await mainWindow
      .getByTestId(`${TEST_IDS.appearance.accentSelect}-light`)
      .click()
    await mainWindow.getByRole('option', { name: 'Blue' }).click()
    await expect.poll(() => cssVar(mainWindow, '--primary')).toBe('#007aff')
  })

  test('import applies a pasted theme; copy puts JSON on the clipboard', async ({
    mainWindow,
    electronApp
  }) => {
    await openSettings(mainWindow, 'Appearance')
    await mainWindow.getByTestId(`${TEST_IDS.settings.themeMode}-light`).click()
    await mainWindow
      .getByTestId(`${TEST_IDS.appearance.importTheme}-light`)
      .click()
    await mainWindow
      .getByTestId(TEST_IDS.appearance.importTextarea)
      .fill(
        '{"accent":"#268bd2","background":"#fdf6e3","foreground":"#586e75"}'
      )
    await mainWindow.getByTestId(TEST_IDS.appearance.importConfirm).click()
    await expect.poll(() => cssVar(mainWindow, '--foreground')).toBe('#586e75')

    await mainWindow
      .getByTestId(`${TEST_IDS.appearance.copyTheme}-light`)
      .click()
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('"foreground": "#586e75"')
  })

  test('fonts, contrast and (macOS) translucency controls apply live', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow, 'Appearance')
    await mainWindow.getByTestId(TEST_IDS.appearance.uiFontSelect).click()
    await mainWindow.getByRole('option', { name: 'Monospace' }).click()
    await expect
      .poll(() => cssVar(mainWindow, '--font-ui'))
      .toMatch(/^ui-monospace/)
    await mainWindow.getByTestId(TEST_IDS.appearance.uiFontWeight).click()
    await mainWindow.getByRole('option', { name: 'Medium' }).click()
    await expect
      .poll(() => cssVar(mainWindow, '--font-weight-base'))
      .toBe('500')
    // Content follows the UI font by default → its weight select is disabled.
    await expect(
      mainWindow.getByTestId(TEST_IDS.appearance.contentFontWeight)
    ).toBeDisabled()
    await mainWindow.getByTestId(TEST_IDS.appearance.contentFontSelect).click()
    await mainWindow.getByRole('option', { name: 'Custom…' }).click()
    await mainWindow
      .getByTestId(`${TEST_IDS.appearance.customFontInput}-content`)
      .fill('Inter')
    await expect
      .poll(() => cssVar(mainWindow, '--font-content'))
      .toMatch(/^"Inter"/)

    const borderBefore = await cssVar(mainWindow, '--border')
    const thumb = mainWindow
      .getByTestId(TEST_IDS.appearance.contrastSlider)
      .locator('[data-slot=slider-thumb]')
    await thumb.focus()
    await mainWindow.keyboard.press('ArrowRight')
    await expect(mainWindow.getByText('55', { exact: true })).toBeVisible()
    await expect
      .poll(() => cssVar(mainWindow, '--border'))
      .not.toBe(borderBefore)

    if (process.platform === 'darwin') {
      await mainWindow
        .getByTestId(TEST_IDS.appearance.translucentSidebar)
        .click()
      await expect
        .poll(() =>
          mainWindow.evaluate(
            () => document.documentElement.dataset.translucentSidebar
          )
        )
        .toBe('false')
    }
  })
})
```

The `${TEST_IDS.appearance.uiFontSelect}` / `contentFontSelect` / `…` accessors all appear in this file, satisfying the linkage test; `customFontInput` is referenced both bare (Task 8 applies it bare for the UI font) and suffixed.

- [ ] **Step 2: Unit parity test** — add to `settings-namespace.test.ts`:

```ts
it('has the Appearance page keys', () => {
  expect(settings.nav.appearance.title).toBe('Appearance')
  expect(settings.appearance.scheme.light).toBe('Light theme')
  expect(settings.appearance.scheme.dark).toBe('Dark theme')
  expect(settings.appearance.scheme.copy).toBe('Copy theme')
  expect(settings.appearance.fonts.families.ui).toBe('Same as UI font')
  expect(settings.appearance.window.contrast.label).toBe('Contrast')
  expect(settings.appearance.importDialog.invalid).toBe(
    "That doesn't look like an Actovia theme."
  )
})
```

- [ ] **Step 3: Nine locales** — add the full `appearance` block, translated, to each `settings.json`, keeping `{{ratio}}` in `lowContrast` and the JSON `placeholder` verbatim. `bun run i18n:check` → `OK`.
- [ ] **Step 4: CLAUDE.md** — add an `### Appearance` subsection under Architecture (data model, derivation, boot cache, IPC, sub-apps, spec link) and the Code Structure entries listed above.
- [ ] **Step 5: Full gate** — `bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test` → all green. If `localhost:60223` is free, `bun run test:e2e:electron -- tests/e2e/settings-appearance.spec.ts tests/e2e/settings-e2e.spec.ts`; otherwise record that e2e could not run locally.
- [ ] **Step 6: Commit** — `git commit -m "feat(appearance): e2e spec, ten-locale copy, CLAUDE.md"`.
