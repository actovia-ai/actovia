import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'

import { router } from '@/routes'

/**
 * The two ends of `menu.ts`'s `goToMainWindow()`: the native menu's `click`
 * runs in the main process and can only navigate this window by sending a
 * channel; this is what answers it. `router.navigate()` works from plain
 * code — `router` is the app's one `createHashRouter()` instance, not
 * bound to any component — so no bridge component or provider is needed.
 * Called once, at boot, from `main.tsx` only: the sub-apps have no router.
 */
let installed = false

export function installMenuBridge(): void {
  if (installed || IS_WEB_CLIENT) return
  installed = true

  window.electron.ipcRenderer.on('menu:new-chat', () => {
    void router.navigate('/')
  })
  window.electron.ipcRenderer.on('menu:open-settings', () => {
    void router.navigate('/settings')
  })
}
