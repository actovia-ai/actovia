/**
 * E2E: the Artifacts page (ISSUE-237), reached from the sidebar. A fresh
 * data dir has made none, so the page shows its empty state: no cards and
 * no search box. Then, on the scripted provider, a chat makes one after a
 * long answer: the page draws it (ISSUE-265) and opens the chat at its card,
 * not at the run's top.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import {
  ARTIFACT_CALL,
  ARTIFACT_GREETING,
  ARTIFACT_QUESTION
} from '../../src/main/lib/ai/kernel/faux-memory-fixtures'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

const ANSWER_TIMEOUT = 30_000

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

  test('a chat’s page is drawn on its card and opens at it', async ({
    mainWindow
  }) => {
    await new ApiClient().updateSettings({
      providers: { openaiApiKey: 'faux' },
      providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' },
      memory: { useInChat: false, autoCapture: false }
    })
    const composer = mainWindow.getByTestId(TEST_IDS.composer.textarea)
    await composer.fill(ARTIFACT_QUESTION)
    await composer.press('Enter')
    await expect(mainWindow.locator('[data-artifact-call]')).toHaveCount(1, {
      timeout: ANSWER_TIMEOUT
    })

    await mainWindow.getByTestId(TEST_IDS.chatLayout.artifacts).click()
    const card = mainWindow.getByTestId(TEST_IDS.artifacts.card)
    await expect(card).toHaveText(ARTIFACT_CALL.title, { timeout: 10_000 })
    const preview = mainWindow.getByTestId(TEST_IDS.artifacts.preview)
    await expect(preview).toHaveAttribute('data-state', 'rendered', {
      timeout: 15_000
    })
    await expect(
      mainWindow
        .frameLocator(`[data-testid="${TEST_IDS.artifacts.preview}"]`)
        .getByText(ARTIFACT_GREETING)
    ).toBeVisible()

    // The card's page is a picture: clicking anywhere on it opens the chat.
    await preview.click({ force: true })
    const chatCard = mainWindow.locator('[data-artifact-call]')
    await expect(chatCard).toBeInViewport({ timeout: 10_000 })
    await expect(
      mainWindow.locator('[data-user-msg-id]', { hasText: ARTIFACT_QUESTION })
    ).not.toBeInViewport()
  })
})
