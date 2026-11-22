import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

/** Squirrel installs app-<version>/Actovia.exe next to Update.exe. */
export function isSquirrelInstallation(executable: string): boolean {
  return existsSync(
    win32.resolve(win32.dirname(executable), '..', 'Update.exe')
  )
}
