import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'
import { openSettings } from '../helpers/open-settings'

test.describe('Settings — Computer Use', () => {
  test('renders the enable toggle and adds an allowlist target', async ({
    mainWindow
  }) => {
    // Its sidebar item reads "Computer Use Experimental" (the badge), so the
    // helper finds it by its tab, not its name.
    await openSettings(mainWindow, 'Computer Use')

    await expect(
      mainWindow.getByTestId(TEST_IDS.computerUse.enableToggle)
    ).toBeVisible()

    // The allowlist is a combobox of installed apps — type to filter, then
    // pick "Chess" from the dropdown (it's a stock macOS app, always present).
    const input = mainWindow.getByTestId(TEST_IDS.computerUse.allowlistInput)
    await input.click()
    await input.fill('Chess')
    await mainWindow.getByRole('option', { name: 'Chess' }).first().click()

    // Scope to the chip: the dropdown option with the same name may still be
    // on screen, and getByText('Chess') alone then matches both.
    await expect(
      mainWindow.locator('[data-slot="combobox-chip"]').getByText('Chess')
    ).toBeVisible()
  })
})
