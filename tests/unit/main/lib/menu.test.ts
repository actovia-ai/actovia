import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { name: 'Actovia' },
  shell: { openExternal: vi.fn() }
}))
vi.mock('@main/lib/i18n', () => ({
  mainT: (_key: string, fallback: string) => fallback
}))
vi.mock('@main/lib/lock/lock-manager', () => ({
  getLockManager: () => ({ lock: vi.fn() })
}))
const send = vi.fn()
const raiseMainWindow = vi.fn()
vi.mock('@main/lib/window', () => ({
  getMainWindow: () => ({ webContents: { send } }),
  raiseMainWindow,
  openSearchBar: vi.fn()
}))

/** A menu item by label, one level deep — every submenu here is flat enough. */
function findByLabel(items: MenuItemConstructorOptions[], label: string) {
  for (const item of items) {
    if (item.label === label) return item
    if (Array.isArray(item.submenu)) {
      const found = findByLabel(
        item.submenu as MenuItemConstructorOptions[],
        label
      )
      if (found) return found
    }
  }
  return undefined
}

/** A top-level menu's own submenu, by that menu's label — `[]` if absent. */
function submenuOf(
  menu: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions[] {
  const found = menu.find((m) => m.label === label)
  return Array.isArray(found?.submenu)
    ? (found.submenu as MenuItemConstructorOptions[])
    : []
}

async function loadWithPlatform(platform: NodeJS.Platform) {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform })
  return await import('@main/lib/menu')
}

describe('buildMenu', () => {
  afterEach(() => {
    send.mockClear()
    raiseMainWindow.mockClear()
  })

  it('darwin: New Chat is in File, Settings… is in the app menu, both raise and message the main window', async () => {
    const { buildMenu } = await loadWithPlatform('darwin')
    const menu = buildMenu()

    const newChat = findByLabel(menu, 'New Chat')
    expect(newChat?.accelerator).toBe('CmdOrCtrl+N')
    newChat?.click?.({} as never, {} as never, {} as never)
    expect(raiseMainWindow).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('menu:new-chat')

    const settings = findByLabel(menu, 'Settings…')
    expect(settings?.accelerator).toBe('Cmd+,')
    settings?.click?.({} as never, {} as never, {} as never)
    expect(send).toHaveBeenCalledWith('menu:open-settings')

    // Only one Settings item on macOS — it lives in the app menu, not File.
    expect(submenuOf(menu, 'File').some((i) => i.label === 'Settings…')).toBe(
      false
    )
  })

  it('win32: Settings… moves into File, with a Ctrl+, accelerator', async () => {
    const { buildMenu } = await loadWithPlatform('win32')
    const menu = buildMenu()

    const settings = submenuOf(menu, 'File').find(
      (i) => i.label === 'Settings…'
    )
    expect(settings?.accelerator).toBe('Ctrl+,')

    // No separate app-name menu off Windows/Linux.
    expect(menu.some((m) => m.label === 'Actovia')).toBe(false)
  })
})
