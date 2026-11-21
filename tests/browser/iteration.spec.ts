import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`iteration menus and unlimited limits work in ${theme}`, async ({
    page
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(
      (value) => localStorage.setItem('vite-ui-theme', value),
      theme
    )
    await page.goto('/__test/settings?iteration')
    const groupInput = page.getByTestId(TEST_IDS.philharmonicControls.input)
    await groupInput.fill('/sta')
    await expect(page.getByRole('option', { name: /\/status/ })).toBeVisible()
    await groupInput.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await groupInput.fill('@Av')
    await groupInput.press('Tab')
    await expect(
      page.getByTestId(TEST_IDS.philharmonicControls.mention)
    ).toContainText('Avery')
    const chat = page.getByTestId(TEST_IDS.composer.textarea)
    await chat.fill('/new')
    await expect(page.getByRole('option', { name: /\/new/ })).toBeVisible()
    await chat.press('Enter')
    await expect(chat).toHaveValue('')
    const unlimited = page.getByRole('switch', {
      name: 'PM tool calls per round: Unlimited',
      exact: true
    })
    await unlimited.click()
    await expect(unlimited).toBeChecked()
    await expect(
      page.getByTestId(TEST_IDS.philharmonicSettings.pmMaxToolCalls)
    ).toHaveCount(0)
    await page.setViewportSize({ width: 1100, height: 1100 })
    await page.screenshot({
      path: testInfo.outputPath(`iteration-${theme}.png`),
      animations: 'disabled',
      fullPage: true
    })
    expect(errors).toEqual([])
  })
}
