export const LOCALE_IDS = [
  'en',
  'zh-Hans',
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
  {
    id: LocaleId
    nativeName: string
    englishName: string
    /**
     * ISO 3166-1 alpha-2 code of the flag shown next to this language. A code,
     * not a component or an emoji: this module is shared with the main process,
     * and Windows has no flag emoji at all. The renderer's `<Flag>` draws it.
     */
    flagCode: string
  }
> = {
  en: {
    id: 'en',
    nativeName: 'English',
    englishName: 'English',
    flagCode: 'US'
  },
  'zh-Hans': {
    id: 'zh-Hans',
    nativeName: '简体中文',
    englishName: 'Chinese (Simplified)',
    flagCode: 'CN'
  },
  'zh-Hant-TW': {
    id: 'zh-Hant-TW',
    nativeName: '繁體中文（台灣）',
    englishName: 'Chinese (Traditional, Taiwan)',
    flagCode: 'TW'
  },
  'zh-Hant-HK': {
    id: 'zh-Hant-HK',
    nativeName: '繁體中文（香港）',
    englishName: 'Chinese (Traditional, Hong Kong)',
    flagCode: 'HK'
  },
  ja: {
    id: 'ja',
    nativeName: '日本語',
    englishName: 'Japanese',
    flagCode: 'JP'
  },
  ko: { id: 'ko', nativeName: '한국어', englishName: 'Korean', flagCode: 'KR' },
  fr: {
    id: 'fr',
    nativeName: 'Français',
    englishName: 'French',
    flagCode: 'FR'
  },
  de: {
    id: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
    flagCode: 'DE'
  },
  es: {
    id: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
    flagCode: 'ES'
  },
  'pt-BR': {
    id: 'pt-BR',
    nativeName: 'Português (Brasil)',
    englishName: 'Portuguese (Brazil)',
    flagCode: 'BR'
  },
  ru: {
    id: 'ru',
    nativeName: 'Русский',
    englishName: 'Russian',
    flagCode: 'RU'
  },
  it: {
    id: 'it',
    nativeName: 'Italiano',
    englishName: 'Italian',
    flagCode: 'IT'
  }
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
      // The script decides first (zh-Hans-TW is Simplified, zh-Hant-CN is
      // Traditional); without one, the region does: TW → Taiwan, HK / MO →
      // Hong Kong, anything else (CN, SG, none) → Simplified.
      const region = rest.find((p) => p.length === 2)
      const traditionalHK = region === 'HK' || region === 'MO'
      if (rest.includes('Hans')) return 'zh-Hans'
      if (rest.includes('Hant'))
        return traditionalHK ? 'zh-Hant-HK' : 'zh-Hant-TW'
      if (region === 'TW') return 'zh-Hant-TW'
      if (traditionalHK) return 'zh-Hant-HK'
      return 'zh-Hans'
    }

    if (lang === 'pt') return 'pt-BR'

    const base = LOCALE_IDS.find(
      (id) => id === lang || id.startsWith(`${lang}-`)
    )
    if (base) return base
  }
  return 'en'
}
