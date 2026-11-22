import { APP_DISPLAY_NAME } from '@actovia/shared/constants/brand'
import type { BrowserWindowConstructorOptions } from 'electron'

export function mainWindowChrome(
  platform: NodeJS.Platform
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      frame: false,
      title: '',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 20, y: 16 }
    }
  }
  // Use the OS's own caption buttons, resize borders, keyboard system menu
  // and Windows Snap Layouts. Native chrome also protects controls on pages
  // without an app toolbar (settings, onboarding and the lock screen).
  return { frame: true, title: APP_DISPLAY_NAME, titleBarStyle: 'default' }
}
