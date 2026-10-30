/**
 * E2E: a whole conversation with a tool call, on the kernel's scripted
 * provider — no API key. The electron fixture starts the app with
 * `ACTOVIA_FAUX_PROVIDER=1` (`src/main/lib/ai/kernel/faux-boot.ts`): every
 * send is answered with a call to `weather` for Oslo, then "It is sunny in
 * Oslo." This is the base for all chat e2e from here on; the specs that need
 * a real model stay behind their key.
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('chat on the faux provider', () => {
  // The provider picker in Settings still wants a configured provider; the
  // faux model is handed out regardless of what is configured.
  test.beforeEach(async ({ mainWindow: _mw }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providers: { openaiApiKey: 'faux' },
      providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' }
    })
  })

  test('a send runs a tool call and renders one assistant message', async ({
    mainWindow
  }) => {
    const chatInput = mainWindow.locator(
      'textarea, [contenteditable="true"], [data-testid="chat-input"]'
    )
    await chatInput.first().waitFor({ state: 'visible', timeout: 10_000 })
    await chatInput.first().fill('weather in Oslo')
    await chatInput.first().press('Enter')

    // The body: the run's final text.
    await expect(mainWindow.getByText('It is sunny in Oslo.')).toBeVisible({
      timeout: 30_000
    })
    // The timeline step for the tool call ("Weather: Oslo"): a settled run's
    // timeline is one closed line ("Worked"), and opens on its steps.
    const timeline = mainWindow.getByTestId(TEST_IDS.chat.timelineToggle)
    await expect(timeline).toHaveCount(1)
    await timeline.click()
    await expect(timeline).toHaveAttribute('aria-expanded', 'true')
    await expect(mainWindow.getByText('Weather: Oslo').first()).toBeVisible()
    // One action bar (copy / regenerate) for the whole run — the tool step and
    // the answer are one message, not two.
    await expect(
      mainWindow.getByTestId(TEST_IDS.chat.messageAction)
    ).toHaveCount(1)

    // The weather card is compact until Details opens it: the readings
    // grid has no height (and is inert) closed, and is visible open.
    const details = mainWindow.getByTestId(TEST_IDS.weatherCard.details)
    const readings = mainWindow.getByTestId(TEST_IDS.weatherCard.readings)
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(readings).not.toBeVisible()
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(readings).toBeVisible()
    await expect(readings).toContainText('Humidity')
  })

  test('a second send is a second run, each with its own message', async ({
    mainWindow
  }) => {
    const chatInput = mainWindow.locator(
      'textarea, [contenteditable="true"], [data-testid="chat-input"]'
    )
    await chatInput.first().waitFor({ state: 'visible', timeout: 10_000 })
    await chatInput.first().fill('weather in Oslo')
    await chatInput.first().press('Enter')
    await expect(
      mainWindow.getByTestId(TEST_IDS.chat.messageAction)
    ).toHaveCount(1, {
      timeout: 30_000
    })

    await chatInput.first().fill('and tomorrow?')
    await chatInput.first().press('Enter')
    await expect(
      mainWindow.getByTestId(TEST_IDS.chat.messageAction)
    ).toHaveCount(2, {
      timeout: 30_000
    })
  })
})
