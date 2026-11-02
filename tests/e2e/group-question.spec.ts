import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
/**
 * The PM's question to the owner is part of the group's record
 * (`group-questions.ts`): it is a card in the transcript, answered from the
 * card, and after the answer it stays — settled — with the answer under it,
 * also after a reload. The faux PM (`faux-boot.ts`) asks when it reads
 * `FAUX_GROUP_QUESTION`.
 */
import {
  FAUX_GROUP_QUESTION,
  FAUX_GROUP_QUESTION_ASKED
} from '../../src/main/lib/ai/kernel/faux-memory-fixtures'
import { electronTest as test, expect } from '../fixtures/electron'

test('the PM’s question is saved in the group, answered from its card', async ({
  mainWindow
}) => {
  const group = await mainWindow.evaluate(async () => {
    const response = await fetch(
      'http://localhost:60223/api/v1/philharmonic/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Question acceptance' })
      }
    )
    return (await response.json()) as { id: string }
  })
  await mainWindow.evaluate((id) => {
    location.hash = `/philharmonic/groups/${id}`
  }, group.id)

  const composer = mainWindow.getByPlaceholder(/Message Question acceptance/)
  await composer.fill(FAUX_GROUP_QUESTION)
  await composer.press('Enter')

  const card = mainWindow.getByTestId(TEST_IDS.philharmonic.questionCard)
  await expect(card).toHaveAttribute('data-status', 'pending')
  await expect(card).toContainText(FAUX_GROUP_QUESTION_ASKED)
  await expect(
    card.getByTestId(TEST_IDS.philharmonic.questionOption)
  ).toHaveCount(2)
  await expect(
    card.getByTestId(TEST_IDS.philharmonic.questionSend)
  ).toBeDisabled()
  await card.getByTestId(TEST_IDS.philharmonic.questionInput).fill('dev')
  await card.getByTestId(TEST_IDS.philharmonic.questionSend).click()

  await expect(card).toHaveAttribute('data-status', 'answered')
  await expect(
    card.getByTestId(TEST_IDS.philharmonic.questionInput)
  ).toHaveCount(0)
  // The PM carried on with the answer it was given.
  await expect(
    mainWindow.getByText(/Going ahead — User responded: dev/)
  ).toBeVisible()

  // The question and the answer are the group's: a reload draws them again.
  await mainWindow.reload()
  await expect(card).toHaveAttribute('data-status', 'answered')
  await expect(card).toContainText(FAUX_GROUP_QUESTION_ASKED)
})
