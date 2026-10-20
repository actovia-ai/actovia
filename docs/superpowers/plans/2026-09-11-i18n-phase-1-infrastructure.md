# i18n Phase 1 — Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the i18next-based i18n runtime for both processes — package, catalogs, providers, locale state — with **zero user-visible change**; every existing English literal still renders exactly as today.

**Architecture:** A shared `src/shared/i18n/` package exposes `createI18n(lng, {isRenderer})` (one i18next config, JSON catalogs lazy-loaded per locale via `i18next-resources-to-backend`). The renderer wraps every entry point in `<I18nProvider>` + a `<LocaleBridge>` side-effect (modelled on `theme-provider.tsx`). The main process builds its own instance in a new `src/main/lib/i18n.ts`, initialised right after `runMigrate()` and before window creation, and hands the resolved locale to the renderer synchronously through a preload value (`window.api.locale`, filled from a `sendSync` IPC). Locale is a new `settings.language` column (`"auto"` default, resolved from the OS in the main process).

**Tech Stack:** Electron 44, React 19, electron-vite (Vite for all 3 targets), Hono, Drizzle + PGlite, Jotai, SWR, Vitest (`environment: 'node'`), oxlint, oxfmt. New: `i18next`, `react-i18next`, `i18next-resources-to-backend`. Existing: `date-fns@4`.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- **Locale IDs (exactly these 11):** `en`, `zh-Hant-TW`, `zh-Hant-HK`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `ru`, `it`. `en` is the source of truth and the ultimate fallback. No RTL locales. **No Simplified Chinese** — bare `zh` / any `zh-Hans*` / `zh-CN` resolves to `en`.
- **Stored value** `settings.language`: one of the 11 IDs **or `"auto"`**. Default `"auto"`.
- **Fallback chain:** `zh-Hant-HK` → `zh-Hant-TW` → `en`; every other locale → `en`.
- **Namespaces (exactly these 13):** `common`, `chat`, `settings`, `philharmonic`, `discover`, `knowledgeBase`, `deepResearch`, `computerUse`, `lock`, `webSearch`, `audio`, `errors`, `menu`. Renderer loads all 13; main loads `['common', 'errors', 'menu']`.
- **Keys:** dot-nested, component-scoped. Interpolation `{{name}}` only (no positional). Plurals via CLDR suffix keys (`x_one` / `x_other` / …). Never interpolate a translated fragment into another string.
- **`defaultNS` is `'common'`.**
- **No user-visible change in this phase.** Non-English catalogs ship as `{}`. Existing literals are NOT migrated to `t()` here (that is Phase 2).
- **Pre-commit gate:** `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm test`, plus a new `pnpm i18n:check`. `--no-verify` only for the documented PGlite WASM teardown flake.
- **Follow existing patterns:** thin IPC wrappers in `src/renderer/lib/ipc.ts`; `safeHandle(...)` for main IPC handlers; provider + side-effect "bridge" component like `src/renderer/components/theme-provider.tsx`; loose zod siblings in `SettingsSchema`; idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `migrate.ts` alongside the generated migration.

### Refinements from the spec (with justification)

