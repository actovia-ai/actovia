import { spawn } from 'node:child_process'
import path from 'node:path'

import { electronTest as test, expect } from '../fixtures/electron'

/**
 * PGlite has no cross-process lock, so a second Exodus on the same data
 * directory must never get as far as opening the database (see
 * src/main/lib/single-instance.ts). Launch a real second process against the
 * running app's profile and check that it bows out.
 */
test.describe('Single instance', () => {
  test('a second launch exits at once and leaves the running app alone', async ({
    electronApp,
    mainWindow
  }) => {
    const appPath = path.resolve(__dirname, '../..')
    // Same profile as the fixture's instance — the lock is keyed on it.
    const userDataDir = path.join(process.env.HOME ?? '', 'user-data')
    // In Node (not inside Electron) the package resolves to the binary's path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronBinary = require('electron') as unknown as string

    const startedAt = Date.now()
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const second = spawn(
        electronBinary,
        [appPath, `--user-data-dir=${userDataDir}`],
        {
          env: {
            ...process.env,
            EXODUS_HOME: '',
            NODE_ENV: 'test',
            EXODUS_DISABLE_AUTO_UPDATE: '1'
          },
          stdio: 'ignore'
        }
      )
      const timer = setTimeout(() => {
        second.kill('SIGKILL')
        reject(new Error('the second instance was still running after 15s'))
      }, 15_000)
      second.on('error', reject)
      second.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    expect(exitCode).toBe(0)
    // Acknowledged by the running app, so it does not sit out the 8s it would
    // give a quitting one.
    expect(Date.now() - startedAt).toBeLessThan(6000)

    // The first instance is untouched: still one window, still serving.
    expect(electronApp.windows()).toHaveLength(1)
    await expect(mainWindow.locator('#root')).toBeVisible()
    const ping = await fetch('http://localhost:60223/')
    expect(await ping.text()).toContain('Actovia is running')
  })
})
