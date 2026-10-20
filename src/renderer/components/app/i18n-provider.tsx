import { isLocaleId } from '@actovia/shared/i18n/locales'
import { useEffect, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { useSettings } from '@/hooks/use-settings'
import { i18n } from '@/lib/i18n'
import { setAppLocale } from '@/lib/ipc'
import { reportRendererError } from '@/lib/report-error'

/**
 * Follows `settings.language` and keeps i18next, `<html lang>`, and the main
 * process in sync. Side-effect only, mounted inside `<I18nProvider>` — mirrors
 * `NativeThemeBridge` in `theme-provider.tsx`.
 *
 * A concrete locale id is applied immediately (no OS lookup needed) and the
 * main process notified fire-and-forget. `"auto"` is different: only the
 * main process can see the OS's current preferred languages
 * (`app.getPreferredSystemLanguages()`), so it's resolved by AWAITING
 * `setAppLocale('auto')`'s return value fresh every time, never by reading
 * `window.api.locale` — that's just a snapshot from whenever this renderer
 * process last booted, and goes stale the moment the setting is switched
 * away from `"auto"` (to an explicit locale) and back without an app
 * restart: switching to 日本語 then back to "Auto Detect" used to silently
 * stay in Japanese, because `window.api.locale` still held the last
 * EXPLICIT locale, not the OS's actual current preference.
 */
function LocaleBridge() {
  const { data: settings } = useSettings()
  const setting = settings?.language
  const settingsLoaded = settings !== undefined
  const hasElectronBridge = typeof window !== 'undefined' && !!window.electron

  useEffect(() => {
    if (setting && setting !== 'auto' && isLocaleId(setting)) {
      const next = setting
      if (next !== i18n.resolvedLanguage && next !== i18n.language) {
        void i18n.changeLanguage(next)
        document.documentElement.lang = next
        document.documentElement.dir = 'ltr'
      }
      if (hasElectronBridge) {
        setAppLocale(next).catch((err) => {
          reportRendererError('i18n', err, { step: 'notify-main', next })
        })
      }
      return
    }

    // 'auto', or settings haven't loaded yet — wait for the real setting
    // rather than guessing, and skip the round trip entirely without an
    // Electron bridge (falls back to whatever `getBootLocale()` already
    // applied at renderer boot).
    if (!settingsLoaded || !hasElectronBridge) return

    let cancelled = false
    setAppLocale('auto')
      .then((next: string) => {
        if (cancelled || !next) return
        if (next === i18n.resolvedLanguage || next === i18n.language) return
        void i18n.changeLanguage(next)
        document.documentElement.lang = next
        document.documentElement.dir = 'ltr'
      })
      .catch((err) => {
        reportRendererError('i18n', err, { step: 'resolve-auto' })
      })
    return () => {
      cancelled = true
    }
  }, [setting, settingsLoaded, hasElectronBridge])

  return null
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleBridge />
      {children}
    </I18nextProvider>
  )
}
