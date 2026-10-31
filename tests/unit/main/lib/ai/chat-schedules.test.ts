import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTaskById = vi.fn()
const getChatById = vi.fn()
const createTask = vi.fn(async (data) => ({ id: 'new-task', ...data }))
const updateChatScheduledTask = vi.fn(async (id, _owner, data) => ({
  id,
  ...data
}))
const scheduleTask = vi.fn()
const unscheduleTask = vi.fn()
vi.mock('@main/lib/db/philharmonic-queries', () => ({
  getTaskById,
  createTask,
  updateChatScheduledTask
}))
vi.mock('@main/lib/db/queries', () => ({ getChatById }))
vi.mock('@main/lib/ai/philharmonic/scheduler', () => ({
  scheduleTask,
  unscheduleTask
}))
const { saveChatSchedule, deleteChatSchedule } =
  await import('@main/lib/ai/chat-schedules')
const data = {
  title: 'Morning brief',
  description: 'Summarize the news.',
  cronExpression: '0 9 * * *',
  runAt: null
}
const existing = {
  id: 'task-1',
  conversationId: null,
  input: { kind: 'chat-schedule', chatId: 'original' },
  status: 'pending',
  cronExpression: '0 9 * * *'
}

beforeEach(() => {
  vi.clearAllMocks()
  getTaskById.mockResolvedValue(existing)
  getChatById.mockImplementation(async ({ id }) => ({ id }))
})

describe('Chat schedule management', () => {
  it('binds a new schedule to the current Chat and registers its cron', async () => {
    const row = await saveChatSchedule('current', data)
    expect(row.input).toEqual({ kind: 'chat-schedule', chatId: 'current' })
    expect(scheduleTask).toHaveBeenCalledWith('new-task', '0 9 * * *')
  })
  it('updates the same task and removes the old cron when switching to one-off', async () => {
    await saveChatSchedule(
      'original',
      {
        ...data,
        cronExpression: null,
        runAt: new Date(Date.now() + 60_000).toISOString()
      },
      'task-1'
    )
    expect(createTask).not.toHaveBeenCalled()
    expect(updateChatScheduledTask).toHaveBeenCalledWith(
      'task-1',
      'original',
      expect.objectContaining({ cronExpression: null, status: 'pending' })
    )
    expect(unscheduleTask).toHaveBeenCalledWith('task-1')
    expect(scheduleTask).not.toHaveBeenCalled()
  })
  it('does not move a task away from a surviving original Chat', async () => {
    await expect(saveChatSchedule('new-chat', data, 'task-1')).rejects.toThrow(
      'original Chat'
    )
    expect(updateChatScheduledTask).not.toHaveBeenCalled()
    await expect(deleteChatSchedule('task-1', 'new-chat')).rejects.toThrow(
      'original Chat'
    )
  })
  it('adopts an orphan only when the edited task is saved, preserving its id', async () => {
    getChatById.mockImplementation(async ({ id }) =>
      id === 'original' ? null : { id }
    )
    await saveChatSchedule('replacement', data, 'task-1')
    expect(updateChatScheduledTask).toHaveBeenCalledWith(
      'task-1',
      'original',
      expect.objectContaining({
        input: { kind: 'chat-schedule', chatId: 'replacement' }
      })
    )
    expect(createTask).not.toHaveBeenCalled()
  })
  it('deletes a task even when its original conversation has gone', async () => {
    getChatById.mockResolvedValue(null)
    await deleteChatSchedule('task-1')
    expect(updateChatScheduledTask).toHaveBeenCalledWith(
      'task-1',
      'original',
      { status: 'cancelled' },
      true
    )
    expect(unscheduleTask).toHaveBeenCalledWith('task-1')
  })
  it('refuses Philharmonic edits and deletion in the service, not just the UI', async () => {
    getTaskById.mockResolvedValue({ ...existing, conversationId: 'group-1' })
    await expect(saveChatSchedule('original', data, 'task-1')).rejects.toThrow(
      'read-only'
    )
    await expect(deleteChatSchedule('task-1')).rejects.toThrow('read-only')
    expect(updateChatScheduledTask).not.toHaveBeenCalled()
  })
  it('refuses invalid/past/ambiguous times without changing a task', async () => {
    for (const changes of [
      { cronExpression: 'bad' },
      { cronExpression: null, runAt: '2020-01-01T00:00:00Z' },
      { runAt: '2030-01-01T00:00:00Z' }
    ])
      await expect(
        saveChatSchedule('original', { ...data, ...changes }, 'task-1')
      ).rejects.toThrow()
    expect(updateChatScheduledTask).not.toHaveBeenCalled()
  })
  it('does not re-arm a task if its execution/adoption won the conditional update', async () => {
    updateChatScheduledTask.mockResolvedValueOnce(undefined as never)
    await expect(saveChatSchedule('original', data, 'task-1')).rejects.toThrow(
      'changed'
    )
    expect(scheduleTask).not.toHaveBeenCalled()
    expect(unscheduleTask).not.toHaveBeenCalled()
  })
})
