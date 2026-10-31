import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const time = '2026-10-31T09:00:00.000Z'
const group = {
  id: groupId,
  title: 'Portfolio refresh',
  icon: '',
  memberAgentIds: [],
  createdAt: time,
  updatedAt: time,
  lastMessageAt: time,
  latestMessage: null
}
const captures = '/tmp/actovia-six-review'

test('Group resources have fixed tabs and open the actual Markdown document', async ({
  mainWindow
}) => {
  const path = join(
    process.env.HOME!,
    '.actovia',
    'groups',
    groupId,
    'investment-rules.md'
  )
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(
    path,
    '# Investment rules\n\nReview concentration before adding a position.\n'
  )
  await mainWindow.route(
    '**/api/v1/philharmonic/conversations**',
    async (route) => {
      const pathname = new URL(route.request().url()).pathname
      const data = pathname.endsWith('/tool-results')
        ? [
            {
              id: 'e2',
              messageId: 'm1',
              createdAt: time,
              payload: {
                toolName: 'web_search',
                result: JSON.stringify([
                  { link: 'https://example.com', title: 'Research source' }
                ])
              }
            },
            {
              id: 'e1',
              messageId: 'm1',
              createdAt: time,
              payload: {
                toolName: 'write_file',
                result: JSON.stringify({ path })
              }
            }
          ]
        : pathname.endsWith('/messages')
          ? [
              {
                id: 'm1',
                conversationId: groupId,
                role: 'employee',
                agentId: null,
                content:
                  'The investment rules are ready.\n\n' +
                  'Review concentration, valuation and upcoming catalysts before changing a position.\n\n'.repeat(
                    35
                  ),
                parts: null,
                taskId: 't1',
                roundId: null,
                createdAt: time
              }
            ]
          : pathname.endsWith('/plan')
            ? null
            : [group]
      await route.fulfill({ json: data })
    }
  )
  await mainWindow.evaluate((id) => {
    location.hash = `/philharmonic/groups/${id}`
  }, groupId)
  await mainWindow.getByTestId(TEST_IDS.philharmonic.membersToggle).click()
  const panel = mainWindow.getByTestId(TEST_IDS.philharmonic.resourcesPanel)
  await expect(panel).toBeVisible()
  await expect(
    panel.getByTestId(TEST_IDS.philharmonic.resourcesTab)
  ).toHaveCount(3)
  await panel.locator('[data-section="files"]').click()
  await panel.getByRole('button', { name: /investment-rules.md/ }).click()
  const preview = mainWindow.getByTestId(TEST_IDS.chat.workspaceFile.preview)
  await expect(
    preview.getByRole('heading', { name: 'Investment rules', exact: true })
  ).toBeVisible()
  mkdirSync(captures, { recursive: true })
  await expect
    .poll(() => preview.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1')
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-document.png')
  })
  await mainWindow.keyboard.press('Escape')
  await panel.locator('[data-section="activity"]').click()
  await expect(
    panel.getByRole('link', { name: /Research source/ })
  ).toBeVisible()
  await expect(panel.locator('[data-section="activity"]')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-activity.png')
  })
  await mainWindow.setViewportSize({ width: 1000, height: 800 })
  await mainWindow.evaluate(() =>
    document.documentElement.classList.add('dark')
  )
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-activity-compact-dark.png')
  })
  const header = panel.locator('[data-slot="tabs-list"]')
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  )
})

test('Artifacts includes a Markdown report and opens it directly', async ({
  mainWindow
}) => {
  const path = join(
    process.env.HOME!,
    '.actovia',
    'groups',
    groupId,
    'report.md'
  )
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(
    path,
    '# Research findings\n\nA report saved from the conversation.\n'
  )
  await mainWindow.route('**/api/v1/artifacts', (route) =>
    route.fulfill({
      json: [
        {
          kind: 'workspace-file',
          artifactId: 'doc1',
          title: 'report.md',
          path,
          chatId: 'chat1',
          chatTitle: 'Research',
          runId: 'run1',
          toolCallId: 'call1',
          createdAt: time
        }
      ]
    })
  )
  await mainWindow.getByTestId(TEST_IDS.chatLayout.artifacts).click()
  await mainWindow.getByTestId(TEST_IDS.artifacts.card).click()
  await expect(
    mainWindow
      .getByTestId(TEST_IDS.chat.workspaceFile.preview)
      .getByRole('heading', { name: 'Research findings', exact: true })
  ).toBeVisible()
  await expect
    .poll(() =>
      mainWindow
        .getByTestId(TEST_IDS.chat.workspaceFile.preview)
        .evaluate((el) => getComputedStyle(el).opacity)
    )
    .toBe('1')
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'artifact-report.png')
  })
})

