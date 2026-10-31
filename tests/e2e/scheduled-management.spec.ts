import { mkdirSync } from 'node:fs'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

const captureDir = '/tmp/actovia326-review'

test('Scheduled uses multi-turn Chat, edits the original task and recovers deleted origins', async ({
  mainWindow
}) => {
  test.setTimeout(90_000)
  const api = new ApiClient()
  await api.updateSettings({
    providers: { openaiApiKey: 'faux' },
    providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' },
    memory: { useInChat: false, autoCapture: false }
  })
  const composer = mainWindow.getByTestId(TEST_IDS.composer.textarea)
  const scheduled = mainWindow.getByTestId(TEST_IDS.chatLayout.scheduled)
  const recurring = () =>
    mainWindow.getByRole('tab', { name: 'Recurring', exact: true }).click()
  const tasks = () =>
    api.get<Array<{ id: string; title: string; input: { chatId: string } }>>(
      '/api/v1/philharmonic/tasks/recurring'
    )
  const send = async (text: string) => {
    await composer.fill(text)
    await composer.press('Enter')
  }
  await scheduled.click()
  await expect(mainWindow.getByTestId(TEST_IDS.schedule.page)).toBeVisible()
  await expect(
    mainWindow.getByTestId(TEST_IDS.schedule.createButton)
  ).toHaveCount(0)
  const scheduleComposer = mainWindow.getByTestId(TEST_IDS.schedule.composer)
  await expect(
    scheduleComposer.getByTestId(TEST_IDS.composer.textarea)
  ).toBeVisible()
  await expect(mainWindow.getByTestId(TEST_IDS.schedule.example)).toHaveCount(3)
  await composer.press('Enter')
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toBe('#/scheduled')
  await mainWindow.getByTestId(TEST_IDS.schedule.example).first().click()
  await expect(composer).toHaveValue(
    'Give me an AI news briefing every weekday at 9 AM.'
  )
  await expect(composer).toBeFocused()
  // Example selection is only a draft. The user sends it explicitly.
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toBe('#/scheduled')
  mkdirSync(captureDir, { recursive: true })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: `${captureDir}/scheduled-empty-light.png`
  })
  await composer.fill('Help me schedule a task.')
  await composer.dispatchEvent('compositionstart')
  await composer.press('Enter')
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toBe('#/scheduled')
  await composer.dispatchEvent('compositionend')
  await composer.press('Enter')
  await expect(mainWindow.getByRole('dialog')).toHaveCount(0)
  await expect(
    mainWindow.getByText('What should I do, and when should I run it?', {
      exact: true
    })
  ).toBeVisible()
  expect((await tasks()).data).toHaveLength(0)
  const firstChat = await mainWindow.evaluate(
    () => location.hash.split('/chat/')[1]
  )
  const messages = await api.get<Array<{ role: string; content: unknown }>>(
    `/api/v1/chat/${firstChat}`
  )
  expect(messages.data.filter((m) => m.role === 'user')).toHaveLength(1)
  expect(JSON.stringify(messages.data)).toContain(
    'Help me schedule this task: Help me schedule a task.'
  )
  const fields = {
    title: 'Morning research brief',
    description: 'Review recent developments and write a concise report.',
    cronExpression: '0 9 * * *'
  }
  await send(
    `Schedule test: ${JSON.stringify({ action: 'create', ...fields })}`
  )
  await expect.poll(async () => (await tasks()).data.length).toBe(1)
  const original = (await tasks()).data[0]
  await scheduled.click()
  await recurring()
  const card = mainWindow.getByTestId(TEST_IDS.schedule.taskCard)
  await expect(card).toContainText(fields.title)
  await expect(card.getByTestId(TEST_IDS.schedule.originLink)).toHaveAttribute(
    'href',
    `#/chat/${original.input.chatId}`
  )
  mkdirSync(captureDir, { recursive: true })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: `${captureDir}/scheduled-light.png`
  })
  await card.getByTestId(TEST_IDS.schedule.editButton).click()
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toBe(`#/chat/${original.input.chatId}`)
  await expect(composer).toHaveValue(/Help me edit this scheduled task/)
  await composer.press('Enter')
  await expect(
    mainWindow.getByText('Schedule saved. What would you like to change?', {
      exact: true
    })
  ).toHaveCount(2)
  await send(
    `Schedule test: ${JSON.stringify({ action: 'update', taskId: original.id, ...fields, title: 'Evening research brief', cronExpression: '0 18 * * *' })}`
  )
  await expect
    .poll(async () => (await tasks()).data[0]?.title)
    .toBe('Evening research brief')
  expect((await tasks()).data.map((t) => t.id)).toEqual([original.id])
  await api.delete(`/api/v1/chat/${original.input.chatId}`)
  await scheduled.click()
  await recurring()
  await expect(card.getByTestId(TEST_IDS.schedule.originDeleted)).toBeVisible()
  await card.getByTestId(TEST_IDS.schedule.editButton).click()
  await expect.poll(() => mainWindow.evaluate(() => location.hash)).toBe('#/')
  await composer.press('Enter')
  await expect(
    mainWindow.getByText('Schedule saved. What would you like to change?', {
      exact: true
    })
  ).toBeVisible()
  // Merely entering or discussing an edit never rebinds or duplicates the task.
  expect((await tasks()).data[0].input.chatId).toBe(original.input.chatId)
  await send(
    `Schedule test: ${JSON.stringify({ action: 'update', taskId: original.id, ...fields })}`
  )
  await expect
    .poll(async () => (await tasks()).data[0]?.input.chatId)
    .not.toBe(original.input.chatId)
  const adopted = (await tasks()).data[0]
  expect(adopted.id).toBe(original.id)
  await api.delete(`/api/v1/chat/${adopted.input.chatId}`)
  await scheduled.click()
  await recurring()
  await expect(card.getByTestId(TEST_IDS.schedule.originDeleted)).toBeVisible()
  await mainWindow.evaluate(() =>
    document.documentElement.classList.add('dark')
  )
  await mainWindow.setViewportSize({ width: 1000, height: 800 })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: `${captureDir}/scheduled-orphan-dark.png`
  })
  const dock = mainWindow.getByTestId(TEST_IDS.schedule.composer)
  expect(
    await dock.evaluate((el) => el.getBoundingClientRect().bottom)
  ).toBeLessThanOrEqual(800)
  await card.getByTestId(TEST_IDS.schedule.cancelButton).click()
  await expect(card).toHaveCount(0)
  expect((await tasks()).data).toHaveLength(0)
  await expect(mainWindow.getByTestId(TEST_IDS.schedule.example)).toHaveCount(3)
  await expect(
    mainWindow.getByText('Task cancelled', { exact: true })
  ).not.toBeVisible({ timeout: 10_000 })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: `${captureDir}/scheduled-empty-dark.png`
  })
  await mainWindow.setViewportSize({ width: 1000, height: 600 })
  const bounds = await mainWindow
    .getByTestId(TEST_IDS.schedule.composer)
    .boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600)
})

