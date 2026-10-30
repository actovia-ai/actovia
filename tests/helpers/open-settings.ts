import type { Page } from '@playwright/test'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'

/**
 * Open the Settings page, optionally a section of its left nav, named by its
 * `SettingsLabel` ("General", "AI Providers", "Computer Use", …) — matched on
 * the item's `data-tab`, not its accessible name, which also carries a badge
 * such as "Experimental". Uses the Cmd/Ctrl+, shortcut: the sidebar has no
 * Settings button (it lives in the account menu), which is what these specs'
 * old generic locators were looking for. The electron fixture releases the
 * composer's initial focus, so the shortcut is not swallowed.
 */
export async function openSettings(page: Page, section?: string) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+,`)
  await page.waitForURL(/#\/settings/, { timeout: 10_000 })
  if (section) {
    await page
      .locator(
        `[data-testid="${TEST_IDS.settings.navItem}"][data-tab="${section}"]`
      )
      .click()
  }
}