test('Scheduled creates and cancels a recurring task for a normal chat', async ({
  mainWindow
}) => {
  await new ApiClient().updateSettings({
    providers: { openaiApiKey: 'faux' },
    providerConfig: { provider: 'OpenAI GPT', model: 'faux-1' },
    memory: { useInChat: false, autoCapture: false }
  })
  const composer = mainWindow.getByTestId(TEST_IDS.composer.textarea)
  await composer.fill('What is the weather in Oslo?')
  await composer.press('Enter')
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toContain('/chat/')
  await mainWindow.getByTestId(TEST_IDS.chatLayout.scheduled).click()
  await expect(mainWindow.getByTestId(TEST_IDS.schedule.page)).toBeVisible()
  await mainWindow.getByTestId(TEST_IDS.schedule.createButton).click()
  const dialog = mainWindow.getByRole('dialog', {
    name: 'Schedule a task',
    exact: true
  })
  await dialog.locator('#schedule-title').fill('Morning research brief')
  await dialog
    .locator('#schedule-description')
    .fill('Review recent developments and write a concise report.')
  await dialog.getByRole('combobox').first().click()
  await mainWindow.getByRole('option').first().click()
  await dialog.getByRole('button', { name: 'Recurring', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Schedule task', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await mainWindow.getByRole('tab', { name: 'Recurring', exact: true }).click()
  await expect(
    mainWindow.getByTestId(TEST_IDS.schedule.taskCard)
  ).toContainText('Morning research brief')
  await expect(
    mainWindow.getByRole('tab', { name: 'Recurring', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'scheduled.png')
  })
  await mainWindow.evaluate(() =>
    document.documentElement.classList.add('dark')
  )
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'scheduled-dark.png')
  })
  await mainWindow.getByTestId(TEST_IDS.schedule.cancelButton).click()
  await expect(mainWindow.getByTestId(TEST_IDS.schedule.taskCard)).toHaveCount(
    0
  )
})

test('a one-off normal-chat schedule runs and saves its answer', async ({
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
  await composer.fill('What is the weather in Oslo?')
  await composer.press('Enter')
  await expect
    .poll(() => mainWindow.evaluate(() => location.hash))
    .toContain('/chat/')
  const chatId = await mainWindow.evaluate(
    () => location.hash.split('/chat/')[1]
  )
  const task = await mainWindow.evaluate(async (chatId) => {
    const token = await window.electron.ipcRenderer.invoke('api:presence-token')
    const response = await fetch(
      'http://localhost:60223/api/v1/philharmonic/tasks',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actovia-presence': String(token)
        },
        body: JSON.stringify({
          title: 'Scheduled weather check',
          description: 'What is the weather in Oslo?',
          chatId,
          runAt: new Date(Date.now() + 2000).toISOString()
        })
      }
    )
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, chatId)
  await expect
    .poll(
      async () => {
        const result = await api.get<
          Array<{ id: string; content: unknown; role: string; runId: string }>
        >(`/api/v1/chat/${chatId}`)
        const prompt = result.data.find(
          (m) =>
            m.role === 'user' &&
            JSON.stringify(m.content).includes('Scheduled weather check')
        )
        return (
          !!prompt &&
          result.data.some(
            (m) => m.role === 'assistant' && m.runId === prompt.id
          )
        )
      },
      { timeout: 75_000, intervals: [1000] }
    )
    .toBe(true)
  const upcoming = await api.get<Array<{ id: string }>>(
    '/api/v1/philharmonic/tasks/upcoming'
  )
  expect(upcoming.data.some((row) => row.id === task.id)).toBe(false)
})