test('Philharmonic schedules link to their Group and expose no edit or delete actions', async ({
  mainWindow
}) => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await mainWindow.route('**/api/v1/philharmonic/conversations', (route) =>
    route.fulfill({ json: [{ id, title: 'Portfolio review' }] })
  )
  await mainWindow.route('**/api/v1/philharmonic/tasks/recurring', (route) =>
    route.fulfill({
      json: [
        {
          id: 'read-only',
          conversationId: id,
          title: 'Weekly portfolio review',
          status: 'pending',
          priority: 'medium',
          cronExpression: '0 9 * * 1',
          description: 'Review concentration and upcoming catalysts.'
        }
      ]
    })
  )
  await mainWindow.getByTestId(TEST_IDS.chatLayout.scheduled).click()
  await mainWindow.getByRole('tab', { name: 'Recurring', exact: true }).click()
  const card = mainWindow.getByTestId(TEST_IDS.schedule.taskCard)
  await expect(card).toContainText('Managed by Philharmonic')
  await expect(card.getByTestId(TEST_IDS.schedule.editButton)).toHaveCount(0)
  await expect(card.getByTestId(TEST_IDS.schedule.cancelButton)).toHaveCount(0)
  await expect(card.getByTestId(TEST_IDS.schedule.originLink)).toHaveAttribute(
    'href',
    `#/philharmonic/groups/${id}`
  )
  mkdirSync(captureDir, { recursive: true })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: `${captureDir}/scheduled-group.png`
  })
})
