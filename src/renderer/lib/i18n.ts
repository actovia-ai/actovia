import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { createI18n } from '@actovia/shared/i18n'
import { isLocaleId } from '@actovia/shared/i18n/locales'

export function getBootLocale(): string {
  const q = new URLSearchParams(
    typeof location === 'undefined' ? '' : location.search
  ).get('locale')
  if (isLocaleId(q)) return q
  if (IS_WEB_CLIENT) {
    for (const language of navigator.languages) {
      if (isLocaleId(language)) return language
      const candidate =
        language === 'zh-CN' || language === 'zh-SG'
          ? 'zh-Hans'
          : language === 'zh-TW'
            ? 'zh-Hant-TW'
            : language === 'zh-HK'
              ? 'zh-Hant-HK'
              : language.split('-')[0]
      if (isLocaleId(candidate)) return candidate
    }
  }
  const w = typeof window === 'undefined' ? undefined : window.api?.locale
  return isLocaleId(w) ? w : 'en'
}

const bootLocale = getBootLocale()
// Set the document language before React mounts; LocaleBridge keeps it current.
if (typeof document !== 'undefined') document.documentElement.lang = bootLocale

const created = createI18n(bootLocale, { isRenderer: true })
export const i18n = created.i18n
export const i18nReady = created.ready
