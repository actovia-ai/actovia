import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test('a group icon can be searched, saved and reloaded', async ({
  mainWindow
}) => {
  const group = await mainWindow.evaluate(async () => {
    const response = await fetch(
      'http://localhost:60223/api/v1/philharmonic/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Emoji acceptance' })
      }
    )
    return response.json()
  })
  await mainWindow.evaluate(() => {
    location.hash = '#/philharmonic'
  })
  const row = mainWindow.getByRole('button', { name: /Emoji acceptance/ })
  await row.click({ button: 'right' })
  await mainWindow.getByTestId(TEST_IDS.philharmonic.changeIcon).click()
  const picker = mainWindow.getByTestId(TEST_IDS.philharmonic.emojiPicker)
  await picker.getByRole('searchbox').fill('rocket')
  await mainWindow.screenshot({ path: '/tmp/actovia-emoji-search.png' })
  await picker.getByTestId(TEST_IDS.philharmonic.emojiOption).first().click()
  await expect(picker).toBeHidden()
  await expect(row).toContainText('🚀')
  await mainWindow.reload()
  await expect(row).toContainText('🚀')
  expect(
    await mainWindow.evaluate(async (id) => {
      const rows = await (
        await fetch('http://localhost:60223/api/v1/philharmonic/conversations')
      ).json()
      return rows.find((row: { id: string; icon: string }) => row.id === id)
        ?.icon
    }, group.id)
  ).toBe('🚀')
})
