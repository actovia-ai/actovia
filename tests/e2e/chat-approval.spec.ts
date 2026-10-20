/**
 * E2E: the approval gate for secrets outside Actovia. The faux provider
 * (`faux-boot.ts`) answers `SECRET_READ_MESSAGE` with a `read_file` of
 * `~/.ssh/id_rsa` — under the fixture's scratch `$HOME` — which the kernel
 * pauses: the run's foot shows what it wants to read with Allow once / Deny,
 * and Deny settles it (the model reads "The user declined access to …" and
 * answers).
 */
import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import {
  SECRET_READ_MESSAGE,
  SECRET_READ_PATH
} from '../../src/main/lib/ai/kernel/faux-memory-fixtures'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('approval for a secret outside Actovia', () => {
  test('a sensitive read waits for the user; Deny declines it', async ({
    mainWindow
  }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providers: { openaiApiKey: 'faux' },
      providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' },
      memory: { useInChat: false, autoCapture: false }
    })

    const composer = mainWindow.getByTestId(TEST_IDS.composer.textarea)
    await composer.fill(SECRET_READ_MESSAGE)
    await composer.press('Enter')

    const card = mainWindow.getByTestId(TEST_IDS.chat.approval.card)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText(SECRET_READ_PATH)
    await expect(
      mainWindow.getByTestId(TEST_IDS.chat.approval.allow)
    ).toBeVisible()

    // A loopback caller other than this window (what a `curl` from the
    // model's terminal would be) cannot answer for the user.
    const forged = await fetch('http://localhost:60223/api/v1/chat/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'any',
        toolCallId: 'any',
        decision: 'allow'
      })
    })
    expect(forged.status).toBe(403)
    await expect(card).toBeVisible()

    await mainWindow.getByTestId(TEST_IDS.chat.approval.deny).click()

    const state = mainWindow.getByTestId(TEST_IDS.chat.approval.state)
    await expect(state).toHaveAttribute('data-state', 'denied')
    await expect(state).toContainText(SECRET_READ_PATH)
    await expect(card).toHaveCount(0)
    // The run goes on without the file.
    await expect(mainWindow.getByText('It is sunny in Oslo.')).toBeVisible({
      timeout: 30_000
    })
  })
})
