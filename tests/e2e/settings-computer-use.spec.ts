import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

test('Computer Use offers unlimited steps without requiring an app allowlist', async ({
  mainWindow
}) => {
  await openSettings(mainWindow, 'Computer Use')
  await expect(
    mainWindow.getByTestId(TEST_IDS.computerUse.enableToggle)
  ).toBeVisible()
  await expect(
    mainWindow.getByText('Allowlisted apps', { exact: true })
  ).toHaveCount(0)
  const unlimited = mainWindow.getByRole('switch', {
    name: 'Max steps: Unlimited',
    exact: true
  })
  await unlimited.click()
  await expect(unlimited).toBeChecked()
  await expect(
    mainWindow.getByRole('spinbutton', { name: 'Max steps', exact: true })
  ).toHaveCount(0)
  await unlimited.click()
  await expect(
    mainWindow.getByRole('spinbutton', { name: 'Max steps', exact: true })
  ).toHaveValue('25')
})
