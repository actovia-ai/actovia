import { mainWindowChrome } from '@main/lib/window-chrome'
import { describe, expect, it } from 'vitest'

describe('main window chrome', () => {
  it.each(['win32', 'linux'] as const)(
    '%s keeps OS caption buttons and resize borders',
    (platform) => {
      expect(mainWindowChrome(platform)).toMatchObject({
        frame: true,
        titleBarStyle: 'default'
      })
      expect(mainWindowChrome(platform).trafficLightPosition).toBeUndefined()
    }
  )
  it('macOS keeps its inset traffic lights', () => {
    expect(mainWindowChrome('darwin')).toMatchObject({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 20, y: 16 }
    })
  })
})
