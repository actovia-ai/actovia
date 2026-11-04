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

test('Group Monitor shows context, activity and registered Archive deliveries', async ({
  mainWindow
}) => {
  let folderRevealed = false
  let archiveRevealed = false
  await mainWindow.route(
    '**/api/v1/philharmonic/conversations**',
    async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.endsWith('/archive/reveal')) {
        archiveRevealed = true
        await route.fulfill({ json: { success: true } })
        return
      }
      const data = pathname.endsWith('/tool-results')
        ? []
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
              },
              {
                id: 'm2',
                conversationId: groupId,
                role: 'pm',
                agentId: null,
                content: 'The portfolio review is complete.',
                parts: [
                  { kind: 'final_output' },
                  {
                    kind: 'archive',
                    title: 'Portfolio report',
                    path: '/tmp/portfolio/report.md',
                    directory: false
                  },
                  {
                    kind: 'archive',
                    title: 'Portfolio chart.svg',
                    path: '/tmp/portfolio/chart.svg',
                    directory: false
                  },
                  {
                    kind: 'archive',
                    title: 'Deliverables',
                    path: '/tmp/portfolio/deliverables',
                    directory: true
                  },
                  {
                    kind: 'attachment',
                    name: 'Portfolio chart.svg',
                    url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"%3E%3Crect width="48" height="32" rx="4" fill="%237c3aed"/%3E%3Cpath d="M8 24l9-10 7 6 6-8 10 12" fill="none" stroke="white" stroke-width="2"/%3E%3C/svg%3E',
                    contentType: 'image/svg+xml'
                  },
                  {
                    kind: 'artifact',
                    artifactId: 'report1',
                    title: 'Portfolio report',
                    code: 'module.exports = { default: () => <div style={{ padding: 24 }}><h1>Portfolio report</h1><p>Concentration remains within the investment rules.</p></div> }'
                  }
                ],
                taskId: null,
                roundId: 'round1',
                createdAt: time
              },
              {
                id: 'm3',
                conversationId: groupId,
                role: 'user',
                agentId: null,
                content: '```text\nFailed to connect MCP server\n```',
                parts: null,
                taskId: null,
                roundId: null,
                createdAt: time
              }
            ]
          : pathname.endsWith('/plan')
            ? {
                id: 'plan1',
                conversationId: groupId,
                summary: 'Review the portfolio',
                status: 'active',
                createdAt: time,
                updatedAt: time,
                steps: [
                  {
                    id: 'step1',
                    planId: 'plan1',
                    ordinal: 1,
                    title: 'Read investment rules',
                    intent: null,
                    assignedAgentId: null,
                    status: 'done',
                    output: null,
                    note: null,
                    taskId: null,
                    startedAt: time,
                    completedAt: time
                  }
                ]
              }
            : pathname.endsWith('/context')
              ? {
                  takenAt: time,
                  roundId: 'round1',
                  model: 'gpt-5.6',
                  contextWindow: 128000,
                  compactAt: 96000,
                  lcmTokens: 700,
                  total: 1000,
                  estimated: false,
                  parts: [
                    { key: 'system', tokens: 200 },
                    { key: 'skills', tokens: 0 },
                    { key: 'mcp', tokens: 100 },
                    { key: 'tools', tokens: 200 },
                    { key: 'memory', tokens: 0 },
                    { key: 'summaries', tokens: 100 },
                    { key: 'messages', tokens: 400 }
                  ]
                }
              : [group]
      await route.fulfill({ json: data })
    }
  )
  await mainWindow.route(
    `**/api/v1/projects/conversations/${groupId}**`,
    async (route) => {
      if (route.request().method() === 'POST') {
        folderRevealed = true
        await route.fulfill({ json: { success: true } })
        return
      }
      await route.fulfill({
        json: {
          project: {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Portfolio',
            dir: '/tmp/portfolio',
            workDir: '/tmp/portfolio',
            useWorktrees: false,
            lastUsedAt: time
          },
          missing: false,
          branch: null
        }
      })
    }
  )
  await mainWindow.route('**/api/v1/philharmonic/plans/monitor', (route) =>
    route.fulfill({
      json: [
        {
          id: 'plan1',
          conversationId: groupId,
          summary: 'Review the portfolio',
          status: 'active',
          createdAt: time,
          updatedAt: time,
          steps: [
            {
              id: 'step1',
              planId: 'plan1',
              ordinal: 0,
              title: 'Read investment rules',
              intent: null,
              assignedAgentId: null,
              status: 'done',
              output: null,
              note: null,
              taskId: null,
              startedAt: time,
              completedAt: time
            },
            {
              id: 'step2',
              planId: 'plan1',
              ordinal: 1,
              title: 'Compare current positions',
              intent: null,
              assignedAgentId: null,
              status: 'running',
              output: null,
              note: null,
              taskId: null,
              startedAt: time,
              completedAt: null
            }
          ]
        }
      ]
    })
  )
  await mainWindow.route('**/api/v1/philharmonic/tasks/upcoming', (route) =>
    route.fulfill({ json: [] })
  )
  await mainWindow.route('**/api/v1/philharmonic/tasks/recurring', (route) =>
    route.fulfill({ json: [] })
  )
  await mainWindow.evaluate((id) => {
    location.hash = `/philharmonic/groups/${id}`
  }, groupId)
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonic.planToggle)
  ).toBeVisible()
  await mainWindow.getByTestId(TEST_IDS.philharmonic.planToggle).click()
  await expect(mainWindow.getByText('Read investment rules')).toBeVisible()
  const activity = mainWindow
    .getByTestId(TEST_IDS.philharmonic.activityToggle)
    .first()
  await activity.click()
  await expect(activity).toHaveAttribute('aria-expanded', 'true')
  await mainWindow.getByTestId(TEST_IDS.philharmonic.contextToggle).click()
  const panel = mainWindow.getByTestId(TEST_IDS.philharmonic.resourcesPanel)
  await expect(panel).toBeVisible()
  await expect(
    panel.getByTestId(TEST_IDS.philharmonic.contextSection)
  ).toBeVisible()
  await expect(
    panel.getByTestId(TEST_IDS.philharmonic.resourcesTab)
  ).toHaveCount(2)
  await expect(panel.getByText(/Members/)).toBeVisible()
  await panel.getByRole('tab', { name: 'Archive' }).click()
  await expect(
    panel.getByTestId(TEST_IDS.philharmonic.finalOutputFolder)
  ).toBeVisible()
  await expect(
    panel.getByTestId(TEST_IDS.philharmonic.resourcesMenu)
  ).toBeVisible()
  await panel.getByTestId(TEST_IDS.philharmonic.finalOutputFolder).click()
  await expect.poll(() => folderRevealed).toBe(true)
  const outputs = panel.getByTestId(TEST_IDS.philharmonic.finalOutputItem)
  await expect(outputs).toHaveCount(3)
  await expect(panel.getByText('Portfolio chart.svg')).toBeVisible()
  await outputs
    .filter({ hasText: 'Portfolio report' })
    .getByRole('button', { name: 'Reveal in folder' })
    .click()
  await expect.poll(() => archiveRevealed).toBe(true)
  await expect(
    outputs
      .filter({ hasText: 'Deliverables' })
      .getByRole('link', { name: 'Download' })
  ).toHaveAttribute('href', /archive\/file\?path=/)
  mkdirSync(captures, { recursive: true })
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-final-output.png')
  })
  await expect(
    mainWindow.getByRole('menuitem', { name: 'Artifacts' })
  ).toHaveCount(0)
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-monitor-output.png')
  })
  await mainWindow.setViewportSize({ width: 1000, height: 800 })
  await mainWindow.evaluate(() =>
    document.documentElement.classList.add('dark')
  )
  const darkUserMessage = mainWindow.locator('[data-message-id="m3"]')
  await darkUserMessage.scrollIntoViewIfNeeded()
  const darkMessageColors = await darkUserMessage
    .locator('.markdown')
    .evaluate((markdown) => {
      const bubble = markdown.parentElement!
      const codeBlock = markdown.querySelector('pre')!
      return {
        bubbleBackground: getComputedStyle(bubble).backgroundColor,
        messageText: getComputedStyle(bubble).color,
        codeBackground: getComputedStyle(codeBlock).backgroundColor,
        codeText: getComputedStyle(codeBlock).color
      }
    })
  expect(darkMessageColors.bubbleBackground).not.toBe('rgb(255, 255, 255)')
  expect(darkMessageColors.codeText).toBe(darkMessageColors.messageText)
  expect(darkMessageColors.codeText).not.toBe(darkMessageColors.codeBackground)
  await mainWindow.screenshot({
    animations: 'disabled',
    path: join(captures, 'group-final-output-dark.png')
  })
  const header = panel.locator('[data-slot="tabs-list"]')
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  )
  await mainWindow.keyboard.press('Escape')
  await mainWindow.evaluate(() => {
    location.hash = '/philharmonic/dashboard'
  })
  await expect(
    mainWindow.getByRole('heading', { name: 'Execution plans', exact: true })
  ).toBeVisible()
  await expect(
    mainWindow.getByTestId(TEST_IDS.philharmonic.monitorCharts)
  ).toBeVisible()
  const monitoredPlan = mainWindow.getByTestId(
    TEST_IDS.philharmonic.monitorPlan
  )
  await expect(monitoredPlan).toContainText('Review the portfolio')
  await expect(monitoredPlan).toContainText('1/2')
  await expect(mainWindow.getByRole('tab', { name: 'Schedule' })).toHaveCount(0)
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
