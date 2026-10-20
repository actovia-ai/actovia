import { WEB_SEARCH_COUNTRY_CODES } from '@actovia/shared/constants/country-codes'
import { describe, expect, it } from 'vitest'

import { countryName, countryOptions } from '@/lib/country-names'

describe('countryName', () => {
  it('uses the current, ordinary name — not the ISO "official" one', () => {
    expect(countryName('tw', 'en')).toBe('Taiwan')
    expect(countryName('kr', 'en')).toBe('South Korea')
    expect(countryName('sz', 'en')).toBe('Eswatini')
    expect(countryName('cz', 'en')).toBe('Czechia')
    expect(countryName('cd', 'en')).toBe('Congo - Kinshasa')
    expect(countryName('cg', 'en')).toBe('Congo - Brazzaville')
  })

  it("names countries in the user's language", () => {
    expect(countryName('tw', 'zh-Hant-TW')).toBe('台灣')
    expect(countryName('de', 'de')).toBe('Deutschland')
    expect(countryName('jp', 'ja')).toBe('日本')
  })

  it('knows the search API says uk for Great Britain', () => {
    expect(countryName('uk', 'en')).toBe('United Kingdom')
  })

  it('falls back to the code for one the runtime does not know', () => {
    expect(countryName('xx', 'en')).toBe('XX')
  })
})

describe('countryOptions', () => {
  it('names every searchable country and sorts them for the locale', () => {
    const options = countryOptions('en')

    expect(options).toHaveLength(WEB_SEARCH_COUNTRY_CODES.length)
    expect(options.map((o) => o.code).sort()).toEqual(
      [...WEB_SEARCH_COUNTRY_CODES].sort()
    )
    const names = options.map((o) => o.name)
    expect(names).toEqual([...names].sort(new Intl.Collator('en').compare))
    expect(names[0]).toBe('Afghanistan')
  })

  it('sorts by the localized name, so the order differs per language', () => {
    const en = countryOptions('en').map((o) => o.code)
    const ja = countryOptions('ja').map((o) => o.code)
    expect(ja).not.toEqual(en)
  })

  it('never leaves a country unnamed', () => {
    for (const { code, name } of countryOptions('fr')) {
      expect(name, code).not.toBe('')
    }
  })
})
