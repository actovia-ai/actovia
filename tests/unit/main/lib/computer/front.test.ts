import { bringToFront } from '@main/lib/computer/front'
import { refreshOrRaise, WindowGone } from '@main/lib/computer/target'
import type { InputHelper, TargetWindow } from '@main/lib/computer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: undefined }))

// Input is sent as screen-coordinate events, so it may go out only while the
// target is in front: on screen, its app frontmost, nothing else over it.
const chess: TargetWindow = {
  cgWindowId: 1,
  app: 'Chess',
  bundleId: 'com.apple.Chess',
  title: 'Game 1',
  bounds: [400, 200, 800, 600]
}

function helperWith(
  before: TargetWindow[],
  after: TargetWindow[] = before
): InputHelper & { activated: string[] } {
  let current = before
  const activated: string[] = []
  return {
    activated,
    listWindows: async () => current,
    screenshot: async () => Buffer.alloc(0),
    send: async () => {},
    activate: async (query: string) => {
      activated.push(query)
      current = after
      return { bundleId: 'com.apple.Chess', pid: 1 }
    },
    listApps: async () => []
  }
}

const sheet: TargetWindow = {
  cgWindowId: 5,
  app: 'GameOverlayViewService',
  bundleId: 'com.apple.GameOverlayUI',
  title: '',
  bounds: [430, 210, 700, 500]
}

describe('bringToFront', () => {
  it('raises the app by bundle id and passes when the target is on top', async () => {
    const helper = helperWith([chess])
    const res = await bringToFront(chess, helper, { selfCovers: () => false })
    expect(helper.activated).toEqual(['com.apple.Chess'])
    expect(res).toEqual({ ok: true, target: chess })
  })

  it('refuses while another app’s window overlaps the target', async () => {
    const res = await bringToFront(chess, helperWith([sheet, chess]), {
      selfCovers: () => false
    })
    expect(res).toEqual({
      ok: false,
      reason:
        'a window of "GameOverlayViewService" is in front of the Chess window'
    })
  })

  it('refuses when the app could not be made frontmost', async () => {
    const elsewhere = {
      ...sheet,
      bounds: [0, 0, 100, 100] as TargetWindow['bounds']
    }
    const res = await bringToFront(chess, helperWith([elsewhere, chess]), {
      selfCovers: () => false
    })
    expect(res).toEqual({ ok: false, reason: 'Chess is not the frontmost app' })
  })

  it('refuses when an Actovia window is over the target', async () => {
    const res = await bringToFront(chess, helperWith([chess]), {
      selfCovers: () => true
    })
    expect(res).toEqual({
      ok: false,
      reason: 'an Actovia window is in front of the Chess window'
    })
  })

  it('refuses when the window is not on screen', async () => {
    const res = await bringToFront(chess, helperWith([]), {
      selfCovers: () => false
    })
    expect(res).toEqual({
      ok: false,
      reason: 'the Chess window is not on screen'
    })
  })

  it('hands back the window at its current place', async () => {
    const moved = {
      ...chess,
      bounds: [10, 20, 800, 600] as TargetWindow['bounds']
    }
    const res = await bringToFront(chess, helperWith([moved]), {
      selfCovers: () => false
    })
    expect(res).toEqual({ ok: true, target: moved })
  })
})

describe('refreshOrRaise', () => {
  it('raises the app once when its window is on another Space', async () => {
    const helper = helperWith([], [chess])
    const out = await refreshOrRaise(chess, helper, 0)
    expect(helper.activated).toEqual(['com.apple.Chess'])
    expect(out.cgWindowId).toBe(1)
  })

  it('throws WindowGone when raising does not bring it back', async () => {
    const helper = helperWith([], [])
    await expect(refreshOrRaise(chess, helper, 0)).rejects.toBeInstanceOf(
      WindowGone
    )
  })

  it('does not raise a window that is on screen', async () => {
    const helper = helperWith([chess])
    await refreshOrRaise(chess, helper, 0)
    expect(helper.activated).toEqual([])
  })
})
