import { WEB_SEARCH_COUNTRY_CODES } from '@actovia/shared/constants/country-codes'

// `uk` is what the search API calls Great Britain; ISO says `GB`.
const ISO_ALIASES: Record<string, string> = { uk: 'GB' }

export interface CountryOption {
  /** The search API's code, as stored in settings (lower-case). */
  code: string
  /** The country's name in `locale`. */
  name: string
}

/**
 * A country's name in the user's language, from the OS's own data — current
 * names ("Eswatini", "Türkiye", "Czechia"), no table to maintain, all ten
 * locales for free. A code the runtime doesn't know (a dissolved state such as
 * `an` or `cs`) falls back to the code itself, upper-cased.
 */
export function countryName(code: string, locale: string): string {
  const iso = ISO_ALIASES[code] ?? code.toUpperCase()
  try {
    const name = new Intl.DisplayNames([locale], {
      type: 'region',
      fallback: 'none'
    }).of(iso)
    return name ?? iso
  } catch {
    return iso
  }
}

/** Every searchable country, named in `locale` and sorted the way that language sorts. */
export function countryOptions(locale: string): CountryOption[] {
  const collator = new Intl.Collator(locale)
  return WEB_SEARCH_COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code, locale)
  })).sort((a, b) => collator.compare(a.name, b.name))
}
