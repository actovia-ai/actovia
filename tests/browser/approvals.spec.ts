import { expect, test } from '@playwright/test'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'

for (const theme of ['light', 'dark']) {
  test(`approval remains actionable outside the folded timeline in ${theme}`, async ({
    page
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(
      (value) => localStorage.setItem('vite-ui-theme', value),
      theme
    )
    await page.route('**/api/**', async (route) => {
      if (route.request().url().endsWith('/chat/approval')) {
        expect(route.request().postDataJSON()).toEqual({
          runId: 'approval-run',
          toolCallId: 'approval-call',
          decision: 'deny'
        })
        await route.fulfill({ json: { outcome: 'denied' } })
      } else {
        await route.fulfill({ json: {} })
      }
    })
    await page.setViewportSize({ width: 1100, height: 900 })
    await page.goto('/__test/settings?approvals')
    const card = page.getByTestId(TEST_IDS.chat.approval.card)
    const timeline = page.getByTestId(TEST_IDS.chat.timelineToggle)
    await expect(card).toBeVisible()
    await expect(timeline).toHaveAttribute('aria-expanded', 'false')
    await expect(timeline).toContainText('Waiting for your approval')
    await expect(card.locator('code')).toContainText('cat ~/.aws/credentials')
    await expect(page.getByTestId(TEST_IDS.chat.approval.allow)).toBeEnabled()
    for (const width of [1100, 360]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await expect(
        page.getByTestId(TEST_IDS.chat.approval.deny)
      ).toBeInViewport()
      await page.screenshot({
        path: testInfo.outputPath(`pending-${theme}-${width}.png`),
        fullPage: true,
        animations: 'disabled'
      })
    }
    await page.getByTestId(TEST_IDS.chat.approval.deny).click()
    const state = page.getByTestId(TEST_IDS.chat.approval.state)
    await expect(state).toHaveAttribute('data-state', 'denied')
    await expect(card).toHaveCount(0)
    await expect(timeline).not.toContainText('Waiting for your approval')
    await expect(state.locator('pre')).not.toBeVisible()
    const details = page.getByTestId(TEST_IDS.chat.approval.details)
    await details.focus()
    await page.keyboard.press('Enter')
    await expect(state.locator('pre')).toBeVisible()
    await expect(state.locator('pre')).toContainText('cat ~/.aws/credentials')
    await page.keyboard.press('Tab')
    await expect(state.locator('pre')).toBeFocused()
    await details.click()
    await page.screenshot({
      path: testInfo.outputPath(`settled-${theme}.png`),
      fullPage: true,
      animations: 'disabled'
    })
    expect(errors).toEqual([])
  })
}
