/**
 * Capture real UI with example data, never the owner's app or credentials.
 * Build with `bun run test:e2e:web`, start `bun tests/browser/fixtures/server.ts`,
 * then: bun tests/browser/capture-docs.ts /absolute/path/to/homepage/public/docs/shots
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { chromium, expect } from '@playwright/test'

const output = process.argv[2]
if (!output) throw new Error('Pass the documentation screenshot directory.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      baseURL: 'http://localhost:63131',
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      reducedMotion: 'reduce'
    })
    await context.addInitScript(
      (value) => localStorage.setItem('vite-ui-theme', value),
      theme
    )
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const capture = async (id: string) => {
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight
        )
      ).toBe(true)
      await page
        .locator(':focus')
        .evaluateAll((elements) =>
          elements.forEach((element) => (element as HTMLElement).blur())
        )
      await page.mouse.move(0, 0)
      const box = (await page.locator('main > div').first().boundingBox())!
      await page.screenshot({
        path: resolve(output, `${id}${theme === 'dark' ? '-dark' : ''}.png`),
        animations: 'disabled',
        clip: {
          x: box.x - 24,
          y: box.y - 24,
          width: box.width + 48,
          height: box.height + 48
        }
      })
    }
    await page.request.post('/__test/reset')
    await page.goto('/__test/settings?computer-use')
    await expect(
      page.getByTestId(TEST_IDS.computerUse.browserMaxSteps)
    ).toHaveValue('100')
    await expect(page.getByText('Notes', { exact: true })).toBeVisible()
    await capture('settings-computer-use')

    await page.goto('/__test/settings')
    await expect(page.getByTestId(TEST_IDS.webAccess.enabled)).toBeEnabled()
    if (
      (await page
        .getByTestId(TEST_IDS.webAccess.enabled)
        .getAttribute('aria-checked')) !== 'true'
    ) {
      await page.getByTestId(TEST_IDS.webAccess.enabled).click()
    }
    await page
      .getByTestId(TEST_IDS.webAccess.origin)
      .fill('https://your-mac.example.ts.net')
    if (await page.getByTestId(TEST_IDS.webAccess.save).isEnabled()) {
      await page.getByTestId(TEST_IDS.webAccess.save).click()
    }
    await expect(page.getByTestId(TEST_IDS.webAccess.pair)).toBeEnabled()
    await capture('settings-web-access')

    await page.goto('/')
    await page.getByTestId(TEST_IDS.webTerminal.name).fill('Work browser')
    await capture('web-pairing')
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    })
    const { code } = await (await page.request.post('/__test/pair')).json()
    await page.getByTestId(TEST_IDS.webTerminal.code).fill(code)
    await page.getByTestId(TEST_IDS.webTerminal.connect).click()
    await expect(page.getByTestId(TEST_IDS.composer.textarea)).toBeVisible()
    await page.goto('/#/settings?tab=devices')
    await page.getByTestId(TEST_IDS.webTerminal.lock).click()
    await expect(page.getByTestId(TEST_IDS.webTerminal.name)).toHaveCount(0)
    await expect(page.getByTestId(TEST_IDS.webTerminal.connect)).toBeVisible()
    await capture('web-unlock')
    expect(errors).toEqual([])
    await context.close()
  }
} finally {
  await browser.close()
}
