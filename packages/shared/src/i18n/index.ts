import i18next, { type i18n as I18nInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next'

import { FALLBACK_LNG } from './locales'
import { MAIN_NAMESPACES, NAMESPACES } from './namespaces'

// universal-client's version passes `i18next-resources-to-backend` a
// runtime `import(`./locales/${lng}/${ns}.json`)` template and relies on
// Vite recognizing the pattern and glob-expanding it at build time. That
// works when the calling module is under the app's own src/ tree, but not
// here: this module is reached through the `@actovia/shared` workspace
// package (a node_modules symlink), and Vite's dynamic-import-with-vars
// transform doesn't reach through that boundary — verified by inspecting a
// real `electron-forge package` output, where the import survived
// completely unresolved (`import(\`./locales/${e}/${t}.json\`)`, literally
// in the shipped bundle) with zero locale JSON copied anywhere. It would
// have failed at runtime in every packaged build.
//
// `import.meta.glob` is Vite's own first-class static-glob API — a
// compile-time macro keyed on the literal string argument, not a heuristic
// over a runtime expression — and isn't subject to the same limitation.
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  './locales/*/*.json'
)

const backend = resourcesToBackend((lng: string, ns: string) => {
  const key = `./locales/${lng}/${ns}.json`
  const loader = localeModules[key]
  if (!loader) {
    return Promise.reject(new Error(`Missing locale module: ${key}`))
  }
  return loader().then((m) => m.default)
})

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
    fallbackLng: FALLBACK_LNG,
    ns: isRenderer ? NAMESPACES : MAIN_NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    react: { useSuspense: false }
  })

  return { i18n: instance, ready }
}