1. **Main process also uses `resourcesToBackend` lazy loading** (not `import.meta.glob` + a bundled `resources` object). One loader, no `import.meta.glob` typing friction under the main tsconfig's `nodenext` resolution, and main only needs 3 namespaces. `await createI18n(...).ready` still guarantees those are loaded before `setupMenu()`.
2. **Boot locale reaches the renderer via `window.api.locale`** (a plain string the preload fills from `ipcRenderer.sendSync('get-app-locale')`), not `webPreferences.additionalArguments`. One IPC handler vs. editing 3 window-creation sites, and it always returns the current value. The artifacts sub-app iframe has no preload — its `<I18nProvider>` boots at `'en'` in this phase (it has ~no chrome strings; a `?locale=` query param is a later phase's concern).
3. **`date-fns` locale objects are statically imported** in `format.ts` (11 objects, ~2–4 kB each). Lazy-loading 11 tiny objects is not worth the complexity; the bundle concern is the catalogs, which stay lazy.
4. **The hardcoded-string guard is not added in this phase.** Phase 1 delivers `pnpm i18n:audit` (prints the count of un-i18n'd strings, for tracking Phase 2 progress) — not a gate-blocking test. The blocking `tests/unit/i18n/no-hardcoded-strings.test.ts` lands in Phase 5.

---

### Task 1: Locale registry & resolver

**Files:**

- Create: `src/shared/i18n/locales.ts`
- Create: `src/shared/i18n/namespaces.ts`
- Test: `tests/unit/i18n/locales.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `LOCALE_IDS: readonly ['en','zh-Hant-TW','zh-Hant-HK','ja','ko','fr','de','es','pt-BR','ru','it']`
  - `type LocaleId = (typeof LOCALE_IDS)[number]`
  - `LOCALES: Record<LocaleId, { id: LocaleId; nativeName: string; englishName: string }>`
  - `isLocaleId(v: unknown): v is LocaleId`
  - `resolveLocale(prefs: string[]): LocaleId`
  - `FALLBACK_LNG: { 'zh-Hant-HK': ['zh-Hant-TW','en']; default: ['en'] }`
  - `DEFAULT_LANGUAGE_SETTING = 'auto'` and `type LanguageSetting = LocaleId | 'auto'`
  - `NAMESPACES: readonly ['common','chat','settings','philharmonic','discover','knowledgeBase','deepResearch','computerUse','lock','webSearch','audio','errors','menu']` and `type Namespace = (typeof NAMESPACES)[number]`
  - `MAIN_NAMESPACES: readonly ['common','errors','menu']`

- [ ] **Step 1: Write the failing test**

```ts
import { resolveLocale, isLocaleId, LOCALE_IDS } from '@shared/i18n/locales'
// tests/unit/i18n/locales.test.ts
import { describe, expect, it } from 'vitest'

describe('resolveLocale', () => {
  const cases: [string[], string][] = [
    [['en-US'], 'en'],
    [['en-GB'], 'en'],
    [['fr-CA', 'fr'], 'fr'],
    [['de-AT'], 'de'],
    [['ja-JP'], 'ja'],
    [['pt-PT'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['zh-Hant-HK'], 'zh-Hant-HK'],
    [['zh-HK'], 'zh-Hant-HK'],
    [['zh-Hant-TW'], 'zh-Hant-TW'],
    [['zh-TW'], 'zh-Hant-TW'],
    [['zh-Hant'], 'zh-Hant-TW'],
    [['zh-Hans-CN'], 'en'],
    [['zh-CN'], 'en'],
    [['zh'], 'en'],
    [['ZH-hant-hk'], 'zh-Hant-HK'],
    [['xx-YY', 'ko-KR'], 'ko'],
    [[], 'en'],
    [['klingon'], 'en']
  ]
  it.each(cases)('%j -> %s', (prefs, expected) => {
    expect(resolveLocale(prefs)).toBe(expected)
  })
})

describe('isLocaleId', () => {
  it('accepts every LOCALE_ID and rejects others', () => {
    for (const id of LOCALE_IDS) expect(isLocaleId(id)).toBe(true)
    expect(isLocaleId('auto')).toBe(false)
    expect(isLocaleId('zh')).toBe(false)
    expect(isLocaleId(42)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/i18n/locales.test.ts`
Expected: FAIL — `Cannot find module '@shared/i18n/locales'`.

- [ ] **Step 3: Write `namespaces.ts`**

```ts
// src/shared/i18n/namespaces.ts
export const NAMESPACES = [
  'common',
  'chat',
  'settings',
  'philharmonic',
  'discover',
  'knowledgeBase',
  'deepResearch',
  'computerUse',
  'lock',
  'webSearch',
  'audio',
  'errors',
  'menu'
] as const
export type Namespace = (typeof NAMESPACES)[number]

export const MAIN_NAMESPACES = ['common', 'errors', 'menu'] as const
```

- [ ] **Step 4: Write `locales.ts`**

```ts
// src/shared/i18n/locales.ts
export const LOCALE_IDS = [
  'en',
  'zh-Hant-TW',
  'zh-Hant-HK',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt-BR',
  'ru',
  'it'
] as const
export type LocaleId = (typeof LOCALE_IDS)[number]

export type LanguageSetting = LocaleId | 'auto'
export const DEFAULT_LANGUAGE_SETTING: LanguageSetting = 'auto'

export const LOCALES: Record<
  LocaleId,
  { id: LocaleId; nativeName: string; englishName: string }
> = {
  en: { id: 'en', nativeName: 'English', englishName: 'English' },
  'zh-Hant-TW': {
    id: 'zh-Hant-TW',
    nativeName: '繁體中文（台灣）',
    englishName: 'Chinese (Traditional, Taiwan)'
  },
  'zh-Hant-HK': {
    id: 'zh-Hant-HK',
    nativeName: '繁體中文（香港）',
    englishName: 'Chinese (Traditional, Hong Kong)'
  },
  ja: { id: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  ko: { id: 'ko', nativeName: '한국어', englishName: 'Korean' },
  fr: { id: 'fr', nativeName: 'Français', englishName: 'French' },
  de: { id: 'de', nativeName: 'Deutsch', englishName: 'German' },
  es: { id: 'es', nativeName: 'Español', englishName: 'Spanish' },
  'pt-BR': {
    id: 'pt-BR',
    nativeName: 'Português (Brasil)',
    englishName: 'Portuguese (Brazil)'
  },
  ru: { id: 'ru', nativeName: 'Русский', englishName: 'Russian' },
  it: { id: 'it', nativeName: 'Italiano', englishName: 'Italian' }
}

export const FALLBACK_LNG = {
  'zh-Hant-HK': ['zh-Hant-TW', 'en'],
  default: ['en']
} as const

export function isLocaleId(v: unknown): v is LocaleId {
  return typeof v === 'string' && (LOCALE_IDS as readonly string[]).includes(v)
}

/** Normalise BCP-47 casing: "zh-hant-hk" -> "zh-Hant-HK", "PT-br" -> "pt-BR". */
function canon(tag: string): string {
  const parts = tag.split(/[-_]/).filter(Boolean)
  if (parts.length === 0) return ''
  return parts
    .map((p, i) => {
      if (i === 0) return p.toLowerCase()
      if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase()
      if (p.length === 2) return p.toUpperCase()
      return p.toLowerCase()
    })
    .join('-')
}

export function resolveLocale(prefs: string[]): LocaleId {
  for (const raw of prefs) {
    const tag = canon(raw)
    if (!tag) continue
    const [lang, ...rest] = tag.split('-')

    if ((LOCALE_IDS as readonly string[]).includes(tag)) return tag as LocaleId

    if (lang === 'zh') {
      const region = rest.find((p) => p.length === 2)
      if (rest.includes('Hant') || region === 'TW' || region === 'HK') {
        return region === 'HK' ? 'zh-Hant-HK' : 'zh-Hant-TW'
      }
      continue // zh, zh-CN, zh-Hans* -> fall through to en
    }

    if (lang === 'pt') return 'pt-BR'

    const base = LOCALE_IDS.find(
      (id) => id === lang || id.startsWith(`${lang}-`)
    )
    if (base) return base
  }
  return 'en'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/i18n/locales.test.ts`
Expected: PASS (20 assertions).

- [ ] **Step 6: Typecheck & format**

Run: `pnpm typecheck && npx oxfmt src/shared/i18n/locales.ts src/shared/i18n/namespaces.ts tests/unit/i18n/locales.test.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/i18n/locales.ts src/shared/i18n/namespaces.ts tests/unit/i18n/locales.test.ts
git commit -m "feat(i18n): locale registry + resolveLocale"
```

---

### Task 2: Deps, English catalogs, shared engine, type augmentation

**Files:**

- Modify: `package.json` (dependencies)
- Create: `src/shared/i18n/locales/en/common.json` … `menu.json` (13 files)
- Create: `src/shared/i18n/index.ts`
- Create: `src/shared/i18n/types.d.ts`
- Test: `tests/unit/i18n/engine.test.ts`

**Interfaces:**

- Consumes: `LOCALE_IDS`, `LocaleId`, `FALLBACK_LNG` from `src/shared/i18n/locales.ts`; `NAMESPACES`, `MAIN_NAMESPACES` from `src/shared/i18n/namespaces.ts`.
- Produces:
  - `createI18n(lng: string, opts: { isRenderer: boolean }): { i18n: import('i18next').i18n; ready: Promise<unknown> }`
  - The 13 `en/*.json` files with their initial (partial) key sets.
  - Ambient `declare module 'i18next'` giving `t()` compile-time key checking against the `en` catalogs.

- [ ] **Step 1: Install deps**

Run: `pnpm add i18next react-i18next i18next-resources-to-backend`
Expected: `package.json` gains the three under `dependencies`; lockfile updated.

- [ ] **Step 2: Write the 13 English catalog scaffolds**

Each file is valid JSON with an initial set of keys that other Phase-1 code and tests reference. **Do not** try to be exhaustive — Phase 2 fills the rest.

```json
// src/shared/i18n/locales/en/common.json
{
  "appName": "Actovia",
  "action": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "close": "Close",
    "retry": "Retry",
    "confirm": "Confirm"
  },
  "state": {
    "loading": "Loading…",
    "local": "Local"
  }
}
```

```json
// src/shared/i18n/locales/en/settings.json
{
  "general": {
    "language": {
      "label": "Language",
      "description": "The language Actovia's interface is shown in.",
      "auto": "Auto (detect from system)"
    }
  }
}
```

```json
// src/shared/i18n/locales/en/errors.json
{
  "somethingWentWrong": "Something went wrong. Please try again.",
  "http": {
    "unknown": "Request failed.",
    "500": "The server ran into a problem.",
    "503": "The service is temporarily unavailable."
  }
}
```

The remaining 10 (`chat.json`, `philharmonic.json`, `discover.json`, `knowledgeBase.json`, `deepResearch.json`, `computerUse.json`, `lock.json`, `webSearch.json`, `audio.json`, `menu.json`) start as **`{}`** — Phase 2 populates them per namespace. They must still exist so the loader and `i18n:check` find all 13.

```json
{}
```

- [ ] **Step 3: Write `types.d.ts`**

```ts
import type audio from './locales/en/audio.json'
import type chat from './locales/en/chat.json'
// src/shared/i18n/types.d.ts
import type common from './locales/en/common.json'
import type computerUse from './locales/en/computerUse.json'
import type deepResearch from './locales/en/deepResearch.json'
import type discover from './locales/en/discover.json'
import type errors from './locales/en/errors.json'
import type knowledgeBase from './locales/en/knowledgeBase.json'
import type lock from './locales/en/lock.json'
import type menu from './locales/en/menu.json'
import type philharmonic from './locales/en/philharmonic.json'
import type settings from './locales/en/settings.json'
import type webSearch from './locales/en/webSearch.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      chat: typeof chat
      settings: typeof settings
      philharmonic: typeof philharmonic
      discover: typeof discover
      knowledgeBase: typeof knowledgeBase
      deepResearch: typeof deepResearch
      computerUse: typeof computerUse
      lock: typeof lock
      webSearch: typeof webSearch
      audio: typeof audio
      errors: typeof errors
      menu: typeof menu
    }
  }
}
```

- [ ] **Step 4: Write `index.ts`**

```ts
// src/shared/i18n/index.ts
import i18next, { type i18n as I18nInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next'

import { FALLBACK_LNG } from './locales'
import { MAIN_NAMESPACES, NAMESPACES } from './namespaces'

// Vite (all three electron-vite targets) turns this template dynamic import
// into a glob over ./locales/*/*.json and code-splits each locale.
const backend = resourcesToBackend(
  (lng: string, ns: string) => import(`./locales/${lng}/${ns}.json`)
)

export function createI18n(
  lng: string,
  { isRenderer }: { isRenderer: boolean }
): { i18n: I18nInstance; ready: Promise<unknown> } {
  const instance = i18next.createInstance()
  const configured = isRenderer
    ? instance.use(initReactI18next).use(backend)
    : instance.use(backend)

  const ready = configured.init({
    lng,
    fallbackLng: FALLBACK_LNG as unknown as Record<string, string[]>,
    ns: (isRenderer ? NAMESPACES : MAIN_NAMESPACES) as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    react: { useSuspense: false }
  })

  return { i18n: instance, ready }
}
```

- [ ] **Step 5: Write the failing test**

```ts
import { createI18n } from '@shared/i18n'
// tests/unit/i18n/engine.test.ts
import { describe, expect, it } from 'vitest'

describe('createI18n', () => {
  it('loads the active locale and returns a real string', async () => {
    const { i18n, ready } = createI18n('en', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('Save')
    expect(i18n.t('errors:somethingWentWrong')).toContain('went wrong')
  })

  it('falls back to en for a missing key without throwing', async () => {
    const { i18n, ready } = createI18n('ja', { isRenderer: false })
    await ready
    // ja/common.json is {} in Phase 1 -> resolves through fallbackLng
    expect(i18n.t('common:action.cancel')).toBe('Cancel')
  })

  it('resolves zh-Hant-HK through zh-Hant-TW then en', async () => {
    const { i18n, ready } = createI18n('zh-Hant-HK', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('Save') // en, since both zh files are {}
  })

  it('renderer mode initialises without throwing', async () => {
    const { i18n, ready } = createI18n('fr', { isRenderer: true })
    await ready
    expect(i18n.isInitialized).toBe(true)
  })
})
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/unit/i18n/engine.test.ts`
Expected: PASS. If the template dynamic `import()` fails to resolve under Vitest, change the test's expectation setup to pass explicit `resources` — but first try adding `assert { type: 'json' }`-free plain import; Vitest resolves `.json` natively.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean. The `t('common:action.save')` call in the test is now type-checked against `common.json`; a typo like `t('common:action.saev')` would be a compile error (verify once by temporarily introducing it, then revert).

- [ ] **Step 8: Format & commit**

```bash
npx oxfmt src/shared/i18n/index.ts src/shared/i18n/types.d.ts src/shared/i18n/locales/en/*.json tests/unit/i18n/engine.test.ts
git add package.json pnpm-lock.yaml src/shared/i18n tests/unit/i18n/engine.test.ts
git commit -m "feat(i18n): i18next engine + English catalog scaffold + typed keys"
```

---

### Task 3: Non-English catalog stubs

**Files:**

- Create: `src/shared/i18n/locales/<locale>/<ns>.json` for the 10 non-English locales × 13 namespaces — each file is `{}`
- Create: `src/shared/i18n/locales/<locale>/_status.json` for the 10 non-English locales
- Test: covered by Task 4's `catalogs.test.ts`

**Interfaces:**

- Consumes: `LOCALE_IDS`, `NAMESPACES`.
- Produces: 130 empty catalog files + 10 `_status.json` files. `_status.json` shape:
  `{ "locale": LocaleId, "source": "empty" | "machine" | "reviewed", "generatedAt": string | null, "reviewedNamespaces": Namespace[] }`

- [ ] **Step 1: Generate the stub files**

Run this one-off from the repo root (it is not committed as a script — Phase 3 gets the real generator):

```bash
node -e '
const fs=require("fs"),p=require("path");
const locales=["zh-Hant-TW","zh-Hant-HK","ja","ko","fr","de","es","pt-BR","ru","it"];
const ns=["common","chat","settings","philharmonic","discover","knowledgeBase","deepResearch","computerUse","lock","webSearch","audio","errors","menu"];
for(const l of locales){
  const dir=p.join("src/shared/i18n/locales",l);
  fs.mkdirSync(dir,{recursive:true});
  for(const n of ns) fs.writeFileSync(p.join(dir,n+".json"),"{}\n");
  fs.writeFileSync(p.join(dir,"_status.json"),
    JSON.stringify({locale:l,source:"empty",generatedAt:null,reviewedNamespaces:[]},null,2)+"\n");
}
console.log("wrote",locales.length*(ns.length+1),"files");
'
```

Expected: `wrote 140 files`.

- [ ] **Step 2: Verify structure**

Run: `ls src/shared/i18n/locales/*/ | head -30 && cat src/shared/i18n/locales/ja/_status.json`
Expected: every locale dir has 13 `.json` + `_status.json`; `ja/_status.json` shows `"source": "empty"`.

- [ ] **Step 3: Format & commit**

```bash
npx oxfmt "src/shared/i18n/locales/**/*.json"
git add src/shared/i18n/locales
git commit -m "feat(i18n): empty non-English catalog stubs + _status.json"
```

---

### Task 4: Catalog audit — `i18n:check`, `i18n:status`, `i18n:audit`

**Files:**

- Create: `src/shared/i18n/catalog-audit.ts` (pure — no `fs`)
- Create: `scripts/i18n-check.ts`
- Create: `scripts/i18n-status.ts`
- Create: `scripts/i18n-audit.ts`
- Modify: `package.json` (scripts)
- Modify: `.husky/pre-commit`
- Test: `tests/unit/i18n/catalogs.test.ts`

**Interfaces:**

- Consumes: `LOCALE_IDS`, `LocaleId`, `NAMESPACES` from the i18n package.
- Produces:
  - `flattenCatalog(json: unknown): Map<string, string>` — `{"a":{"b":"x"}}` → `Map { "a.b" => "x" }`
  - `auditCatalogs(input: { en: NsMap; others: Record<string, { nsMap: NsMap; source: string }> }): { ok: boolean; findings: Finding[] }`
    where `NsMap = Record<string /*ns*/, Map<string /*dotkey*/, string>>` and
    `Finding = { locale: string; level: 'error' | 'info'; message: string }`
  - `pnpm i18n:check` — exit 1 on any `error` finding
  - `pnpm i18n:status` — prints the review board
  - `pnpm i18n:audit` — prints the un-i18n'd string count (implemented minimally here; expanded in Phase 5)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n/catalogs.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { auditCatalogs, flattenCatalog } from '@shared/i18n/catalog-audit'
import { LOCALE_IDS } from '@shared/i18n/locales'
import { NAMESPACES } from '@shared/i18n/namespaces'
import { describe, expect, it } from 'vitest'

const ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'shared',
  'i18n',
  'locales'
)

function nsMap(locale: string) {
  const out: Record<string, Map<string, string>> = {}
  for (const ns of NAMESPACES) {
    const raw = readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8')
    out[ns] = flattenCatalog(JSON.parse(raw))
  }
  return out
}

describe('flattenCatalog', () => {
  it('flattens nested objects to dot keys', () => {
    const m = flattenCatalog({ a: { b: 'x' }, c: 'y' })
    expect([...m.entries()]).toEqual([
      ['a.b', 'x'],
      ['c', 'y']
    ])
  })
})

describe('catalog audit (repo state)', () => {
  it('every locale has all 13 namespace files and they parse', () => {
    for (const locale of LOCALE_IDS) expect(() => nsMap(locale)).not.toThrow()
  })

  it('no locale has orphan keys or param mismatches', () => {
    const en = nsMap('en')
    const others: Record<
      string,
      { nsMap: ReturnType<typeof nsMap>; source: string }
    > = {}
    for (const locale of LOCALE_IDS) {
      if (locale === 'en') continue
      const status = JSON.parse(
        readFileSync(join(ROOT, locale, '_status.json'), 'utf8')
      )
      others[locale] = { nsMap: nsMap(locale), source: status.source }
    }
    const { ok, findings } = auditCatalogs({ en, others })
    const errors = findings.filter((f) => f.level === 'error')
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
    expect(ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/i18n/catalogs.test.ts`
Expected: FAIL — `Cannot find module '@shared/i18n/catalog-audit'`.

- [ ] **Step 3: Write `catalog-audit.ts`**

```ts
// src/shared/i18n/catalog-audit.ts
export type NsMap = Record<string, Map<string, string>>

export interface Finding {
  locale: string
  level: 'error' | 'info'
  message: string
}

export function flattenCatalog(
  json: unknown,
  prefix = ''
): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof json === 'string') {
    out.set(prefix, json)
    return out
  }
  if (json && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) {
      const key = prefix ? `${prefix}.${k}` : k
      for (const [ik, iv] of flattenCatalog(v, key)) out.set(ik, iv)
    }
  }
  return out
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const stripPlural = (k: string) => k.replace(PLURAL_SUFFIX, '')
const vars = (s: string) =>
  new Set([...s.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]))

export function auditCatalogs(input: {
  en: NsMap
  others: Record<string, { nsMap: NsMap; source: string }>
}): { ok: boolean; findings: Finding[] } {
  const findings: Finding[] = []
  const enFlat = new Map<string, string>()
  for (const [ns, m] of Object.entries(input.en)) {
    for (const [k, v] of m) enFlat.set(`${ns}:${k}`, v)
  }
  const enBases = new Set(
    [...enFlat.keys()].map((k) => {
      const [ns, dot] = k.split(':')
      return `${ns}:${stripPlural(dot)}`
    })
  )

  for (const [locale, { nsMap, source }] of Object.entries(input.others)) {
    const locFlat = new Map<string, string>()
    for (const [ns, m] of Object.entries(nsMap)) {
      for (const [k, v] of m) locFlat.set(`${ns}:${k}`, v)
    }

    for (const key of locFlat.keys()) {
      const [ns, dot] = key.split(':')
      if (!enFlat.has(key) && !enBases.has(`${ns}:${stripPlural(dot)}`)) {
        findings.push({ locale, level: 'error', message: `orphan key ${key}` })
      }
    }

    for (const [key, enValue] of enFlat) {
      const locValue = locFlat.get(key)
      if (locValue === undefined) continue
      for (const v of vars(enValue)) {
        if (!vars(locValue).has(v)) {
          findings.push({
            locale,
            level: 'error',
            message: `${key} is missing {{${v}}}`
          })
        }
      }
    }

    const missing = [...enBases].filter((base) => {
      const [ns, dot] = base.split(':')
      for (const lk of locFlat.keys()) {
        const [lns, ldot] = lk.split(':')
        if (lns === ns && stripPlural(ldot) === dot) return false
      }
      return true
    })
    if (missing.length > 0) {
      const translated = source === 'machine' || source === 'reviewed'
      findings.push({
        locale,
        level: translated ? 'error' : 'info',
        message: `${missing.length} key(s) not translated (source: ${source})`
      })
    }
  }

  return { ok: findings.every((f) => f.level !== 'error'), findings }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/i18n/catalogs.test.ts`
Expected: PASS. (`others` are all `source: "empty"`, so the "not translated" findings are `info`, not `error`.)

- [ ] **Step 5: Write the three scripts**

```ts
// scripts/i18n-check.ts
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  auditCatalogs,
  flattenCatalog,
  type NsMap
} from '../src/shared/i18n/catalog-audit'
import { LOCALE_IDS } from '../src/shared/i18n/locales'
import { NAMESPACES } from '../src/shared/i18n/namespaces'

const ROOT = join(__dirname, '..', 'src', 'shared', 'i18n', 'locales')

function nsMap(locale: string): NsMap {
  const out: NsMap = {}
  for (const ns of NAMESPACES) {
    out[ns] = flattenCatalog(
      JSON.parse(readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8'))
    )
  }
  return out
}

const en = nsMap('en')
const others: Parameters<typeof auditCatalogs>[0]['others'] = {}
for (const locale of LOCALE_IDS) {
  if (locale === 'en') continue
  const status = JSON.parse(
    readFileSync(join(ROOT, locale, '_status.json'), 'utf8')
  )
  others[locale] = { nsMap: nsMap(locale), source: status.source }
}

const { ok, findings } = auditCatalogs({ en, others })
for (const f of findings) {
  console.log(`${f.level === 'error' ? '✗' : '·'} ${f.locale}: ${f.message}`)
}
console.log(ok ? '\ni18n:check OK' : '\ni18n:check FAILED')
process.exit(ok ? 0 : 1)
```

```ts
// scripts/i18n-status.ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { LOCALE_IDS } from '../src/shared/i18n/locales'
import { NAMESPACES } from '../src/shared/i18n/namespaces'

const ROOT = join(__dirname, '..', 'src', 'shared', 'i18n', 'locales')

for (const locale of LOCALE_IDS) {
  if (locale === 'en') {
    console.log(`en           source (canonical)`)
    continue
  }
  const s = JSON.parse(readFileSync(join(ROOT, locale, '_status.json'), 'utf8'))
  const reviewed = (s.reviewedNamespaces ?? []).length
  console.log(
    `${locale.padEnd(12)} ${String(s.source).padEnd(8)} reviewed ${reviewed}/${NAMESPACES.length}`
  )
}
```

```ts
// scripts/i18n-audit.ts
// Phase 1: report only the count of un-i18n'd JSX text nodes and toast titles.
// Phase 5 turns this into a gate-blocking test with an allowlist.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const SRC = join(__dirname, '..', 'src', 'renderer')

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.tsx') && !p.includes('components/ui/'))
    .map((p) => join(dir, p))
}

let jsxText = 0
let toastTitles = 0
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  jsxText += (src.match(/>\s*[A-Z][a-zA-Z]{2,}[^<>{}]*</g) ?? []).length
  toastTitles += (src.match(/title:\s*['"][A-Z]/g) ?? []).length
}
console.log(
  `un-i18n'd (approx):  JSX text nodes ${jsxText}   toast titles ${toastTitles}`
)
```

- [ ] **Step 6: Wire `package.json` scripts**

Add to `"scripts"`:

```json
"i18n:check": "tsx scripts/i18n-check.ts",
"i18n:status": "tsx scripts/i18n-status.ts",
"i18n:audit": "tsx scripts/i18n-audit.ts"
```

(The repo already runs scripts via `npx tsx` — see `asar:sniff`. Use bare `tsx` if it is a dependency; otherwise `npx tsx`.)

- [ ] **Step 7: Add `i18n:check` to the pre-commit gate**

Edit `.husky/pre-commit` to:

```sh
# .husky/pre-commit

npx lint-staged && pnpm i18n:check && pnpm test
```

- [ ] **Step 8: Run everything**

Run: `pnpm i18n:check && pnpm i18n:status && pnpm i18n:audit && npx vitest run tests/unit/i18n/`
Expected: `i18n:check OK`; status board prints 10 `empty` rows; audit prints counts; catalog test passes.

- [ ] **Step 9: Format & commit**

```bash
npx oxfmt src/shared/i18n/catalog-audit.ts scripts/i18n-check.ts scripts/i18n-status.ts scripts/i18n-audit.ts tests/unit/i18n/catalogs.test.ts
git add src/shared/i18n/catalog-audit.ts scripts/i18n-*.ts package.json .husky/pre-commit tests/unit/i18n/catalogs.test.ts
git commit -m "feat(i18n): catalog audit + i18n:check/status/audit scripts + gate"
```

---

### Task 5: `settings.language` — schema, column, migration

**Files:**

- Modify: `src/shared/schemas/settings-schema.ts` (add `language` to `SettingsSchema`)
- Modify: `src/main/lib/db/schema.ts` (add `language` column to `settings` table)
- Create: `resources/drizzle/0001_*.sql` (+ `meta/` updates) via `pnpm db:generate`
- Modify: `src/main/lib/db/migrate.ts` (idempotent `ALTER TABLE`)
- Test: `tests/unit/i18n/settings-language.test.ts`

**Interfaces:**

- Consumes: `LOCALE_IDS`, `LanguageSetting` from `src/shared/i18n/locales.ts`.
- Produces: `Settings['language']` typed as `LanguageSetting | null | undefined`; the `settings.language` DB column (`text`, default `'auto'`).

- [ ] **Step 1: Write the failing test**

```ts
import { SettingsSchema } from '@shared/schemas/settings-schema'
// tests/unit/i18n/settings-language.test.ts
import { describe, expect, it } from 'vitest'

const base = { id: 'global', createdAt: new Date(), updatedAt: new Date() }

describe('SettingsSchema.language', () => {
  it("accepts 'auto' and every locale id", () => {
    expect(SettingsSchema.parse({ ...base, language: 'auto' }).language).toBe(
      'auto'
    )
    expect(
      SettingsSchema.parse({ ...base, language: 'zh-Hant-HK' }).language
    ).toBe('zh-Hant-HK')
  })
  it('accepts null/undefined (pre-migration rows)', () => {
    expect(SettingsSchema.parse({ ...base }).language).toBeUndefined()
    expect(
      SettingsSchema.parse({ ...base, language: null }).language
    ).toBeNull()
  })
  it('rejects an unknown value', () => {
    expect(() => SettingsSchema.parse({ ...base, language: 'zh-CN' })).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/i18n/settings-language.test.ts`
Expected: FAIL — `language` unknown / accepts anything.

- [ ] **Step 3: Add `language` to `SettingsSchema`**

In `src/shared/schemas/settings-schema.ts`, add the import and the field (place it next to `menuBar`):

```ts
import { LOCALE_IDS } from '@shared/i18n/locales'
// …
export const SettingsSchema = z.object({
  // … existing fields …
  menuBar: z.boolean().nullish(),
  language: z.union([z.enum(LOCALE_IDS), z.literal('auto')]).nullish()
  // … rest …
})
```

- [ ] **Step 4: Add the DB column**

In `src/main/lib/db/schema.ts`, in `pgTable('settings', { … })`, next to `menuBar`:

```ts
menuBar: boolean('menuBar').default(true),
language: text('language').default('auto'),
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `resources/drizzle/0001_<name>.sql` containing
`ALTER TABLE "settings" ADD COLUMN "language" text DEFAULT 'auto';`, plus updated `meta/_journal.json` and a new `meta/0001_snapshot.json`. If `db:generate` prompts interactively (it should not for a pure column ADD), abort and rely on Step 6 alone; note it in the commit message.

- [ ] **Step 6: Add the idempotent guard in `migrate.ts`**

In `src/main/lib/db/migrate.ts`, in the "Idempotent column additions" block after the `task.lastRunStatus` line:

```ts
await pglite.exec(
  `ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "language" text DEFAULT 'auto';`
)
```

- [ ] **Step 7: Run the test + full gate**

Run: `npx vitest run tests/unit/i18n/settings-language.test.ts && pnpm typecheck && pnpm test`
Expected: the new test passes; typecheck clean; existing suite green (any `--no-verify`-worthy failure is only the documented PGlite teardown flake).

- [ ] **Step 8: Format & commit**

```bash
npx oxfmt src/shared/schemas/settings-schema.ts src/main/lib/db/schema.ts src/main/lib/db/migrate.ts tests/unit/i18n/settings-language.test.ts
git add src/shared/schemas/settings-schema.ts src/main/lib/db/schema.ts src/main/lib/db/migrate.ts resources/drizzle tests/unit/i18n/settings-language.test.ts
git commit -m "feat(i18n): settings.language column + schema (auto default)"
```

---

### Task 6: Main-process i18n module + IPC + startup wiring

**Files:**

- Create: `src/main/lib/i18n.ts`
- Modify: `src/main/index.ts` (call `initMainI18n()` after `runMigrate()`)
- Modify: `src/renderer/lib/ipc.ts` (add `setAppLocale`)
- Test: `tests/unit/i18n/main-i18n.test.ts`

**Interfaces:**

- Consumes: `createI18n` from `@shared/i18n`; `resolveLocale`, `isLocaleId`, `LanguageSetting` from `@shared/i18n/locales`; `getSettings` from `src/main/lib/db/queries.ts`; `ipcMain` / `app` from `electron`; `safeHandle` — but `safeHandle` is local to `ipc.ts`; register the plain handlers here with `ipcMain` directly (matching the pattern in `lock/ipc.ts`).
- Produces:
  - `initMainI18n(): Promise<void>` — resolves the effective locale from settings + OS, creates `mainI18n`, awaits its `ready`, registers `ipcMain.on('get-app-locale')` and `ipcMain.handle('set-app-locale')`.
  - `mainI18n: import('i18next').i18n` (usable after `initMainI18n()` resolves)
  - `getEffectiveLocale(): LocaleId` — sync; the currently active resolved locale
  - `resolveEffectiveLocale(setting: LanguageSetting | null | undefined): LocaleId` — pure-ish (calls `app.getPreferredSystemLanguages()` only for `'auto'`); exported for the test
  - Renderer: `setAppLocale(locale: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n/main-i18n.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['fr-CA', 'en-US'] },
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))
vi.mock('@main/lib/db/queries', () => ({ getSettings: vi.fn() }))

const { resolveEffectiveLocale } = await import('@main/lib/i18n')

describe('resolveEffectiveLocale', () => {
  it("'auto' resolves from the OS languages", () => {
    expect(resolveEffectiveLocale('auto')).toBe('fr')
  })
  it('an explicit id is used as-is', () => {
    expect(resolveEffectiveLocale('zh-Hant-TW')).toBe('zh-Hant-TW')
  })
  it('null / garbage falls back to auto-resolution', () => {
    expect(resolveEffectiveLocale(null)).toBe('fr')
    expect(resolveEffectiveLocale('nonsense' as never)).toBe('fr')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/i18n/main-i18n.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/main/lib/i18n.ts`**

```ts
import { createI18n } from '@shared/i18n'
import {
  isLocaleId,
  resolveLocale,
  type LanguageSetting,
  type LocaleId
} from '@shared/i18n/locales'
import { app, ipcMain } from 'electron'

import { getSettings } from './db/queries'
import { logger } from './logger'

export let mainI18n: import('i18next').i18n

let effective: LocaleId = 'en'
export const getEffectiveLocale = (): LocaleId => effective

export function resolveEffectiveLocale(
  setting: LanguageSetting | null | undefined
): LocaleId {
  if (setting && setting !== 'auto' && isLocaleId(setting)) return setting
  return resolveLocale(app.getPreferredSystemLanguages())
}

export async function initMainI18n(): Promise<void> {
  const settings = await getSettings()
  effective = resolveEffectiveLocale(
    settings.language as LanguageSetting | null | undefined
  )
  const { i18n, ready } = createI18n(effective, { isRenderer: false })
  mainI18n = i18n
  await ready
  logger.info('i18n', 'main i18n ready', { locale: effective })

  ipcMain.on('get-app-locale', (event) => {
    event.returnValue = effective
  })

  ipcMain.handle('set-app-locale', async (_event, locale: unknown) => {
    const next = isLocaleId(locale) ? locale : 'en'
    if (next === effective) return
    effective = next
    await mainI18n.changeLanguage(next)
    logger.info('i18n', 'main locale changed', { locale: next })
    // Menu/tray rebuild lands with the `menu` namespace extraction (Phase 2).
  })
}
```

- [ ] **Step 4: Call it in `src/main/index.ts`**

Add the import and call it immediately after `await runMigrate()`:

```ts
import { initMainI18n } from './lib/i18n'
// …
await runMigrate()
await initMainI18n()
```

- [ ] **Step 5: Add the renderer wrapper**

In `src/renderer/lib/ipc.ts`, next to `setNativeTheme`:

```ts
export function setAppLocale(locale: string) {
  return window.electron.ipcRenderer.invoke('set-app-locale', locale)
}
```

- [ ] **Step 6: Run the test + typecheck**

Run: `npx vitest run tests/unit/i18n/main-i18n.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Format & commit**

```bash
npx oxfmt src/main/lib/i18n.ts src/main/index.ts src/renderer/lib/ipc.ts tests/unit/i18n/main-i18n.test.ts
git add src/main/lib/i18n.ts src/main/index.ts src/renderer/lib/ipc.ts tests/unit/i18n/main-i18n.test.ts
git commit -m "feat(i18n): main-process i18n instance + get/set-app-locale IPC"
```

---

### Task 7: Preload — `window.api.locale`

**Files:**

- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: none (preload runs only in Electron; covered by the launch e2e in Phase 4)

**Interfaces:**

- Consumes: the `get-app-locale` sync IPC handler from Task 6.
- Produces: `window.api.locale: string` — the effective locale id, available synchronously on first script execution.

- [ ] **Step 1: Fill `locale` in the preload `api` object**

Edit `src/preload/index.ts`:

```ts
import os from 'os'

import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

function readLocale(): string {
  try {
    const v = ipcRenderer.sendSync('get-app-locale')
    return typeof v === 'string' && v ? v : 'en'
  } catch {
    return 'en'
  }
}

const api = {
  os: `${os.type()} ${os.arch()} v${os.release()}`,
  locale: readLocale()
}
```

(The rest of the file — the `contextIsolated` branch and the `else` branch — is unchanged; both already expose `api`.)

- [ ] **Step 2: Update the preload dts**

Edit `src/preload/index.d.ts`:

```ts
declare global {
  interface Window {
    electron: ElectronAPI
    api: { os: string; locale: string }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean (both `typecheck:node` — which includes `src/preload` — and `typecheck:web`, which includes `src/preload/*.d.ts`).

- [ ] **Step 4: Format & commit**

```bash
npx oxfmt src/preload/index.ts src/preload/index.d.ts
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(i18n): expose window.api.locale from preload"
```

---

### Task 8: Renderer i18n singleton + `<I18nProvider>` + `<LocaleBridge>`

**Files:**

- Create: `src/renderer/lib/i18n.ts`
- Create: `src/renderer/components/i18n-provider.tsx`
- Test: `tests/unit/i18n/renderer-i18n.test.ts`

**Interfaces:**

- Consumes: `createI18n` from `@shared/i18n`; `isLocaleId`, `LanguageSetting` from `@shared/i18n/locales`; `useSettings` from `@/hooks/use-settings`; `setAppLocale` from `@/lib/ipc`; `window.api.locale` (Task 7).
- Produces:
  - `src/renderer/lib/i18n.ts`: `i18n` (the configured instance), `i18nReady: Promise<unknown>`, `getBootLocale(): string`
  - `src/renderer/components/i18n-provider.tsx`: `<I18nProvider>{children}</I18nProvider>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n/renderer-i18n.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { locale: 'de' } })

const { i18n, i18nReady, getBootLocale } = await import('@/lib/i18n')

describe('renderer i18n singleton', () => {
  it('boots at window.api.locale', () => {
    expect(getBootLocale()).toBe('de')
  })
  it('initialises and falls back to en for empty catalogs', async () => {
    await i18nReady
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.t('common:action.save')).toBe('Save')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/i18n/renderer-i18n.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/renderer/lib/i18n.ts`**

```ts
import { createI18n } from '@shared/i18n'
import { isLocaleId } from '@shared/i18n/locales'

export function getBootLocale(): string {
  const q = new URLSearchParams(
    typeof location !== 'undefined' ? location.search : ''
  ).get('locale')
  if (isLocaleId(q)) return q
  const w = typeof window !== 'undefined' ? window.api?.locale : undefined
  return isLocaleId(w) ? w : 'en'
}

const created = createI18n(getBootLocale(), { isRenderer: true })
export const i18n = created.i18n
export const i18nReady = created.ready
```

- [ ] **Step 4: Write `src/renderer/components/i18n-provider.tsx`**

```tsx
import { isLocaleId, type LanguageSetting } from '@shared/i18n/locales'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'

import { useSettings } from '@/hooks/use-settings'
import { i18n } from '@/lib/i18n'
import { setAppLocale } from '@/lib/ipc'

/**
 * Follows `settings.language` and keeps i18next, `<html lang>`, and the main
 * process in sync. Side-effect only, mounted inside `<I18nProvider>` — mirrors
 * `NativeThemeBridge` in `theme-provider.tsx`.
 *
 * For `"auto"` the effective id was already resolved by the main process and
 * handed over as `window.api.locale`; the renderer never re-runs the matcher.
 */
function LocaleBridge() {
  const { data: settings } = useSettings()
  const setting = settings?.language as LanguageSetting | null | undefined

  useEffect(() => {
    const next =
      setting && setting !== 'auto' && isLocaleId(setting)
        ? setting
        : (window.api?.locale ?? 'en')
    if (next === i18n.resolvedLanguage || next === i18n.language) return

    void i18n.changeLanguage(next)
    document.documentElement.lang = next
    document.documentElement.dir = 'ltr'
    void setAppLocale(next)
  }, [setting])

  return null
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleBridge />
      {children}
    </I18nextProvider>
  )
}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run tests/unit/i18n/renderer-i18n.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Format & commit**

```bash
npx oxfmt src/renderer/lib/i18n.ts src/renderer/components/i18n-provider.tsx tests/unit/i18n/renderer-i18n.test.ts
git add src/renderer/lib/i18n.ts src/renderer/components/i18n-provider.tsx tests/unit/i18n/renderer-i18n.test.ts
git commit -m "feat(i18n): renderer i18n singleton + I18nProvider + LocaleBridge"
```

---

### Task 9: Wire `<I18nProvider>` into the four entry points

**Files:**

- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/sub-apps/searchbar/main.tsx`
- Modify: `src/renderer/sub-apps/quick-chat/main.tsx`
- Modify: `src/renderer/sub-apps/artifacts/main.tsx`
- Test: none (integration — the existing `tests/e2e/*.spec.ts` launch specs cover "does not crash"; a dedicated switch spec is Phase 4)

**Interfaces:**

- Consumes: `I18nProvider` from `@/components/i18n-provider`; `i18nReady` from `@/lib/i18n`.
- Produces: nothing new — each entry point now defers its first render until the active locale's namespaces are loaded, then renders inside `<I18nProvider>`.

- [ ] **Step 1: `src/renderer/main.tsx`**

Wrap the render in `i18nReady` and add the provider inside `<ThemeProvider>`:

```tsx
import { I18nProvider } from '@/components/i18n-provider'
import { i18nReady } from '@/lib/i18n'
// …
void i18nReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <SWRConfig value={{ fetcher }}>
      <Provider>
        <ThemeProvider>
          <I18nProvider>
            <AppRoot />
          </I18nProvider>
        </ThemeProvider>
      </Provider>
    </SWRConfig>
  )
})
```

- [ ] **Step 2: `src/renderer/sub-apps/searchbar/main.tsx`**

```tsx
import { I18nProvider } from '@/components/i18n-provider'
import { i18nReady } from '@/lib/i18n'
// …
void i18nReady.finally(() => {
  ReactDOM.createRoot(
    document.getElementById('searchbar-root') as HTMLElement
  ).render(
    <React.StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <SearchBar />
        </I18nProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
})
```

- [ ] **Step 3: `src/renderer/sub-apps/quick-chat/main.tsx`** — same shape (wrap its root render in `i18nReady.finally(...)`, add `<I18nProvider>` immediately inside `<ThemeProvider>`; read the file first to get its exact root id and component).

- [ ] **Step 4: `src/renderer/sub-apps/artifacts/main.tsx`** — same shape. This iframe has no preload, so `getBootLocale()` returns `'en'` here (documented limitation — resolved when `artifact-card.tsx` passes `?locale=` in a later phase).

- [ ] **Step 5: Build the renderer**

Run: `pnpm build`
Expected: typecheck + `electron-vite build` succeed. Confirm the build output shows per-locale JSON chunks under the renderer assets (`en-*.js` / `common-*.js` split — exact naming depends on Vite, the point is they are separate chunks, not inlined into the main bundle).

- [ ] **Step 6: Manual smoke (if a dev environment is available)**

Run: `pnpm dev`, open the app. Expected: no console errors from i18next; every string identical to before (all catalogs but `en` are empty, and only `en` scaffold keys exist — nothing is wired to `t()` yet, so this is purely "did the providers mount cleanly").

- [ ] **Step 7: Format & commit**

```bash
npx oxfmt src/renderer/main.tsx src/renderer/sub-apps/searchbar/main.tsx src/renderer/sub-apps/quick-chat/main.tsx src/renderer/sub-apps/artifacts/main.tsx
git add src/renderer/main.tsx src/renderer/sub-apps
git commit -m "feat(i18n): mount I18nProvider in all four renderer entry points"
```

---

### Task 10: `format.ts` — locale-aware date & number formatting

**Files:**

- Create: `src/renderer/lib/format.ts`
- Test: `tests/unit/i18n/format.test.ts`

**Interfaces:**

- Consumes: `LocaleId` from `@shared/i18n/locales`; `date-fns` + `date-fns/locale`; `useTranslation` from `react-i18next`.
- Produces:
  - `makeFormatters(localeId: string): { relativeTime(d: Date): string; dateTime(d: Date, o?: Intl.DateTimeFormatOptions): string; number(n: number, o?: Intl.NumberFormatOptions): string }`
  - `useFormat(): ReturnType<typeof makeFormatters>` — the hook, bound to `i18n.resolvedLanguage`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n/format.test.ts
import { describe, expect, it } from 'vitest'

import { makeFormatters } from '@/lib/format'

describe('makeFormatters', () => {
  const d = new Date('2026-01-15T12:00:00Z')

  it('formats numbers per locale', () => {
    expect(makeFormatters('en').number(1234567.5)).toBe('1,234,567.5')
    expect(makeFormatters('de').number(1234567.5)).toBe('1.234.567,5')
    expect(
      makeFormatters('fr')
        .number(1234567.5)
        .replace(/ | /g, ' ')
    ).toBe('1 234 567,5')
  })

  it('formats dates per locale', () => {
    expect(
      makeFormatters('en').dateTime(d, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    ).toMatch(/Jan.*15.*2026/)
    expect(
      makeFormatters('ja').dateTime(d, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    ).toContain('2026年')
  })

  it('relativeTime returns a localized string', () => {
    const past = new Date(Date.now() - 3 * 3600_000)
    expect(makeFormatters('en').relativeTime(past)).toMatch(/hours? ago/)
    expect(makeFormatters('ru').relativeTime(past)).toMatch(/назад/)
  })

  it('falls back to en for an unknown locale id', () => {
    expect(makeFormatters('xx').number(1000)).toBe('1,000')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/i18n/format.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/renderer/lib/format.ts`**

```ts
import type { LocaleId } from '@shared/i18n/locales'
import { formatDistanceToNow } from 'date-fns'
import {
  de,
  enUS,
  es,
  fr,
  it,
  ja,
  ko,
  ptBR,
  ru,
  zhHK,
  zhTW,
  type Locale
} from 'date-fns/locale'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const DATE_FNS: Record<LocaleId, Locale> = {
  en: enUS,
  'zh-Hant-TW': zhTW,
  'zh-Hant-HK': zhHK,
  ja,
  ko,
  fr,
  de,
  es,
  'pt-BR': ptBR,
  ru,
  it
}

export function makeFormatters(localeId: string) {
  const dfLocale = DATE_FNS[localeId as LocaleId] ?? enUS
  const intlTag = DATE_FNS[localeId as LocaleId] ? localeId : 'en'
  return {
    relativeTime: (d: Date) =>
      formatDistanceToNow(d, { addSuffix: true, locale: dfLocale }),
    dateTime: (d: Date, o?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(intlTag, o).format(d),
    number: (n: number, o?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(intlTag, o).format(n)
  }
}

export function useFormat() {
  const { i18n } = useTranslation()
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return useMemo(() => makeFormatters(lng), [lng])
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/i18n/format.test.ts`
Expected: PASS. If a `dateTime`/`number` assertion is brittle across Node ICU versions, relax it to `toMatch` on the salient separators rather than deleting the case.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (Verify the `date-fns/locale` named exports — in `date-fns@4` they are `enUS`, `zhTW`, `zhHK`, `ptBR`, etc.; if a name differs, fix the import to match the package's actual export.)

- [ ] **Step 6: Format & commit**

```bash
npx oxfmt src/renderer/lib/format.ts tests/unit/i18n/format.test.ts
git add src/renderer/lib/format.ts tests/unit/i18n/format.test.ts
git commit -m "feat(i18n): locale-aware makeFormatters + useFormat"
```

---

### Task 11: Documentation

**Files:**

- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: everything built above.
- Produces: the "Code Structure" entry for `src/shared/i18n/` and the i18n authoring rule.

- [ ] **Step 1: Add to "Code Structure" (main process / shared list)**

Under `Shared:` in `## Code Structure`, add:

```markdown
- `src/shared/i18n/` — application i18n: `locales.ts` (the 11 locale IDs +
  `resolveLocale`), `namespaces.ts`, `index.ts` (`createI18n` — one i18next
  config for both processes, JSON catalogs lazy-loaded per locale),
  `catalog-audit.ts`, `types.d.ts` (typed `t()` keys), `locales/<id>/<ns>.json`.
  See `docs/superpowers/specs/2026-09-11-i18n-design.md`.
```

Under the main-process list, add:

```markdown
- `src/main/lib/i18n.ts` — the main-process i18next instance (`mainI18n`),
  `resolveEffectiveLocale`, and the `get-app-locale` / `set-app-locale` IPC
```

- [ ] **Step 2: Update the "Project Constraints" copy rule**

Change the "Copy language" bullet to:

```markdown
- **Copy language.** New user-facing strings are keys in
  `src/shared/i18n/locales/en/<namespace>.json`, rendered via `t()` /
  `<Trans>` (renderer) or `mainI18n.t()` (main) — never hardcoded literals.
  English is the source catalog. `pnpm i18n:check` gates catalog parity.
```

- [ ] **Step 3: Add to "Adding a New Route" / patterns area — a short "Adding a user-facing string" subsection**

```markdown
### Adding a User-Facing String

1. Add the key to the right namespace in `src/shared/i18n/locales/en/<ns>.json`
   (dot-nested, component-scoped: `chat.composer.placeholder`).
2. Renderer: `const { t } = useTranslation('<ns>')` → `t('composer.placeholder')`;
   rich text (embedded link/bold) → `<Trans ns="<ns>" i18nKey="…">`.
3. Main process: `mainI18n.t('<ns>:key')`.
4. Dates/numbers: `useFormat()` (renderer). Never build sentences by
   interpolating translated fragments.
5. Non-English catalogs are filled by the machine-translation pass — do not
   hand-edit them.
```

- [ ] **Step 4: Verify CLAUDE.md freshness tests still pass**

Run: `npx vitest run tests/unit/shared/constants/` (the `claude-md-*` tests live under `tests/unit/` — run the whole `pnpm test` if unsure)
Expected: `claude-md-freshness` / `claude-md-staleness` green (every backticked path under "Code Structure" exists — `src/shared/i18n/` and `src/main/lib/i18n.ts` now do).

- [ ] **Step 5: Format & commit**

```bash
npx oxfmt CLAUDE.md
git add CLAUDE.md
git commit -m "docs(i18n): CLAUDE.md — i18n package + string authoring rule"
```

---

## Self-Review

**1. Spec coverage**

| Spec item                                                                                                                                                                                                                                                                                                                                        | Task                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Library `i18next` + `react-i18next` + `i18next-resources-to-backend`, no ICU, no detector                                                                                                                                                                                                                                                        | Task 2                                                                                                                    |
| 11 locale IDs, no Simplified, `zh-Hant-TW` / `zh-Hant-HK` split                                                                                                                                                                                                                                                                                  | Task 1 (`LOCALE_IDS`)                                                                                                     |
| `resolveLocale` matching ladder (`zh-Hans → en`, `zh-Hant → TW`, `pt → pt-BR`)                                                                                                                                                                                                                                                                   | Task 1                                                                                                                    |
| Fallback chain `zh-Hant-HK → zh-Hant-TW → en`                                                                                                                                                                                                                                                                                                    | Task 1 (`FALLBACK_LNG`), Task 2 (wired)                                                                                   |
| 13 namespaces; renderer all, main `['common','errors','menu']`                                                                                                                                                                                                                                                                                   | Task 1 (`NAMESPACES` / `MAIN_NAMESPACES`), Task 2                                                                         |
| Namespaced JSON, dot keys, CLDR plural suffixes                                                                                                                                                                                                                                                                                                  | Task 2 (catalogs), Task 4 (audit understands plural suffixes)                                                             |
| Renderer lazy-load per locale via a backend loader                                                                                                                                                                                                                                                                                               | Task 2 (`resourcesToBackend`)                                                                                             |
| `_status.json` per non-English locale                                                                                                                                                                                                                                                                                                            | Task 3                                                                                                                    |
| `createI18n` shared factory                                                                                                                                                                                                                                                                                                                      | Task 2                                                                                                                    |
| No-flash boot via a preload value resolved by main pre-window                                                                                                                                                                                                                                                                                    | Task 6 (resolve + `get-app-locale`), Task 7 (`window.api.locale`), Task 8 (`getBootLocale`), Task 9 (`i18nReady.finally`) |
| `<I18nProvider>` + `<LocaleBridge>` (like `theme-provider.tsx`)                                                                                                                                                                                                                                                                                  | Task 8                                                                                                                    |
| `settings.language` (`"auto"` default) + column + migration + schema                                                                                                                                                                                                                                                                             | Task 5                                                                                                                    |
| Main instance created after `runMigrate()`, before `setupMenu()`                                                                                                                                                                                                                                                                                 | Task 6                                                                                                                    |
| `set-app-locale` IPC → `mainI18n.changeLanguage`                                                                                                                                                                                                                                                                                                 | Task 6                                                                                                                    |
| `useFormat` / date-fns per-locale + `Intl`                                                                                                                                                                                                                                                                                                       | Task 10                                                                                                                   |
| `pnpm i18n:check` (also a test) + `i18n:status` + gate                                                                                                                                                                                                                                                                                           | Task 4                                                                                                                    |
| `CustomTypeOptions` typed keys                                                                                                                                                                                                                                                                                                                   | Task 2                                                                                                                    |
| Documentation                                                                                                                                                                                                                                                                                                                                    | Task 11                                                                                                                   |
| **Deferred to later phases (per spec's rollout):** string extraction (Phase 2), MT pass (Phase 3), Settings selector UI + menu/tray rebuild + focus re-resolve + e2e switch spec (Phase 4), `AppError` `{code,params}` refactor + `getHttpErrorMessage` translation (Phase 2's `errors` namespace), the blocking hardcoded-string test (Phase 5) | —                                                                                                                         |

No Phase-1 spec gap.

**2. Placeholder scan** — every code step has real content. The `en/*.json` scaffolds intentionally start partial (10 of 13 are `{}`); this is a spec decision ("Phase 2 populates them"), not a plan placeholder. The `quick-chat` / `artifacts` entry edits in Task 9 Steps 3–4 say "read the file first for its exact root id" rather than guessing an id the plan author has not seen — this is a direction to the implementer, not a TODO.

**3. Type consistency**

- `createI18n(lng, { isRenderer })` → `{ i18n, ready }` — same shape in Task 2 (def), Task 6, Task 8.
- `resolveLocale(prefs: string[]): LocaleId` (Task 1) vs `resolveEffectiveLocale(setting): LocaleId` (Task 6) — distinct names, distinct jobs (OS list vs. the stored setting), `resolveEffectiveLocale` calls `resolveLocale` internally. Consistent.
- `isLocaleId` used in Tasks 1, 5 (via schema `z.enum(LOCALE_IDS)`), 6, 8 — same import, same signature.
- `window.api.locale: string` declared in Task 7's dts, read in Task 8's `getBootLocale`. Consistent.
- `NAMESPACES` / `MAIN_NAMESPACES` as `readonly` tuples (Task 1); cast to `string[]` at the i18next `ns` boundary (Task 2). Consistent.
- `_status.json` `source` field values `"empty" | "machine" | "reviewed"` — written in Task 3, read in Task 4 (`auditCatalogs` treats `machine`/`reviewed` as "translated"). Consistent.
- `setAppLocale(locale: string)` renderer wrapper (Task 6) → `'set-app-locale'` handler (Task 6) → both agree on channel + arg.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-i18n-phase-1-infrastructure.md`.
