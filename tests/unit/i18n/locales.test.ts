import {
  resolveLocale,
  isLocaleId,
  LOCALE_IDS
} from '@actovia/shared/i18n/locales'
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
    [['zh-Hant-MO'], 'zh-Hant-HK'],
    [['zh-MO'], 'zh-Hant-HK'],
    [['zh-Hant-CN'], 'zh-Hant-TW'],
    [['zh-Hans-CN'], 'zh-Hans'],
    [['zh-CN'], 'zh-Hans'],
    [['zh_CN'], 'zh-Hans'],
    [['zh-SG'], 'zh-Hans'],
    [['zh'], 'zh-Hans'],
    [['zh-Hans-TW'], 'zh-Hans'],
    [['zh-Hans-HK'], 'zh-Hans'],
    [['zh-Hans'], 'zh-Hans'],
    [['ru-RU'], 'ru'],
    [['ru'], 'ru'],
    [['ru-UA', 'en'], 'ru'],
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
