/**
 * E2E: asking about selected text. Text selected in an answer gets an "Ask
 * Actovia" button; the selection sits over the composer as a quote, is sent
 * with the next message, and is drawn as a quote in that message's bubble.
 * On the kernel's scripted provider.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('ask about selected text', () => {
  test.beforeEach(async ({ mainWindow: _mw }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providers: { openaiApiKey: 'faux' },
      providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' },
      memory: { useInChat: false, autoCapture: false }
    })
  })

  test('a selection becomes the quote of the next message', async ({
    mainWindow
  }) => {
    const composer = mainWindow.getByTestId(TEST_IDS.composer.textarea)
    await composer.fill('weather in Oslo')
    await composer.press('Enter')
    const answer = mainWindow.getByText('It is sunny in Oslo.')
    await expect(answer).toBeVisible({ timeout: 30_000 })

    // Select the answer's sentence the way a double-drag would.
    await answer.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    await mainWindow.getByTestId(TEST_IDS.chat.ask.button).click()
    const quote = mainWindow.getByTestId(TEST_IDS.composer.quote)
    await expect(quote).toContainText('It is sunny in Oslo.')

    // It can be let go of, and made again.
    await mainWindow.getByTestId(TEST_IDS.composer.quoteRemove).click()
    await expect(quote).toHaveCount(0)
    await answer.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await mainWindow.getByTestId(TEST_IDS.chat.ask.button).click()

    await composer.fill('and tomorrow?')
    await composer.press('Enter')

    const bubble = mainWindow
      .locator('[data-user-msg-id]')
      .filter({ hasText: 'and tomorrow?' })
    await expect(bubble.locator('blockquote')).toHaveText(
      'It is sunny in Oslo.'
    )
    await expect(quote).toHaveCount(0)
  })
})
