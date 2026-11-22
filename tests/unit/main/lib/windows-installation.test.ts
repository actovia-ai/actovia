import { describe, expect, it, vi } from 'vitest'

const exists = vi.hoisted(() => vi.fn())
vi.mock('node:fs', () => ({ existsSync: exists }))
const { isSquirrelInstallation } =
  await import('@main/lib/windows-installation')

describe('Windows installation detection', () => {
  it('checks the sibling Update.exe using Windows path semantics', () => {
    exists.mockReturnValue(true)
    expect(
      isSquirrelInstallation(
        'C:\\Users\\Test\\AppData\\Local\\actovia\\app-2.9.2\\Actovia.exe'
      )
    ).toBe(true)
    expect(exists).toHaveBeenCalledWith(
      'C:\\Users\\Test\\AppData\\Local\\actovia\\Update.exe'
    )
  })
  it('keeps NSIS installations on the modern updater', () => {
    exists.mockReturnValue(false)
    expect(
      isSquirrelInstallation(
        'C:\\Users\\Test\\AppData\\Local\\Programs\\Actovia\\Actovia.exe'
      )
    ).toBe(false)
  })
})
