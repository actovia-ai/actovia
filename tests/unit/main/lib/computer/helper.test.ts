import type { HelperCommand } from '@main/lib/computer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// helper.ts branches on `@electron-toolkit/utils` `is.dev` to resolve the
// binary path; that package transitively imports electron. Mock both per the
// CLAUDE.md test convention for main-process code.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/repo' }
}))

const { getHelper, mockHelper, realHelper, serialize } =
  await import('@main/lib/computer/helper')

beforeEach(() => {
  mockHelper.__reset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('serialize', () => {
  it('produces the newline-delimited JSON actovia-input expects', () => {
    expect(serialize([{ op: 'move', x: 1, y: 2 }])).toBe(
      '{"op":"move","x":1,"y":2}\n'
    )
  })

  it('emits one line per command with a trailing newline', () => {
    const commands: HelperCommand[] = [
      { op: 'move', x: 10, y: 20 },
      { op: 'down', button: 'left' },
      { op: 'up', button: 'left' },
      { op: 'wheel', dx: 0, dy: -3 },
      { op: 'key', code: 8, down: true }
    ]
    expect(serialize(commands)).toBe(
      '{"op":"move","x":10,"y":20}\n' +
        '{"op":"down","button":"left"}\n' +
        '{"op":"up","button":"left"}\n' +
        '{"op":"wheel","dx":0,"dy":-3}\n' +
        '{"op":"key","code":8,"down":true}\n'
    )
  })

  it('returns an empty string for no commands', () => {
    expect(serialize([])).toBe('')
  })
})

describe('mockHelper', () => {
  it('records send() calls (commands + clamp) on mockHelper.sent', async () => {
    await mockHelper.send([{ op: 'move', x: 1, y: 2 }])
    await mockHelper.send([{ op: 'down', button: 'left' }], [0, 0, 800, 600])

    expect(mockHelper.sent).toEqual([
      [{ op: 'move', x: 1, y: 2 }],
      [{ op: 'down', button: 'left' }]
    ])
    expect(mockHelper.sentClamps).toEqual([undefined, [0, 0, 800, 600]])
  })

  it('stores a copy of the commands array, not the caller reference', async () => {
    const commands: HelperCommand[] = [{ op: 'move', x: 1, y: 2 }]
    await mockHelper.send(commands)
    commands.push({ op: 'up', button: 'left' })
    expect(mockHelper.sent[0]).toEqual([{ op: 'move', x: 1, y: 2 }])
  })

  it('returns canned windows set via __setWindows', async () => {
    const windows = [
      {
        cgWindowId: 42,
        app: 'Chess',
        bundleId: 'com.apple.Chess',
        title: 'Chess',
        bounds: [0, 0, 640, 480] as [number, number, number, number]
      }
    ]
    mockHelper.__setWindows(windows)
    expect(await mockHelper.listWindows()).toEqual(windows)
  })

  it('returns the canned screenshot buffer set via __setScreenshot', async () => {
    const buf = Buffer.from('fake-png-bytes')
    mockHelper.__setScreenshot(buf)
    expect(await mockHelper.screenshot(1)).toBe(buf)
  })

  it('records activate() calls, runs __onActivate, and returns the query as identity', async () => {
    mockHelper.__onActivate(() =>
      mockHelper.__setWindows([
        {
          cgWindowId: 9,
          app: 'Chess',
          bundleId: 'com.apple.Chess',
          title: 'Chess',
          bounds: [0, 0, 1, 1]
        }
      ])
    )
    const res = await mockHelper.activate('Chess')

    expect(res).toEqual({ bundleId: 'Chess', pid: 1 })
    expect(mockHelper.activated).toEqual(['Chess'])
    expect(await mockHelper.listWindows()).toHaveLength(1)
  })

  it('returns canned apps set via __setApps', async () => {
    const apps = [{ name: 'Chess', bundleId: 'com.apple.Chess', path: '/x' }]
    mockHelper.__setApps(apps)
    expect(await mockHelper.listApps()).toEqual(apps)
  })

  it('__reset clears recorded calls and canned values', async () => {
    mockHelper.__setWindows([
      {
        cgWindowId: 1,
        app: 'A',
        bundleId: 'a',
        title: '',
        bounds: [0, 0, 1, 1]
      }
    ])
    await mockHelper.send([{ op: 'move', x: 0, y: 0 }])
    mockHelper.__reset()

    expect(mockHelper.sent).toEqual([])
    expect(mockHelper.sentClamps).toEqual([])
    expect(mockHelper.activated).toEqual([])
    expect(await mockHelper.listWindows()).toEqual([])
    expect((await mockHelper.screenshot(1)).length).toBe(0)
    expect(await mockHelper.listApps()).toEqual([])
  })
})

describe('getHelper', () => {
  it('returns mockHelper when ACTOVIA_INPUT_MOCK is set', () => {
    vi.stubEnv('ACTOVIA_INPUT_MOCK', '1')
    expect(getHelper()).toBe(mockHelper)
  })

  it('treats any non-empty value as truthy', () => {
    vi.stubEnv('ACTOVIA_INPUT_MOCK', 'yes')
    expect(getHelper()).toBe(mockHelper)
  })

  it('returns realHelper when ACTOVIA_INPUT_MOCK is unset', () => {
    vi.stubEnv('ACTOVIA_INPUT_MOCK', '')
    expect(getHelper()).toBe(realHelper)
  })
})
