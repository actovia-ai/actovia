import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const philharmonic = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'i18n',
      'locales',
      'en',
      'philharmonic.json'
    ),
    'utf8'
  )
)

describe('philharmonic namespace (en)', () => {
  it('has the container toast keys', () => {
    expect(philharmonic.container.toast).toMatchObject({
      groupDeleted: 'Group deleted',
      deleteGroupFailed: 'Could not delete the group'
    })
  })

  it('has the container tab keys', () => {
    expect(philharmonic.container.tabs).toEqual({ schedule: 'Schedule' })
  })

  it('has the no-group-selected empty state keys', () => {
    expect(philharmonic.container.noGroupSelected).toMatchObject({
      title: 'No group selected',
      description:
        'Pick a group from the left, or start a new one to message your virtual team.',
      createButton: 'Create a group'
    })
  })

  it('has the new-group default title', () => {
    expect(philharmonic.container.newGroupDefaultTitle).toBe('New group')
  })

  it('has the schedule tab and shared keys', () => {
    expect(philharmonic.schedule.tab).toMatchObject({
      upcomingTrigger: 'Upcoming',
      recurringTrigger: 'Recurring'
    })
    expect(philharmonic.schedule.unknownGroup).toBe('Unknown group')
    expect(philharmonic.schedule.scheduleTaskButton).toBe('Schedule task')
  })

  it('has the task card status and priority labels', () => {
    expect(philharmonic.schedule.taskCard.status).toMatchObject({
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      waiting_for_user: 'Waiting'
    })
    expect(philharmonic.schedule.taskCard.priority).toMatchObject({
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      urgent: 'Urgent'
    })
  })

  it('has the recurring-list schedule-description interpolation keys', () => {
    expect(philharmonic.schedule.recurringList).toMatchObject({
      lastRun: 'last {{time}}',
      nextRun: 'next {{time}}'
    })
  })

  it('has the schedule form keys', () => {
    expect(philharmonic.schedule.form.title).toBe('Schedule a task')
    expect(philharmonic.schedule.form.cronPresets).toMatchObject({
      dailyNine: 'Every day at 9:00 AM',
      mondayNine: 'Every Monday at 9:00 AM',
      custom: 'Custom'
    })
  })

  it('has the composer, attachment, and uploader keys', () => {
    expect(philharmonic.chat.attachmentPreview.removeAria).toBe(
      'Remove {{name}}'
    )
    expect(philharmonic.chat.uploader.attachAria).toBe('Attach images')
    expect(philharmonic.chat.composer.placeholder).toBe('Message your team…')
  })

  it('has the uploader failure toast (usePhilharmonicUpload)', () => {
    expect(philharmonic.chat.uploader.attachFailedTitle).toBe(
      'Could not attach files'
    )
  })

  it('has the plan card elapsed/status/aria keys', () => {
    expect(philharmonic.chat.planCard.elapsed).toMatchObject({
      lessThanMin: '<1 min',
      minutes: '{{count}} min',
      hoursMinutes: '{{hours}}h {{minutes}}m'
    })
    expect(philharmonic.chat.planCard.status).toMatchObject({
      active: 'active',
      done: 'done',
      aborted: 'aborted',
      draft: 'draft'
    })
    expect(philharmonic.chat.planCard.stepStatusAria).toMatchObject({
      pending: 'Pending',
      running: 'Running',
      done: 'Done',
      skipped: 'Skipped',
      failed: 'Failed'
    })
  })

  it('has the shared role-name keys', () => {
    expect(philharmonic.chat.roles).toMatchObject({
      pm: 'PM',
      employeeFallback: 'Employee'
    })
  })

  it('has the members panel keys', () => {
    expect(philharmonic.chat.membersPanel).toMatchObject({
      heading: 'Members',
      coordinatorsLabel: 'Coordinators',
      unassignedLabel: 'Unassigned',
      idleCount: '{{count}} idle',
      busyCount: '{{count}} busy'
    })
  })

  it('has the conversation list keys, three distinct "New group" copies', () => {
    expect(philharmonic.chat.conversationList.newGroupMenuItem).toBe(
      'New group'
    )
    expect(philharmonic.chat.conversationList.emptyState.createButton).toBe(
      '+ New group'
    )
    expect(philharmonic.chat.conversationList.noMessagesYetPreview).toBe(
      'New group · no messages yet'
    )
    expect(philharmonic.container.newGroupDefaultTitle).toBe('New group')
  })

  it('has the shared date labels', () => {
    expect(philharmonic.chat.dateLabels).toMatchObject({
      today: 'Today',
      yesterday: 'Yesterday'
    })
  })

  it('has real pluralization for the group chat member count', () => {
    expect(philharmonic.chat.groupChat).toMatchObject({
      memberCount_one: '{{count}} member',
      memberCount_other: '{{count}} members'
    })
  })

  it('has the Phase 5 groupChat.errorTitle key (useConversationStream SSE error)', () => {
    expect(philharmonic.chat.groupChat.errorTitle).toBe(
      'Group encountered an error'
    )
  })

  it('has the employees avatar and picker keys', () => {
    expect(philharmonic.employees.avatar.alt).toBe('avatar')
    expect(philharmonic.employees.picker.reroll).toBe('Reroll')
  })

  it('has the employee editor keys', () => {
    expect(philharmonic.employees.editor.header).toMatchObject({
      label: 'Employee',
      newFallback: 'New employee'
    })
    expect(philharmonic.employees.editor.fields).toMatchObject({
      name: 'Name',
      team: 'Team',
      teamPlaceholder: 'Select a team',
      description: 'Description',
      systemPrompt: 'System prompt',
      skills: 'Skills',
      mcpServers: 'MCP servers',
      memory: 'Memory (read-only)'
    })
  })

  it('has the team editor keys, self-contained from employees.editor', () => {
    expect(philharmonic.teams.editor.header).toMatchObject({
      label: 'Team',
      newFallback: 'New team'
    })
    expect(philharmonic.teams.editor.fields).toMatchObject({
      name: 'Name',
      icon: 'Icon (emoji, optional)',
      description: 'Description',
      systemPrompt: 'System prompt'
    })
    // Same English text as employees.editor.fields.* by coincidence, but a
    // deliberately separate key per section (see Global Constraints) — not
    // the same catalog value reference.
    expect(philharmonic.teams.editor.fields.name).toBe(
      philharmonic.employees.editor.fields.name
    )
  })

  it('titles the Dashboard and carries no cost keys (ISSUE-235)', () => {
    expect(philharmonic.container.dashboardTitle).toBe('Dashboard')
    expect(philharmonic).not.toHaveProperty('costAnalysis')
    expect(philharmonic.chat.decision.usage).not.toContain('cost')
  })

  it('has the workforce header, empty state, and team section keys', () => {
    expect(philharmonic.workforce.header).toMatchObject({
      title: 'Workforce',
      employeeCount_one: '{{count}} employee',
      employeeCount_other: '{{count}} employees',
      teamCount_one: '{{count}} team',
      teamCount_other: '{{count}} teams'
    })
    expect(philharmonic.workforce.emptyState).toMatchObject({
      title: 'Start with a team',
      createButton: '+ New team'
    })
    expect(philharmonic.workforce.teamSection.unassignedFallback).toBe(
      'No team'
    )
  })

  it('has distinct default-name and toast keys', () => {
    expect(philharmonic.workforce.newEmployeeDefaultName).toBe('New Employee')
    expect(philharmonic.workforce.newTeamDefaultName).toBe('New Team')
    // Shared generic templates, reused by both employee and team flows.
    expect(philharmonic.workforce.toast.created).toBe('"{{name}}" created')
    expect(philharmonic.workforce.toast.deleted).toBe('"{{name}}" deleted')
    // Entity-specific failure toasts stay separate.
    expect(philharmonic.workforce.toast.saveEmployeeFailed).not.toBe(
      philharmonic.workforce.toast.saveTeamFailed
    )
  })
})

