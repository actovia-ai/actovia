import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

const employeeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('Group commands, versioned brief editing and staff mentions', async ({
  mainWindow
}) => {
  const api = new ApiClient()
  const { data: group } = await api.post<{ id: string }>(
    '/api/v1/philharmonic/conversations',
    { title: 'Group controls' }
  )
  await mainWindow.route('**/api/v1/philharmonic/agents', (route) =>
    route.fulfill({
      json: [
        {
          id: employeeId,
          name: 'Avery',
          isActive: true,
          runtime: 'actovia',
          teamId: null
        }
      ]
    })
  )
  await mainWindow.evaluate((id) => {
    location.hash = `/philharmonic/groups/${id}`
  }, group.id)
  const input = mainWindow.getByTestId(TEST_IDS.philharmonicControls.input)
  await expect(input).toBeVisible()
  await input.fill('/brief')
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonicControls.menu)
  ).toBeVisible()
  await input.press('Enter')
  const brief = mainWindow.getByTestId(
    TEST_IDS.philharmonicControls.briefDialog
  )
  await expect(brief).toBeVisible()
  await brief.getByTestId(TEST_IDS.philharmonicControls.briefEdit).click()
  await brief
    .getByTestId(TEST_IDS.philharmonicControls.briefInput)
    .fill(
      '# Objective\nDeliver a reviewed report.\n\n## Constraints\nUse verified sources.'
    )
  await brief.getByTestId(TEST_IDS.philharmonicControls.briefSave).click()
  await expect(brief).toContainText('Deliver a reviewed report.')
  await brief.getByTestId(TEST_IDS.philharmonicControls.briefEdit).click()
  await brief
    .getByTestId(TEST_IDS.philharmonicControls.briefInput)
    .fill('Unwanted edit')
  await brief.getByTestId(TEST_IDS.philharmonicControls.briefReload).click()
  await expect(brief).toContainText('Deliver a reviewed report.')
  await mainWindow.keyboard.press('Escape')
  await mainWindow
    .getByTestId(TEST_IDS.philharmonicControls.briefButton)
    .click()
  await expect(brief).toContainText('Use verified sources.')
  await mainWindow.keyboard.press('Escape')

  await input.fill('@Av')
  await expect(
    mainWindow
      .getByTestId(TEST_IDS.philharmonicControls.option)
      .filter({ hasText: 'Avery' })
  ).toBeVisible()
  await input.press('Tab')
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonicControls.mention)
  ).toContainText('Avery')
  await input.fill('Review the acceptance criteria')
  let posted: Record<string, unknown> | undefined
  await mainWindow.route(
    `**/api/v1/philharmonic/conversations/${group.id}/messages`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      posted = route.request().postDataJSON()
      await route.fulfill({
        json: { id: 'sent', role: 'user', content: posted?.content }
      })
    }
  )
  await input.press('Enter')
  await expect.poll(() => posted?.mentionedAgentIds).toEqual([employeeId])
  await expect(input).toHaveValue('')
  await input.fill('/status')
  await mainWindow
    .getByTestId(TEST_IDS.philharmonicControls.option)
    .filter({ hasText: '/status' })
    .click()
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonic.resourcesPanel)
  ).toBeVisible()
})
