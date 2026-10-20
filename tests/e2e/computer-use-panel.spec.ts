import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
/**
 * E2E: the in-chat ComputerUseCard for a running `computerUse` session.
 *
 * Unrunnable in CI / the sandbox — a real session needs macOS TCC screen +
 * accessibility grants, the `actovia-input` Swift helper, a live Claude key and
 * an allowlisted target app on screen. Kept as an executable description of the
 * panel contract so the flow is documented and the two interactive test-ids
 * (`stopButton`, `continueButton`) stay linked to a spec.
 *
 * Manual acceptance (run once, by hand, after granting permissions):
 *  1. Settings → Computer Use → enable, add "Chess" (or any open app) to the
 *     allowlist.
 *  2. In chat: "Use computer use to make one move in Chess."
 *  3. A ComputerUseCard appears under the assistant message and updates each
 *     step: header shows "step N", a thumbnail of the window, the last action.
 *  4. While it runs, the card shows a Stop button
 *     (`TEST_IDS.computerUse.stopButton`) — clicking it POSTs
 *     /api/v1/computer-use/abort and the session ends with outcome "aborted".
 *  5. If the agent calls askHuman, the card shows the question, a text input,
 *     and a "Done — continue" button (`TEST_IDS.computerUse.continueButton`)
 *     that POSTs /api/v1/computer-use/answer with the session id carried on the
 *     streamed frame.
 *  6. On completion the card shows the one-line summary, the outcome, and a
 *     "session: <sessionId>" line.
 */
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Computer Use — chat panel', () => {
  test.skip(
    true,
    'requires macOS screen/AX grants, the actovia-input helper, a live model key and an on-screen target app'
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
