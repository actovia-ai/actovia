import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
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

test('the group menu copies its own ID while another group is active', async ({
  electronApp,
  mainWindow
}) => {
  const api = new ApiClient()
  const { data: target } = await api.post<{ id: string }>(
    '/api/v1/philharmonic/conversations',
    { title: 'Copy target' }
  )
  await api.post('/api/v1/philharmonic/conversations', {
    title: 'Active group'
  })
  await mainWindow.evaluate(() => {
    location.hash = '#/philharmonic'
  })
  const active = mainWindow.getByRole('button', { name: /Active group/u })
  await active.click()
  await expect(active).toHaveClass(/(?:^|\s)bg-sidebar-accent(?:\s|$)/u)
  const row = mainWindow.getByRole('button', { name: /Copy target/u })
  await row.click({ button: 'right' })
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonic.changeIcon).locator('svg')
  ).toHaveCount(1)
  await expect(
    mainWindow
      .getByTestId(TEST_IDS.philharmonic.copyConversationId)
      .locator('svg')
  ).toHaveCount(1)
  await mainWindow.screenshot({
    animations: 'disabled',
    path: '/tmp/actovia-group-menu-light.png'
  })
  await mainWindow.evaluate(() =>
    document.documentElement.classList.add('dark')
  )
  await mainWindow.screenshot({
    animations: 'disabled',
    path: '/tmp/actovia-group-menu-dark.png'
  })
  await electronApp.evaluate(({ clipboard }) =>
    clipboard.writeText('before-copy')
  )
  await mainWindow.getByTestId(TEST_IDS.philharmonic.copyConversationId).click()
  await expect
    .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(target.id)
  await expect(
    mainWindow.getByText('Conversation ID copied', { exact: true })
  ).toBeVisible()
  await expect(active).toHaveClass(/(?:^|\s)bg-sidebar-accent(?:\s|$)/u)
})
