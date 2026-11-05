import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
// Consumers should import `useTheme` from 'next-themes' directly — this file
// only owns the ThemeProvider wrapper and the Theme type alias.
import type { ComponentProps } from 'react'
import { useEffect } from 'react'

import { setNativeTheme } from '@/lib/ipc'
import { bootReducedMotion } from '@/lib/reduced-motion'

import { MotionProvider } from './motion-provider'

bootReducedMotion()

export type Theme = 'light' | 'dark' | 'system'

/**
 * Bridges next-themes selection back into Electron's `nativeTheme.themeSource`
 * so OS chrome (titlebar, system menus, scrollbars) stays in sync with the
 * in-app theme. Mounted as a side-effect-only component inside ThemeProvider.
 */
function NativeThemeBridge() {
  const { theme } = useTheme()
  useEffect(() => {
    if (!theme) return
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      setNativeTheme(theme)
    }
  }, [theme])
  return null
}

/**
 * Thin wrapper around next-themes' ThemeProvider with project-specific
 * defaults: stores under the same `vite-ui-theme` key the legacy provider
 * used (preserves existing user choice across the migration), uses the
 * `class` attribute (matching `@custom-variant dark (&:is(.dark *))` in
 * globals.css), and forwards selection to Electron via NativeThemeBridge.
 */
export function ThemeProvider({
  children,
  connected = true,
  ...props
}: ComponentProps<typeof NextThemesProvider> & { connected?: boolean }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="vite-ui-theme"
      disableTransitionOnChange
      scriptProps={IS_WEB_CLIENT ? { type: 'application/json' } : undefined}
      {...props}
    >
      {!IS_WEB_CLIENT && <NativeThemeBridge />}
      {connected ? <MotionProvider>{children}</MotionProvider> : children}
    </NextThemesProvider>
  )
}
