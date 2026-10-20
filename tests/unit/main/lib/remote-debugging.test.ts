import { refuseRemoteDebugging } from '@main/lib/remote-debugging'
import { describe, expect, it, vi } from 'vitest'

function env(
  over: { isPackaged?: boolean; argv?: string[]; switches?: string[] } = {}
) {
  const switches = new Set(over.switches ?? [])
  return {
    isPackaged: over.isPackaged ?? true,
    argv: over.argv ?? ['/Applications/Actovia.app/Contents/MacOS/Actovia'],
    commandLine: {
      hasSwitch: vi.fn((name: string) => switches.has(name)),
      removeSwitch: vi.fn((name: string) => {
        switches.delete(name)
      })
    },
    exit: vi.fn(),
    log: vi.fn()
  }
}

describe('refuseRemoteDebugging', () => {
  it.each([
    ['remote-debugging-port'],
    ['remote-debugging-pipe'],
    ['remote-debugging-address']
  ])('a packaged build with --%s exits', (name) => {
    const e = env({ switches: [name] })
    expect(refuseRemoteDebugging(e)).toBe(true)
    expect(e.exit).toHaveBeenCalledWith(1)
    expect(e.commandLine.removeSwitch).toHaveBeenCalledWith(name)
    expect(e.log).toHaveBeenCalledOnce()
  })

  it.each([
    '--remote-debugging-port=9222',
    '-remote-debugging-port=9222',
    '--remote-debugging-pipe',
    '--REMOTE-DEBUGGING-ADDRESS=0.0.0.0'
  ])('a relaunch passing %s in argv exits', (arg) => {
    const e = env({ argv: ['/x/Actovia', arg] })
    expect(refuseRemoteDebugging(e)).toBe(true)
    expect(e.exit).toHaveBeenCalledWith(1)
  })

  it('a packaged build without them starts, switches still stripped', () => {
    const e = env({ argv: ['/x/Actovia', '--remote-debugging-portfolio'] })
    expect(refuseRemoteDebugging(e)).toBe(false)
    expect(e.exit).not.toHaveBeenCalled()
    expect(e.commandLine.removeSwitch).toHaveBeenCalledTimes(3)
  })

  it('a dev build is left alone (DevTools and debugging unchanged)', () => {
    const e = env({
      isPackaged: false,
      switches: ['remote-debugging-port'],
      argv: ['electron', '--remote-debugging-port=9222']
    })
    expect(refuseRemoteDebugging(e)).toBe(false)
    expect(e.exit).not.toHaveBeenCalled()
    expect(e.commandLine.removeSwitch).not.toHaveBeenCalled()
  })
})
