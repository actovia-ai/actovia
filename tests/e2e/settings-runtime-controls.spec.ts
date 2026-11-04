import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

test('Philharmonic and browser controls persist after a reload', async ({
  mainWindow
}) => {
  await openSettings(mainWindow, 'Philharmonic')
  const fields = [
    [TEST_IDS.philharmonicSettings.maxRunning, '3'],
    [TEST_IDS.philharmonicSettings.pmMaxToolCalls, '40'],
    [TEST_IDS.philharmonicSettings.staffMaxToolCalls, '30'],
    [TEST_IDS.philharmonicSettings.failureLimit, '2']
  ] as const
  for (const [id, value] of fields) {
    await mainWindow.getByTestId(id).fill(value)
    await mainWindow.getByTestId(id).blur()
    await expect
      .poll(async () => {
        const response = await mainWindow.request.get(
          'http://localhost:60223/api/v1/settings'
        )
        const data = await response.json()
        return JSON.stringify(data)
      })
      .toContain('philharmonic')
  }
  await mainWindow
    .getByTestId(TEST_IDS.philharmonicSettings.autoModelRouting)
    .uncheck()
  await mainWindow.screenshot({
    path: '/private/tmp/actovia-philharmonic-settings.png',
    animations: 'disabled'
  })
  await expect
    .poll(
      async () =>
        (
          await (
            await mainWindow.request.get(
              'http://localhost:60223/api/v1/settings'
            )
          ).json()
        ).agents?.philharmonic?.autoModelRouting
    )
    .toBe(false)
  await mainWindow.reload()
  for (const [id, value] of fields)
    await expect(mainWindow.getByTestId(id)).toHaveValue(value)
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonicSettings.autoModelRouting)
  ).not.toBeChecked()
  await mainWindow
    .locator(
      `[data-testid="${TEST_IDS.settings.navItem}"][data-tab="Computer Use"]`
    )
    .click()
  await mainWindow.getByTestId(TEST_IDS.computerUse.browserHeaded).check()
  await mainWindow.getByTestId(TEST_IDS.computerUse.browserMaxSteps).fill('20')
  await mainWindow.getByTestId(TEST_IDS.computerUse.browserMaxSteps).blur()
  await mainWindow.getByTestId(TEST_IDS.computerUse.browserEnabled).uncheck()
  await expect
    .poll(
      async () =>
        (
          await (
            await mainWindow.request.get(
              'http://localhost:60223/api/v1/settings'
            )
          ).json()
        ).computerUse?.browser?.enabled
    )
    .toBe(false)
  await mainWindow.reload()
  await expect(
    mainWindow.getByTestId(TEST_IDS.computerUse.browserHeaded)
  ).toBeChecked()
  await expect(
    mainWindow.getByTestId(TEST_IDS.computerUse.browserMaxSteps)
  ).toHaveValue('20')
  await expect(
    mainWindow.getByTestId(TEST_IDS.computerUse.browserEnabled)
  ).not.toBeChecked()
  await mainWindow.screenshot({
    path: '/private/tmp/actovia-browser-settings.png',
    animations: 'disabled'
  })
})
