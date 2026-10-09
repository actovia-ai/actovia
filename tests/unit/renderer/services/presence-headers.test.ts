import { afterEach, describe, expect, it, vi } from 'vitest'

const fetcherMock = vi.fn()
vi.mock('@exodus/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@exodus/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
vi.mock('@/lib/presence', () => ({
  presenceHeaders: async () => ({ 'x-exodus-presence': 'tok' })
}))

const { updateSettings } = await import('@/services/settings')
const { checkCli, continueInTerminal, respondToAgent } =
  await import('@/services/agents')
const { respondToConversation, sendConversationMessage } =
  await import('@/services/philharmonic-chat')
const { createProject, setProjectWorktrees } =
  await import('@/services/projects')

afterEach(() => fetcherMock.mockReset())

const headersOfCall = () => fetcherMock.mock.calls[0][1].headers

describe('presence header on writes', () => {
  it('settings update', async () => {
    await updateSettings({} as never)
    expect(headersOfCall()).toEqual({ 'x-exodus-presence': 'tok' })
  })
  it('agents POSTs', async () => {
    await checkCli('claude-code')
    expect(headersOfCall()).toEqual({ 'x-exodus-presence': 'tok' })
    fetcherMock.mockReset()
    await respondToAgent('s', 'r', { kind: 'cancel' } as never)
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { requestId: 'r' },
      headers: { 'x-exodus-presence': 'tok' }
    })
  })
  it('projects writes', async () => {
    await createProject('p')
    expect(headersOfCall()).toEqual({ 'x-exodus-presence': 'tok' })
    fetcherMock.mockReset()
    await setProjectWorktrees('id', false)
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      headers: { 'x-exodus-presence': 'tok' }
    })
  })
  it('a group message and an answer to the PM', async () => {
    await sendConversationMessage('c', 'build it')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { content: 'build it' },
      headers: { 'x-exodus-presence': 'tok' }
    })
    fetcherMock.mockReset()
    await respondToConversation('c', 'yes')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { response: 'yes' },
      headers: { 'x-exodus-presence': 'tok' }
    })
  })
  it('Continue in Terminal names the card it was pressed on', async () => {
    await continueInTerminal('s', 'm')
    expect(fetcherMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { messageId: 'm' },
      headers: { 'x-exodus-presence': 'tok' }
    })
  })
})
