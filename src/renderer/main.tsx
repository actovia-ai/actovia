import '@/assets/stylesheets/globals.css'
import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Provider } from 'jotai'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'

import 'react-medium-image-zoom/dist/styles.css'
import { I18nProvider } from '@/components/app/i18n-provider'
import { MotionProvider } from '@/components/app/motion-provider'
import { ThemeProvider } from '@/components/app/theme-provider'
import { ToneBridge } from '@/components/app/tone-bridge'
import { LockScreen } from '@/components/lock/lock-screen'
import { WebTerminalGate } from '@/components/web-terminal/gate'
import { useLock } from '@/hooks/use-lock'
import { i18nReady } from '@/lib/i18n'
import { installMenuBridge } from '@/lib/menu-bridge'
import { installWindowFocusListener, queryClient } from '@/lib/query-client'
import { installQuickChatBridge } from '@/lib/quick-chat-bridge'
import { installGlobalErrorReporting } from '@/lib/report-error'
import { bootTone } from '@/lib/tone'
import { router } from '@/routes'

// First paint already carries the user's colour tone: apply the cached value
// synchronously, before anything renders. ToneBridge keeps it live.
bootTone()
if (IS_WEB_CLIENT) {
  // Apply before React mounts; next-themes' inline bootstrap is inert under CSP.
  try {
    const theme = localStorage.getItem('vite-ui-theme') ?? 'system'
    const dark =
      theme === 'dark' ||
      (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  } catch {
    /* Browser storage may be disabled. */
  }
}
// Catches what no ErrorBoundary in the tree below can — see its docstring.
installGlobalErrorReporting()
// Feeds every query that opts into `refetchOnWindowFocus` (the Ollama probe
// and the rest of the "Server state (React Query)" list in CLAUDE.md) a
// focus signal when the window itself regains focus, not just on
// `visibilitychange` — see query-client.ts.
installWindowFocusListener()
// New Chat / Settings… on the native menu — see menu-bridge.ts.
installMenuBridge()
// The text handed over by the quick-chat window — see quick-chat-bridge.ts.
installQuickChatBridge()

function DesktopRoot() {
  const { status, refresh, locked } = useLock()

  if (status === null) return null
  if (locked) return <LockScreen status={status} onUnlocked={refresh} />
  return <RouterProvider router={router} />
}

function AppRoot() {
  return IS_WEB_CLIENT ? (
    <WebTerminalGate>
      <MotionProvider>
        <I18nProvider>
          <ToneBridge />
          <RouterProvider router={router} />
        </I18nProvider>
      </MotionProvider>
    </WebTerminalGate>
  ) : (
    <DesktopRoot />
  )
}

void i18nReady.finally(() => {
  ReactDOM.createRoot(document.querySelector('#root') as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
      <Provider>
        <ThemeProvider connected={!IS_WEB_CLIENT}>
          <I18nProvider connected={!IS_WEB_CLIENT}>
            {!IS_WEB_CLIENT && <ToneBridge />}
            <AppRoot />
          </I18nProvider>
        </ThemeProvider>
      </Provider>
      {/* Dev only. Bottom-right: the bottom-left is both sidebars' footer
          (Chat's profile, Philharmonic's Workforce / Dashboard), which its
          palm-tree button sat on. */}
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  )
})
