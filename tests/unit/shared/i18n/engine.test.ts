import { createI18n } from '@actovia/shared/i18n'
import { resolveLocale } from '@actovia/shared/i18n/locales'
import { describe, expect, it } from 'vitest'

describe('createI18n', () => {
  it('loads the English catalog and resolves a real translation key', async () => {
    const { i18n, ready } = createI18n('en', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('Save')
  })

  it('loads a non-English catalog end to end (dynamic import -> i18next)', async () => {
    const { i18n, ready } = createI18n('ja', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('保存')
  })

  it('falls back through the configured chain for an unsupported locale', async () => {
    // zh-Hant-HK's fallback chain is ['zh-Hant-TW', 'en'] — 'xx' isn't a
    // configured locale at all, so this exercises the default ['en'] chain.
    const { i18n, ready } = createI18n('xx', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('Save')
  })
})

describe('resolveLocale', () => {
  it('picks an exact configured locale id', () => {
    expect(resolveLocale(['ja'])).toBe('ja')
  })

  it('maps zh-Hant + region to the matching Traditional Chinese locale', () => {
    expect(resolveLocale(['zh-Hant-HK'])).toBe('zh-Hant-HK')
    expect(resolveLocale(['zh-TW'])).toBe('zh-Hant-TW')
  })

  it('falls through zh-Hans (Simplified) to English rather than guessing Traditional', () => {
    expect(resolveLocale(['zh-Hans-CN'])).toBe('en')
  })

  it('redirects any Portuguese variant to pt-BR', () => {
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR')
  })

  it('defaults to English when nothing matches', () => {
    expect(resolveLocale(['xx-YY'])).toBe('en')
    expect(resolveLocale([])).toBe('en')
  })
})
