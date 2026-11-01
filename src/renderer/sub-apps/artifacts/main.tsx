import '@/assets/stylesheets/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { bootReducedMotion } from '@/lib/reduced-motion'
import { bootTone, subscribeToneCache } from '@/lib/tone'

import { ArtifactSandbox } from './sandbox'

// Apply theme from localStorage (same key as main app's ThemeProvider).
// We don't use ThemeProvider here because it calls setNativeTheme via IPC,
// which is unavailable inside a sandboxed iframe without preload scripts.
function applyTheme() {
  const stored = window.localStorage.getItem('vite-ui-theme') ?? 'system'
  const root = document.documentElement
  root.classList.remove('light', 'dark')

  if (stored === 'system') {
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    root.classList.add(sys)
  } else {
    root.classList.add(stored)
  }
}

applyTheme()
bootReducedMotion()
window.addEventListener('storage', bootReducedMotion)

// The colour tone, from the same shared localStorage cache the main window
// writes (see lib/tone.ts); kept live via the `storage` event.
bootTone()
subscribeToneCache(bootTone)

// globals.css sets `body { bg-transparent }` for the main app — but in a
// sandboxed iframe with no explicit surface, that lets the browser's default
// white show through, making dark-mode text unreadable when an LLM-authored
// artifact omits its own background. Override here so the iframe's surface
// always tracks the theme.
document.body.classList.add('bg-background')

// Listen for system theme changes
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', applyTheme)

// No I18nProvider here, and no React Query client: nothing in this frame is
// translated (the sandbox chrome is a couple of fixed status lines, and the
// artifact is model-written code), and `I18nProvider` follows
// `settings.language` through `useSettings()` — a request to the API. This
// page's CSP allows no network at all and must never need it, so it gets
// neither (see src/main/lib/artifact-protocol.ts).
ReactDOM.createRoot(
  document.getElementById('artifact-root') as HTMLElement
).render(
  <React.StrictMode>
    <ArtifactSandbox />
  </React.StrictMode>
)
