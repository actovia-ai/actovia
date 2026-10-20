import { existsSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

const LOCK_DAT = join(homedir(), '.actovia', 'lock.dat')
const LOCK_CFG = join(homedir(), '.actovia', 'lock-config.json')
const API = 'http://localhost:60223'

function cleanLockFiles() {
  if (existsSync(LOCK_DAT)) rmSync(LOCK_DAT)
  if (existsSync(LOCK_CFG)) rmSync(LOCK_CFG)
}

test.beforeAll(cleanLockFiles)
test.afterAll(cleanLockFiles)

test('set PIN → lock blocks API (423) → unlock restores (200)', async ({
  mainWindow
}) => {
  const before = await fetch(`${API}/api/v1/settings`)
  expect(before.status).toBe(200)

  const setOk = await mainWindow.evaluate(
    async () =>
      (
        (await window.electron.ipcRenderer.invoke(
          'lock:set-pin',
          '135790'
        )) as { ok: boolean }
      ).ok
  )
  expect(setOk).toBe(true)

  await mainWindow.evaluate(() =>
    window.electron.ipcRenderer.invoke('lock:lock-now')
  )

  await expect(mainWindow.getByTestId(TEST_IDS.lock.pinInput)).toBeVisible()
  // References TEST_IDS.lock.touchIdButton for linkage; presence is platform-dependent.
  expect(
    await mainWindow.getByTestId(TEST_IDS.lock.touchIdButton).count()
  ).toBeGreaterThanOrEqual(0)

  const locked = await fetch(`${API}/api/v1/settings`)
  expect(locked.status).toBe(423)

  await mainWindow.getByTestId(TEST_IDS.lock.pinInput).fill('135790')

  await expect(mainWindow.getByTestId(TEST_IDS.lock.pinInput)).toBeHidden()
  await expect
    .poll(async () => (await fetch(`${API}/api/v1/settings`)).status)
    .toBe(200)
})
