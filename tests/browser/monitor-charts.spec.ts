import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { expect, test } from '@playwright/test'

for (const empty of [false, true]) {
  test(`Dashboard tooltips keep valid dates with ${empty ? 'no' : 'multiple'} plans`, async ({
    page
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/__test/settings?dashboard${empty ? '&empty' : ''}`)
    const charts = page.getByTestId(TEST_IDS.philharmonic.monitorCharts)
    await expect(charts).toBeVisible()
    const plot = charts.locator('.recharts-wrapper')
    const bounds = (await plot.boundingBox())!
    const tooltip = charts.locator('.recharts-tooltip-wrapper')
    const days = charts.locator(
      '.recharts-cartesian-axis-tick-value[orientation="bottom"]'
    )
    await expect(days).toHaveCount(7)
    for (let index = 0; index < 7; index++) {
      const tick = (await days.nth(index).boundingBox())!
      await page.mouse.move(
        tick.x + tick.width / 2,
        bounds.y + bounds.height / 2
      )
      const date = new Date()
      date.setDate(date.getDate() - 6 + index)
      const label = new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
      }).format(date)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(label)
      await expect(tooltip).toContainText('Completed')
    }
    await page.mouse.move(0, 0)
    await expect(tooltip).not.toBeVisible()
    expect(errors).toEqual([])
  })
}
