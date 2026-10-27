/**
 * E2E: the Artifacts page (ISSUE-237), reached from the sidebar. A fresh
 * data dir has made none, so the page shows its empty state: no cards and
 * no search box.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Artifacts', () => {
  test('the sidebar opens the page', async ({ mainWindow }) => {
    await mainWindow.getByTestId(TEST_IDS.chatLayout.artifacts).click()
    await expect(mainWindow.getByTestId(TEST_IDS.artifacts.page)).toBeVisible({
      timeout: 10_000
    })
    await expect
      .poll(() => mainWindow.evaluate(() => window.location.hash))
      .toContain('artifacts')
    await expect(mainWindow.getByTestId(TEST_IDS.artifacts.card)).toHaveCount(0)
    await expect(mainWindow.getByTestId(TEST_IDS.artifacts.search)).toHaveCount(
      0
    )
  })
})
