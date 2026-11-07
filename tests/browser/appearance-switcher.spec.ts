import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { expect, test } from '@playwright/test'

test('appearance previews select, persist, follow the OS and support the keyboard', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.addInitScript(() => {
    if (!localStorage.getItem('vite-ui-theme'))
      localStorage.setItem('vite-ui-theme', 'light')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/__test/settings?color-tone')
  await page.getByTestId(`${TEST_IDS.settings.colorTone}-blue`).click()

  const light = page.getByRole('radio', { name: 'Light', exact: true })
  const dark = page.getByRole('radio', { name: 'Dark', exact: true })
  const system = page.getByRole('radio', { name: 'System', exact: true })
  await expect(light).toBeChecked()
  await page.getByTestId(`${TEST_IDS.settings.themeMode}-dark`).click()
  await expect(dark).toBeChecked()
  await expect(page.locator('html')).toHaveClass('dark')
  expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe(
    'dark'
  )
  await page.mouse.move(0, 0)
  await page.screenshot({
    path: testInfo.outputPath('appearance-dark.png'),
    animations: 'disabled'
  })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByTestId(`${TEST_IDS.settings.themeMode}-system`).click()
  await expect(system).toBeChecked()
  await expect(page.locator('html')).toHaveClass('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveClass('light')

  await system.focus()
  await system.press('ArrowRight')
  await expect(light).toBeChecked()
  await light.press('ArrowRight')
  await expect(dark).toBeChecked()
  await expect(page.locator('html')).toHaveClass('dark')

  // A fresh mount must adopt the saved mode rather than just changing the picture.
  await page.reload()
  await expect(dark).toBeChecked()
  await expect(page.locator('html')).toHaveClass('dark')
  await page.getByTestId(`${TEST_IDS.settings.themeMode}-light`).click()
  await page.getByTestId(`${TEST_IDS.settings.colorTone}-emerald`).click()
  await expect(page.locator('html')).toHaveClass('light')
  await page.mouse.move(0, 0)
  await page.screenshot({
    path: testInfo.outputPath('appearance-light.png'),
    animations: 'disabled'
  })
  await page.setViewportSize({ width: 980, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await expect(
    page.getByTestId(`${TEST_IDS.settings.themeMode}-dark`)
  ).toBeInViewport()
  expect(errors).toEqual([])
})
