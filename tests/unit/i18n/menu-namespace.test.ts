import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const menu = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'i18n',
      'locales',
      'en',
      'menu.json'
    ),
    'utf8'
  )
)

describe('menu namespace (en)', () => {
  it('has the 8 top-level menu-bar labels', () => {
    expect(menu.file).toBe('File')
    expect(menu.lockNow).toBe('Lock Now')
    expect(menu.edit).toBe('Edit')
    expect(menu.find).toBe('Find')
    expect(menu.speech).toBe('Speech')
    expect(menu.view).toBe('View')
    expect(menu.window).toBe('Window')
    expect(menu.learnMore).toBe('Learn More')
  })

  it('has New Chat and Settings… — real commands, not just system roles', () => {
    expect(menu.newChat).toBe('New Chat')
    expect(menu.settings).toBe('Settings…')
  })

  it('has the 3 tray labels', () => {
    expect(menu.tray.showApp).toBe('Show App')
    expect(menu.tray.hideApp).toBe('Hide App')
    expect(menu.tray.quitExodus).toBe('Quit Actovia')
  })

  it('has the 2 templated Philharmonic notification titles', () => {
    expect(menu.notification.philharmonicGroupError).toBe(
      'Group "{{title}}" hit an error'
    )
    expect(menu.notification.philharmonicGroupFinished).toBe(
      'Group "{{title}}" finished'
    )
  })
})