describe('philharmonic namespace workforce delete-dialog descriptions render correctly via Trans', () => {
  it('employee description — dynamic name in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteEmployeeDescription } =
      await import('@/components/philharmonic/workforce/workforce-page')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DeleteEmployeeDescription, { name: 'Ada' })
      )
    )
    expect(html).toBe(
      '<span class="bg-background rounded-md px-1.5 py-0.5 text-xs">Ada</span> will be permanently removed along with their accumulated memory.'
    )
  })

  it('team description — dynamic name in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteTeamDescription } =
      await import('@/components/philharmonic/workforce/workforce-page')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DeleteTeamDescription, { name: 'Marketing' })
      )
    )
    expect(html).toBe(
      '<span class="bg-background rounded-md px-1.5 py-0.5 text-xs">Marketing</span> will be removed. Existing members keep their records but lose this team affiliation.'
    )
  })
})

describe('philharmonic namespace chat.conversationList.deleteDialog.description renders correctly via Trans', () => {
  it('description — dynamic title in a styled <span> at index 0', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { DeleteGroupDescription } =
      await import('@/components/philharmonic/chat/conversation-list')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { philharmonic } },
      ns: ['philharmonic'],
      defaultNS: 'philharmonic',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(DeleteGroupDescription, { title: 'Marketing Team' })
      )
    )
    expect(html).toBe(
      '<span class="bg-muted rounded-sm px-1.5 py-0.5 text-xs">Marketing Team</span> and all its messages, tasks, and executions will be permanently removed.'
    )
  })
})
