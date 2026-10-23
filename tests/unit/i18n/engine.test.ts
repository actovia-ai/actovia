import { createI18n } from '@actovia/shared/i18n'
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
    // Phase 3 populated every real locale catalog, so there's no longer a
    // naturally-empty namespace to exercise the fallback chain with —
    // simulate one deliberately instead of relying on catalog completeness.
    i18n.removeResourceBundle('ja', 'common')
    i18n.addResourceBundle('ja', 'common', {}, false, true)
    expect(i18n.t('common:action.cancel')).toBe('Cancel')
  })

  it('resolves zh-Hant-HK through zh-Hant-TW before falling to en', async () => {
    const { i18n, ready } = createI18n('zh-Hant-HK', { isRenderer: false })
    await ready
    // Inject a TW-only value absent from en and zh-Hant-HK — if the fallback
    // chain skips TW and goes straight to en, this assertion fails.
    i18n.addResourceBundle('zh-Hant-TW', 'common', {
      action: { save: '儲存' }
    })
    expect(i18n.t('common:action.save')).toBe('儲存')
  })

  it('loads the Simplified Chinese catalog', async () => {
    const { i18n, ready } = createI18n('zh-Hans', { isRenderer: false })
    await ready
    expect(i18n.t('common:action.save')).toBe('保存')
  })

  it('gives Russian its one / few / many plural forms', async () => {
    // The renderer's namespaces: main loads only common / errors / menu.
    const { i18n, ready } = createI18n('ru', { isRenderer: true })
    await ready
    const word = (count: number) =>
      i18n
        .t('knowledgeBase:toast.docsCount', { count })
        .replace(/\d+/g, '')
        .trim()
    // CLDR: 1 / 21 → one, 3 / 22 → few, 5 / 11 → many.
    expect(new Set([word(1), word(3), word(5)]).size).toBe(3)
    expect(word(21)).toBe(word(1))
    expect(word(22)).toBe(word(3))
    expect(word(11)).toBe(word(5))
  })

  it('renderer mode initialises without throwing', async () => {
    const { i18n, ready } = createI18n('fr', { isRenderer: true })
    await ready
    expect(i18n.isInitialized).toBe(true)
  })
})
