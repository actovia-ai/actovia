import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`chat reading and file diffs remain readable in ${theme}`, async ({
    page,
    context
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(
      (value) => localStorage.setItem('vite-ui-theme', value),
      theme
    )
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize({ width: 1100, height: 1150 })
    await page.goto('/__test/settings?reading')
    const article = page.locator('[data-reading-example] > .markdown')
    await expect(article).toBeVisible()
    await expect(article).toHaveCSS('font-size', '14px')
    await expect(article).toHaveCSS('line-height', '25.2px')
    await expect(article.locator('p').first()).toHaveCSS('font-weight', '400')
    await expect(article).toHaveCSS('width', '704px')
    const diff = page.locator('[data-slot="code-diff"]').first()
    await expect(diff.locator('figcaption')).toContainText(
      'pnpm-workspace.yaml'
    )
    await expect(diff.locator('[data-diff-line="added"]')).toContainText('15')
    await expect(diff.locator('[data-diff-line="removed"]')).toContainText('15')
    const groupDiff = page.locator(
      '[data-message-id="reading-pm"] [data-slot="code-diff"]'
    )
    await expect(groupDiff.locator('[data-diff-line="added"]')).toHaveCount(4)
    await expect(groupDiff.locator('figcaption')).toContainText('+4')
    await expect(groupDiff.locator('figcaption')).not.toContainText('−0')
    await expect(groupDiff.locator('code[data-numbered]')).toHaveCount(0)
    await expect(groupDiff.locator('pre')).toHaveCSS('font-weight', '400')
    await groupDiff.screenshot({
      path: testInfo.outputPath(`diff-fragment-${theme}.png`),
      animations: 'disabled'
    })
    await expect(page.locator('pre figure')).toHaveCount(0)
    await diff.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('@@ -14,3 +14,3 @@')
    await page.screenshot({
      path: testInfo.outputPath(`reading-${theme}.png`),
      fullPage: true,
      animations: 'disabled'
    })
    for (const width of [600, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      const codeScrolls = await article
        .locator('pre:not([aria-label]) > div')
        .last()
        .evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(codeScrolls).toBe(true)
    }
    await page.screenshot({
      path: testInfo.outputPath(`reading-${theme}-narrow.png`),
      fullPage: true,
      animations: 'disabled'
    })
    await page.evaluate(
      () => (document.documentElement.style.fontSize = '200%')
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(errors).toEqual([])
  })
}
