/**
 * E2E: the Context view (ISSUE-235) on the faux provider. After a send the
 * header's ring says how full the chat's context is, and opens the panel on
 * its Context section, a row per part.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('the chat context', () => {
  test.beforeEach(async ({ mainWindow: _mw }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providers: { openaiApiKey: 'faux' },
      providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' }
    })
  })

  test('the ring appears after a send and opens the Context section', async ({
    mainWindow
  }) => {
    const chatInput = mainWindow.locator(
      'textarea, [contenteditable="true"], [data-testid="chat-input"]'
    )
    await chatInput.first().waitFor({ state: 'visible', timeout: 10_000 })
    await chatInput.first().fill('weather in Oslo')
    await chatInput.first().press('Enter')
    await expect(mainWindow.getByText('It is sunny in Oslo.')).toBeVisible({
      timeout: 30_000
    })

    const ring = mainWindow.getByTestId(TEST_IDS.chat.header.contextRing)
    await expect(ring).toBeVisible({ timeout: 10_000 })
    await expect(ring).toHaveAttribute('aria-label', /Context \d+%/)
    await ring.click()

    const section = mainWindow.getByTestId(TEST_IDS.chat.panel.contextSection)
    await expect(section).toBeVisible()
    await expect(section).toContainText('Messages')
    await expect(section).toContainText('System prompt')
  })
})
