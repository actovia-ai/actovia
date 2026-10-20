// `[Marie Curie](entity:Marie_Curie)` — a link in a reply that opens a small
// panel about the person, place or thing (actovia-ios spec 2026-10-07 §2.2).
// The target is a Wikipedia article title, and only something that could be
// one is a link; anything else is plain text. actovia-ios's
// `MarkdownEntityLink` has the same rule, held to the same vectors.

export const ENTITY_SCHEME = 'entity:'
export const ENTITY_TITLE_MAX = 200

/** Letters, digits and the punctuation Wikipedia titles carry; never `/`, `?`, `#`, a space or a control. */
const TITLE = /^[\p{L}\p{N}_().,'\-:]+$/u
const HAS_WORD = /[\p{L}\p{N}]/u

/**
 * Whether `title` could be a Wikipedia article's: 1–200 UTF-16 units of the
 * title alphabet, with at least one letter or digit (so `.` and `..` are
 * not titles and the route's URL cannot climb).
 */
export function isWikipediaTitle(title: string): boolean {
  return (
    title.length > 0 &&
    title.length <= ENTITY_TITLE_MAX &&
    TITLE.test(title) &&
    HAS_WORD.test(title)
  )
}

/**
 * The article title an `entity:` href names, percent-escapes decoded (a
 * Markdown tool may encode `東京`), or null when the href is not such a link
 * or its title is not one.
 */
export function entityTitle(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(ENTITY_SCHEME)) return null
  let title: string
  try {
    title = decodeURIComponent(href.slice(ENTITY_SCHEME.length))
  } catch {
    return null
  }
  return isWikipediaTitle(title) ? title : null
}

/** A Wikipedia language subdomain: two or three lowercase letters. */
export function isWikipediaLang(lang: string): boolean {
  return /^[a-z]{2,3}$/u.test(lang)
}

/**
 * Wikipedia's language for an app locale: the first subtag, lowercased, when
 * it is a language code (`zh-Hant-TW` → `zh`, `pt-BR` → `pt`); else `en`.
 */
export function wikipediaLang(locale: string): string {
  const base = (locale.split('-')[0] ?? '').toLowerCase()
  return isWikipediaLang(base) ? base : 'en'
}
