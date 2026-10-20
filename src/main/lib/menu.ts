import { APP_DISPLAY_NAME } from '@actovia/shared/constants/brand'
import { ACTOVIA_WEBSITE } from '@actovia/shared/constants/external-urls'
import { Menu, MenuItemConstructorOptions, shell } from 'electron'

import { mainT } from './i18n'
import { getLockManager } from './lock/lock-manager'
import { getMainWindow, openSearchBar, raiseMainWindow } from './window'

const isMac = process.platform === 'darwin'

/**
 * Sends a channel to the main window's renderer, raising it first — so the
 * menu (a global, OS-level accelerator: it fires no matter which window has
 * focus, or none) always lands on the real app window, never silently on a
 * sub-app, and shows it if it was hidden or minimized. `main.tsx` is the
 * listener (`router.navigate()` is a plain import there, reachable outside
 * any component).
 */
function goToMainWindow(channel: string) {
  raiseMainWindow()
  getMainWindow()?.webContents.send(channel)
}

/** Exported for `menu.test.ts` — `setupMenu()` itself just hands this to Electron. */
export function buildMenu(): MenuItemConstructorOptions[] {
  return [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              {
                role: 'about',
                label: mainT('menu:app.about', 'About {{name}}', {
                  name: APP_DISPLAY_NAME
                })
              },
              { type: 'separator' },
              {
                label: mainT('menu:settings', 'Settings…'),
                accelerator: 'Cmd+,',
                click: () => goToMainWindow('menu:open-settings')
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              {
                role: 'hide',
                label: mainT('menu:app.hide', 'Hide {{name}}', {
                  name: APP_DISPLAY_NAME
                })
              },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              {
                role: 'quit',
                label: mainT('menu:app.quit', 'Quit {{name}}', {
                  name: APP_DISPLAY_NAME
                })
              }
            ]
          }
        ]
      : []),
    {
      label: mainT('menu:file', 'File'),
      submenu: [
        {
          label: mainT('menu:newChat', 'New Chat'),
          accelerator: 'CmdOrCtrl+N',
          click: () => goToMainWindow('menu:new-chat')
        },
        { type: 'separator' },
        ...(isMac
          ? []
          : [
              {
                label: mainT('menu:settings', 'Settings…'),
                accelerator: 'Ctrl+,',
                click: () => goToMainWindow('menu:open-settings')
              } as MenuItemConstructorOptions,
              { type: 'separator' as const }
            ]),
        {
          label: mainT('menu:lockNow', 'Lock Now'),
          accelerator: 'CmdOrCtrl+L',
          click: () => getLockManager().lock('manual')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: mainT('menu:edit', 'Edit'),
      submenu: [
        {
          label: mainT('menu:find', 'Find'),
          accelerator: 'CmdOrCtrl+F',
          click: () => openSearchBar()
        },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: mainT('menu:speech', 'Speech'),
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }]
              }
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    {
      label: mainT('menu:view', 'View'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: mainT('menu:window', 'Window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ]
          : [{ role: 'close' }])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: mainT('menu:learnMore', 'Learn More'),
          click: async () => {
            await shell.openExternal(ACTOVIA_WEBSITE)
          }
        }
      ]
    }
  ] as MenuItemConstructorOptions[]
}

export function setupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu()))
}
