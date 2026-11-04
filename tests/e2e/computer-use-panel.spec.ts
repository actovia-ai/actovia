import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
/** Legacy screenshot cards remain readable in old transcripts. New upstream
 * automation appears in the standard tool activity. This historical card's
 * Stop/continue controls are retained for persisted V0 messages only. */
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Computer Use — chat panel', () => {
  test.skip(
    true,
    'legacy screenshot-loop message fixture; current automation uses upstream CLI activity'
  )

  test('streams step updates and exposes Stop + continue controls', async ({
    mainWindow
  }) => {
    // Documented shape only — not executed. See the file header for the manual
    // acceptance walkthrough.
    const stop = mainWindow.getByTestId(TEST_IDS.computerUse.stopButton)
    const continueBtn = mainWindow.getByTestId(
      TEST_IDS.computerUse.continueButton
    )

    await expect(stop).toBeVisible()
    await stop.click()

    // After an askHuman step the continue control drives the answer POST.
    await expect(continueBtn).toBeVisible()
    await continueBtn.click()
  })
})
