import { afterEach, describe, expect, it, vi } from 'vitest'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
vi.mock('@/lib/presence', () => ({
  presenceHeaders: async () => ({ 'x-actovia-presence': 'tok' })
}))

const { updateSettings } = await import('@/services/settings')
const { checkCli, continueInTerminal, respondToAgent } =
  await import('@/services/agents')
const { deleteConversation, respondToConversation, sendConversationMessage } =
  await import('@/services/philharmonic-chat')
const { cancelScheduledTask, createScheduledTask } =
  await import('@/services/philharmonic-tasks')
const { createTeamApi, deleteTeamApi, updateTeamApi } =
  await import('@/services/philharmonic')
const { createProject, setProjectWorktrees } =
  await import('@/services/projects')

afterEach(() => fetcherMock.mockReset())

const headersOfCall = () => fetcherMock.mock.calls[0][1].headers

describe('presence header on writes', () => {
  it('settings update', async () => {
    await updateSettings({} as never)
    expect(headersOfCall()).toEqual({ 'x-actovia-presence': 'tok' })
  })
  it('agents POSTs', async () => {
    await checkCli('claude-code')
    expect(headersOfCall()).toEqual({ 'x-actovia-presence': 'tok' })
    fetcherMock.mockReset()
    await respondToAgent('s', 'r', { kind: 'cancel' } as never)
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { requestId: 'r' },
      headers: { 'x-actovia-presence': 'tok' }
    })
  })
  it('projects writes', async () => {
    await createProject('p')
    expect(headersOfCall()).toEqual({ 'x-actovia-presence': 'tok' })
    fetcherMock.mockReset()
    await setProjectWorktrees('id', false)
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      headers: { 'x-actovia-presence': 'tok' }
    })
  })
  it('a group message and an answer to the PM', async () => {
    await sendConversationMessage('c', 'build it')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { content: 'build it' },
      headers: { 'x-actovia-presence': 'tok' }
    })
    fetcherMock.mockReset()
    await respondToConversation('c', 'yes')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { response: 'yes' },
      headers: { 'x-actovia-presence': 'tok' }
    })
  })
  it('scheduled tasks, team edits and deleting a group', async () => {
    await createScheduledTask({ title: 't', conversationId: 'c' })
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { title: 't', conversationId: 'c' },
      headers: { 'x-actovia-presence': 'tok' }
    })
    const writes = [
      () => cancelScheduledTask('t'),
      () => createTeamApi({ name: 'x' } as never),
      () => updateTeamApi('t', { name: 'y' } as never),
      () => deleteTeamApi('t'),
      () => deleteConversation('c')
    ]
    for (const write of writes) {
      fetcherMock.mockReset()
      await write()
      expect(headersOfCall()).toEqual({ 'x-actovia-presence': 'tok' })
    }
  })
  it('Continue in Terminal names the card it was pressed on', async () => {
    await continueInTerminal('s', 'm')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { messageId: 'm' },
      headers: { 'x-actovia-presence': 'tok' }
    })
  })
})
