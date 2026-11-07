import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { expect, test } from '@playwright/test'

const tones = [
  'neutral',
  'emerald',
  'blue',
  'violet',
  'rose',
  'orange',
  'yellow'
]

for (const theme of ['light', 'dark']) {
  test(`color tone keeps ${theme} surfaces and sidebar independent of the accent`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.addInitScript(
      (value) => localStorage.setItem('vite-ui-theme', value),
      theme
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/__test/settings?color-tone')
    await expect(page.locator('html')).toHaveClass(theme)
    const card = page.locator('[data-slot="card"]').first()
    const active = page.getByTestId(TEST_IDS.settings.navItem).first()
    const idle = page.getByTestId(TEST_IDS.settings.navItem).nth(1)
    const link = page.getByRole('button', { name: 'Learn more', exact: true })
    await expect(card).toBeVisible()
    const surfaces = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return [
          '--background',
          '--card',
          '--popover',
          '--sidebar',
          '--foreground',
          '--muted',
          '--accent',
          '--border',
          '--chart-1'
        ].map((name) => style.getPropertyValue(name))
      })
    const baseline = await surfaces()
    const sidebar = page.locator('[data-slot="sidebar"]').first()
    const sidebarPalette = () =>
      sidebar.evaluate((element) => {
        const style = getComputedStyle(element)
        return [
          '--primary',
          '--primary-ink',
          '--selected',
          '--ring',
          '--sidebar-primary',
          '--sidebar-ring'
        ].map((name) => style.getPropertyValue(name))
      })
    const neutralSidebar = await sidebarPalette()
    let neutralHover = ''
    let neutralSelection = ''
    for (const tone of tones) {
      await page.getByTestId(`${TEST_IDS.settings.colorTone}-${tone}`).click()
      await expect(page.locator('html')).toHaveAttribute('data-tone', tone)
      expect(await surfaces()).toEqual(baseline)
      expect(await sidebarPalette()).toEqual(neutralSidebar)
      await idle.hover()
      // Wait for the actual transition rather than sampling its first frame.
      await page.waitForTimeout(200)
      const hover = await idle.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
      if (tone === 'neutral') neutralHover = hover
      else expect(hover).toBe(neutralHover)
      const selected = await active.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
      if (tone === 'neutral') neutralSelection = selected
      else expect(selected).toBe(neutralSelection)
      expect(
        await link.evaluate((element) => getComputedStyle(element).color)
      ).not.toBe('')
      if (['blue', 'emerald', 'yellow'].includes(tone)) {
        await page.mouse.move(0, 0)
        await page
          .locator(':focus')
          .evaluateAll((elements) =>
            elements.forEach((element) => (element as HTMLElement).blur())
          )
        await page.screenshot({
          path: testInfo.outputPath(`color-tone-${tone}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
    // Links must use readable ink rather than the yellow button fill.
    const ink = await link.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--primary-ink)'
      document.body.append(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      return { actual: getComputedStyle(element).color, expected }
    })
    expect(ink.actual).toBe(ink.expected)
    expect(errors).toEqual([])
  })
}
